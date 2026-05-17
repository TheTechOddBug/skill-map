/**
 * `RestDataSource`, `IDataSourcePort` implementation that talks to the
 * BFF (`src/server/`) over HTTP using Angular's `HttpClient`.
 *
 * URLs are relative (`/api/...`) so they resolve against the page origin.
 * The BFF and SPA ship on the same port (`sm serve` mandates single-port),
 * so cross-origin concerns don't apply.
 *
 * Errors:
 *   - 4xx / 5xx with the BFF's error envelope → `DataSourceError`
 *     carrying the envelope's `code` + `message`.
 *   - Transport failure (network down, JSON parse error) → `DataSourceError`
 *     with `code = 'internal'`.
 *   - 404 on `getNode` → returns `null` (not-found is a normal value).
 *
 * Promise-style API matches the existing `CollectionLoaderService` (uses
 * `firstValueFrom`); rxjs Observables are reserved for `events()` (lands
 * at 14.4 with the WS broadcaster).
 */

import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { type Observable, firstValueFrom } from 'rxjs';

import { DATA_SOURCE_TEXTS } from '../../i18n/data-source.texts';
import type {
  IErrorEnvelopeApi,
  IHealthResponseApi,
  IIssueApi,
  IKindRegistryApi,
  ILinkApi,
  IListEnvelopeApi,
  INodeApi,
  INodeDetailApi,
  IPreferencesApi,
  IPreferencesPatchApi,
  IProjectConfigApi,
  IProjectIgnoreApi,
  IProjectIgnorePatchApi,
  IProjectPreferencesApi,
  IProjectPreferencesPatchApi,
  IRegisteredAnnotationKeyApi,
  IRegisteredAnnotationsEnvelopeApi,
  IScanResultApi,
  ISidecarBumpedEnvelopeApi,
  IUpdateStatusResponseApi,
  IValueEnvelopeApi,
} from '../../models/api';
import type { IWsEvent } from '../../models/ws-event';
import { KindRegistryService } from '../kind-registry';
import { ContributionsRegistryService } from '../../app/services/contributions-registry';
import { WsEventStreamService } from '../ws-event-stream';
import { encodeNodePath } from './path-codec';
import {
  DataSourceError,
  type IDataSourcePort,
  type IIssuesQuery,
  type ILinksQuery,
  type INodesQuery,
  type ISidecarBumpOpts,
  type TGraphFormat,
  type TPluginItem,
} from './data-source.port';

const BASE = '/api';

@Injectable({ providedIn: 'root' })
export class RestDataSource implements IDataSourcePort {
  private readonly http: HttpClient;
  private readonly ws: WsEventStreamService;
  private readonly kindRegistry: KindRegistryService;
  private readonly contributionsRegistry: ContributionsRegistryService;

  constructor(
    http?: HttpClient,
    ws?: WsEventStreamService,
    kindRegistry?: KindRegistryService,
    contributionsRegistry?: ContributionsRegistryService,
  ) {
    // The factory passes `HttpClient` + `WsEventStreamService`
    // explicitly; the `@Injectable` path uses Angular DI. Both call
    // sites resolve to the same singleton, keep the constructor
    // flexible to support manual `new RestDataSource(http, ws)` for
    // tests / factory wiring. Tests that pass `kindRegistry`
    // explicitly should also pass `contributionsRegistry` to skip
    // the `inject()` fallback (it requires an injection context).
    this.http = http ?? inject(HttpClient);
    this.ws = ws ?? inject(WsEventStreamService);
    this.kindRegistry = kindRegistry ?? inject(KindRegistryService);
    this.contributionsRegistry =
      contributionsRegistry ?? inject(ContributionsRegistryService);
  }

  async health(): Promise<IHealthResponseApi> {
    return this.getJson<IHealthResponseApi>(`${BASE}/health`);
  }

  /**
   * `/api/scan` is exempt from the envelope shape (returns the raw
   * `ScanResult` per the spec contract), so it does NOT carry the
   * `kindRegistry`. The scan flow needs the registry up-front though
   * (otherwise the first paint of List / Graph renders unstyled kind
   * tags). Solution: prime the registry in parallel with the scan
   * fetch via a zero-row `/api/nodes?limit=0` call. The list response
   * IS payload-bearing and carries the registry; the items array is
   * empty so the round-trip is cheap.
   */
  async loadScan(): Promise<IScanResultApi> {
    const [scan] = await Promise.all([
      this.getJson<IScanResultApi>(`${BASE}/scan`),
      this.listNodes({ limit: 0 }).catch(() => null),
    ]);
    return scan;
  }

  async runScan(): Promise<IScanResultApi> {
    return this.patchJson<IScanResultApi>(`${BASE}/scan`, {}, 'POST');
  }

  async listNodes(q: INodesQuery = {}): Promise<IListEnvelopeApi<INodeApi>> {
    const params = buildNodesQueryString(q);
    const envelope = await this.getJson<IListEnvelopeApi<INodeApi>>(`${BASE}/nodes${params}`);
    this.ingestRegistry(envelope.kindRegistry);
    this.ingestContributionsRegistry(envelope.contributionsRegistry);
    return envelope;
  }

  async getNode(
    path: string,
    opts: { includeBody?: boolean } = {},
  ): Promise<INodeDetailApi | null> {
    const encoded = encodeNodePath(path);
    const query = opts.includeBody ? '?include=body' : '';
    try {
      const envelope = await this.getJson<INodeDetailApi>(`${BASE}/nodes/${encoded}${query}`);
      this.ingestRegistry(envelope.kindRegistry);
    this.ingestContributionsRegistry(envelope.contributionsRegistry);
      return envelope;
    } catch (err) {
      if (err instanceof DataSourceError && err.code === 'not-found') return null;
      throw err;
    }
  }

  async listLinks(q: ILinksQuery = {}): Promise<IListEnvelopeApi<ILinkApi>> {
    const params = buildLinksQueryString(q);
    const envelope = await this.getJson<IListEnvelopeApi<ILinkApi>>(`${BASE}/links${params}`);
    this.ingestRegistry(envelope.kindRegistry);
    this.ingestContributionsRegistry(envelope.contributionsRegistry);
    return envelope;
  }

  async listIssues(q: IIssuesQuery = {}): Promise<IListEnvelopeApi<IIssueApi>> {
    const params = buildIssuesQueryString(q);
    const envelope = await this.getJson<IListEnvelopeApi<IIssueApi>>(`${BASE}/issues${params}`);
    this.ingestRegistry(envelope.kindRegistry);
    this.ingestContributionsRegistry(envelope.contributionsRegistry);
    return envelope;
  }

  async loadGraph(format: TGraphFormat = 'ascii'): Promise<string> {
    const url = `${BASE}/graph?format=${encodeURIComponent(format)}`;
    try {
      return await firstValueFrom(
        this.http.get(url, { responseType: 'text' }),
      );
    } catch (err) {
      throw this.translateError(err);
    }
  }

  async loadConfig(): Promise<IProjectConfigApi> {
    const envelope = await this.getJson<IValueEnvelopeApi<IProjectConfigApi>>(
      `${BASE}/config`,
    );
    this.ingestRegistry(envelope.kindRegistry);
    this.ingestContributionsRegistry(envelope.contributionsRegistry);
    return envelope.value;
  }

  async listPlugins(): Promise<IListEnvelopeApi<TPluginItem>> {
    const envelope = await this.getJson<IListEnvelopeApi<TPluginItem>>(`${BASE}/plugins`);
    this.ingestRegistry(envelope.kindRegistry);
    this.ingestContributionsRegistry(envelope.contributionsRegistry);
    return envelope;
  }

  async setPluginEnabled(
    id: string,
    enabled: boolean,
  ): Promise<IListEnvelopeApi<TPluginItem>> {
    const envelope = await this.patchJson<IListEnvelopeApi<TPluginItem>>(
      `${BASE}/plugins/${encodeURIComponent(id)}`,
      { enabled },
    );
    this.ingestRegistry(envelope.kindRegistry);
    this.ingestContributionsRegistry(envelope.contributionsRegistry);
    return envelope;
  }

  async setPluginExtensionEnabled(
    bundleId: string,
    extensionId: string,
    enabled: boolean,
  ): Promise<IListEnvelopeApi<TPluginItem>> {
    const envelope = await this.patchJson<IListEnvelopeApi<TPluginItem>>(
      `${BASE}/plugins/${encodeURIComponent(bundleId)}/extensions/${encodeURIComponent(extensionId)}`,
      { enabled },
    );
    this.ingestRegistry(envelope.kindRegistry);
    this.ingestContributionsRegistry(envelope.contributionsRegistry);
    return envelope;
  }

  async applyPluginChanges(
    changes: ReadonlyArray<{ id: string; enabled: boolean }>,
  ): Promise<IListEnvelopeApi<TPluginItem>> {
    const envelope = await this.patchJson<IListEnvelopeApi<TPluginItem>>(
      `${BASE}/plugins`,
      { changes },
    );
    this.ingestRegistry(envelope.kindRegistry);
    this.ingestContributionsRegistry(envelope.contributionsRegistry);
    return envelope;
  }

  async getPreferences(): Promise<IPreferencesApi> {
    return await this.getJson<IPreferencesApi>(`${BASE}/preferences`);
  }

  async setPreferences(patch: IPreferencesPatchApi): Promise<IPreferencesApi> {
    return await this.patchJson<IPreferencesApi>(`${BASE}/preferences`, patch);
  }

  async getProjectPreferences(): Promise<IProjectPreferencesApi> {
    return await this.getJson<IProjectPreferencesApi>(`${BASE}/project-preferences`);
  }

  async setProjectPreferences(
    patch: IProjectPreferencesPatchApi,
  ): Promise<IProjectPreferencesApi> {
    return await this.patchJson<IProjectPreferencesApi>(
      `${BASE}/project-preferences`,
      patch,
    );
  }

  async getProjectIgnore(): Promise<IProjectIgnoreApi> {
    return await this.getJson<IProjectIgnoreApi>(`${BASE}/project-ignore`);
  }

  async setProjectIgnore(patch: IProjectIgnorePatchApi): Promise<IProjectIgnoreApi> {
    return await this.patchJson<IProjectIgnoreApi>(`${BASE}/project-ignore`, patch);
  }

  async setFavorite(path: string): Promise<void> {
    const encoded = encodeNodePath(path);
    try {
      await firstValueFrom(this.http.put(`${BASE}/favorites/${encoded}`, null));
    } catch (err) {
      throw this.translateError(err);
    }
  }

  async unsetFavorite(path: string): Promise<void> {
    const encoded = encodeNodePath(path);
    try {
      await firstValueFrom(this.http.delete(`${BASE}/favorites/${encoded}`));
    } catch (err) {
      throw this.translateError(err);
    }
  }

  async bumpSidecar(
    nodePath: string,
    opts: ISidecarBumpOpts = {},
  ): Promise<ISidecarBumpedEnvelopeApi> {
    const body: Record<string, unknown> = { nodePath };
    if (opts.force !== undefined) body['force'] = opts.force;
    if (opts.confirm !== undefined) body['confirm'] = opts.confirm;
    return this.patchJson<ISidecarBumpedEnvelopeApi>(`${BASE}/sidecar/bump`, body, 'POST');
  }

  async getUpdateStatus(): Promise<IUpdateStatusResponseApi> {
    return this.getJson<IUpdateStatusResponseApi>(`${BASE}/update-status`);
  }

  async getRegisteredAnnotations(): Promise<readonly IRegisteredAnnotationKeyApi[]> {
    const envelope = await this.getJson<IRegisteredAnnotationsEnvelopeApi>(
      `${BASE}/annotations/registered`,
    );
    return envelope.items;
  }

  private ingestRegistry(payload: IKindRegistryApi | undefined): void {
    if (payload) this.kindRegistry.ingest(payload);
  }

  /**
   * Phase 4 / View contribution system, refresh the cached
   * contributions registry from any payload-bearing envelope. Mirror
   * of `ingestRegistry` for the parallel `contributionsRegistry`
   * field. Sentinel envelopes (`health`, `scan`, `graph`) and
   * action-result envelopes (`sidecar.bumped`) carry `undefined`,
   * which the service treats as a no-op.
   */
  private ingestContributionsRegistry(
    payload: import('../../models/api').IContributionsRegistryApi | undefined,
  ): void {
    this.contributionsRegistry.setRegistry(payload);
  }

  /**
   * Lazy fetch of one contribution row for the slot host fallback
   * path. Mirrors the BFF's
   * `GET /api/contributions/:pluginId/:contributionId?path=...`.
   */
  async lookupContribution(
    pluginId: string,
    contributionId: string,
    path: string,
  ): Promise<import('../../models/api').IContributionApi | null> {
    const params = new URLSearchParams({ path });
    type IContributionsLookupEnvelope = {
      schemaVersion: '1';
      kind: 'contributions.lookup';
      items: import('../../models/api').IContributionApi[];
      counts: { total: number };
    };
    try {
      const envelope = await this.getJson<IContributionsLookupEnvelope>(
        `${BASE}/contributions/${encodeURIComponent(pluginId)}/${encodeURIComponent(contributionId)}?${params.toString()}`,
      );
      return envelope.items[0] ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Live event stream from the BFF's `/ws` channel. Multicast, every
   * subscriber receives every frame while the socket stays open. The
   * underlying `WsEventStreamService` opens the socket lazily on first
   * subscribe and reconnects with exponential backoff on abnormal close.
   */
  events(): Observable<IWsEvent> {
    return this.ws.events$;
  }

  private async getJson<T>(url: string): Promise<T> {
    try {
      return await firstValueFrom(this.http.get<T>(url));
    } catch (err) {
      throw this.translateError(err);
    }
  }

  /**
   * `PATCH` by default, optionally `POST` (used by `runScan` so the
   * route shape matches `POST /api/scan`). Both verbs share the same
   * envelope-error translation, so collapsing them under one helper
   * avoids duplicating the try/catch.
   */
  private async patchJson<T>(
    url: string,
    body: unknown,
    method: 'PATCH' | 'POST' = 'PATCH',
  ): Promise<T> {
    try {
      const obs = method === 'POST' ? this.http.post<T>(url, body) : this.http.patch<T>(url, body);
      return await firstValueFrom(obs);
    } catch (err) {
      throw this.translateError(err);
    }
  }

  /**
   * Translate an `HttpErrorResponse` (or unknown thrown value) into a
   * `DataSourceError` with the BFF envelope's `code` + `message` when
   * available. Falls back to `internal` for transport / parse failures.
   */
  private translateError(err: unknown): DataSourceError {
    if (err instanceof DataSourceError) return err;
    if (err instanceof HttpErrorResponse) {
      const envelope = parseErrorEnvelope(err.error);
      if (envelope) {
        return new DataSourceError(
          envelope.error.code,
          envelope.error.message,
          envelope.error.details,
        );
      }
      return new DataSourceError(
        'internal',
        err.message || DATA_SOURCE_TEXTS.errors.malformedResponse,
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return new DataSourceError('internal', message);
  }
}

/**
 * Build the query-string suffix (including the leading `?` when any
 * params present) for `/api/nodes`.
 */
function buildNodesQueryString(q: INodesQuery): string {
  const params = new URLSearchParams();
  if (q.kind && q.kind.length > 0) params.set('kind', q.kind.join(','));
  if (q.hasIssues !== undefined) params.set('hasIssues', String(q.hasIssues));
  if (q.path) params.set('path', q.path);
  if (q.limit !== undefined) params.set('limit', String(q.limit));
  if (q.offset !== undefined) params.set('offset', String(q.offset));
  const s = params.toString();
  return s ? `?${s}` : '';
}

function buildLinksQueryString(q: ILinksQuery): string {
  const params = new URLSearchParams();
  if (q.kind && q.kind.length > 0) params.set('kind', q.kind.join(','));
  if (q.from) params.set('from', q.from);
  if (q.to) params.set('to', q.to);
  const s = params.toString();
  return s ? `?${s}` : '';
}

function buildIssuesQueryString(q: IIssuesQuery): string {
  const params = new URLSearchParams();
  if (q.severity) params.set('severity', q.severity);
  if (q.analyzerId) params.set('analyzerId', q.analyzerId);
  if (q.node) params.set('node', q.node);
  const s = params.toString();
  return s ? `?${s}` : '';
}

/**
 * Type-guard for the BFF error envelope. Accepts only the documented
 * shape; anything else returns `null` so the caller falls back to a
 * generic `internal` error.
 */
function parseErrorEnvelope(value: unknown): IErrorEnvelopeApi | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v['ok'] !== false) return null;
  const err = v['error'];
  if (typeof err !== 'object' || err === null) return null;
  const e = err as Record<string, unknown>;
  if (typeof e['code'] !== 'string' || typeof e['message'] !== 'string') return null;
  return {
    ok: false,
    error: {
      code: e['code'],
      message: e['message'],
      details: e['details'],
    },
  };
}

/**
 * Exposed for unit tests, covers the small URL-encoding helpers
 * without going through `firstValueFrom` indirection.
 */
export const __testHooks = {
  buildNodesQueryString,
  buildLinksQueryString,
  buildIssuesQueryString,
  parseErrorEnvelope,
};
