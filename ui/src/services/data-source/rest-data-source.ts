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
  IAgentPresenceApi,
  IBranchResponseApi,
  IBranchScopeApi,
  IConfigResolutionRowApi,
  IErrorEnvelopeApi,
  IFindingsEnvelopeApi,
  IFolderNodeLite,
  IHealthResponseApi,
  IMcpStatusApi,
  IIssueApi,
  IJobApi,
  IJobsEnvelopeApi,
  IJobSubmittedEnvelopeApi,
  IKindRegistryApi,
  ILinkApi,
  IListEnvelopeApi,
  INodeApi,
  INodeDetailApi,
  INodeSummaryRowApi,
  INodeProbExtensionsEnvelopeApi,
  IProbExtensionsApi,
  IPreferencesApi,
  IPreferencesPatchApi,
  IProjectConfigApi,
  IActiveProviderApi,
  IActivityCaptureStatusApi,
  IActivityInstallStatusApi,
  IActivityNodeDetailApi,
  IActivitySpawnDetailApi,
  IActivitySummaryApi,
  IActivityUninstallEnvelopeApi,
  IAgentSkillInstallEnvelopeApi,
  IAgentSkillInstallStatusApi,
  IAgentSkillUninstallEnvelopeApi,
  IActiveProviderPutEnvelopeApi,
  IProjectIgnoreApi,
  IProjectIgnorePatchApi,
  IProjectPreferencesApi,
  IProjectPreferencesPatchApi,
  IRegisteredAnnotationKeyApi,
  IRegisteredAnnotationsEnvelopeApi,
  IScanResultApi,
  IActionAppliedEnvelopeApi,
  IUpdateStatusResponseApi,
  IGithubStarsApi,
  IValueEnvelopeApi,
} from '../../models/api';
import type { IWsEvent } from '../../models/ws-event';
import { KindRegistryService } from '../kind-registry';
import { ProviderRegistryService } from '../provider-registry';
import { ContributionsRegistryService } from '../../app/services/contributions-registry';
import { WsEventStreamService } from '../ws-event-stream';
import { encodeNodePath } from './path-codec';
import {
  DataSourceError,
  type IDataSourcePort,
  type IActionDispatchOpts,
  type IIssuesQuery,
  type IJobsQuery,
  type ILinksQuery,
  type INodesQuery,
  type IPluginChange,
  type TGraphFormat,
  type TPluginItem,
} from './data-source.port';

const BASE = '/api';

@Injectable({ providedIn: 'root' })
export class RestDataSource implements IDataSourcePort {
  private readonly http: HttpClient;
  private readonly ws: WsEventStreamService;
  private readonly kindRegistry: KindRegistryService;
  private readonly providerRegistry: ProviderRegistryService;
  private readonly contributionsRegistry: ContributionsRegistryService;

  constructor(
    http?: HttpClient,
    ws?: WsEventStreamService,
    kindRegistry?: KindRegistryService,
    contributionsRegistry?: ContributionsRegistryService,
    providerRegistry?: ProviderRegistryService,
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
    this.providerRegistry = providerRegistry ?? inject(ProviderRegistryService);
  }

  async health(): Promise<IHealthResponseApi> {
    return this.getJson<IHealthResponseApi>(`${BASE}/health`);
  }

  async mcpStatus(): Promise<IMcpStatusApi> {
    return this.getJson<IMcpStatusApi>(`${BASE}/mcp/status`);
  }

  async agentPresence(): Promise<IAgentPresenceApi> {
    return this.getJson<IAgentPresenceApi>(`${BASE}/agent/presence`);
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

  /**
   * Lazy boot: scalar scan meta + stats only (`?meta=1`). The response
   * is the raw `ScanResult` (no envelope), so it carries no registry,
   * the lazy `loadFolders()` round-trip (an envelope) primes the
   * registries instead. EMPTY `nodes` / `links` / `issues` arrays keep
   * the payload tiny.
   */
  async loadScanMeta(): Promise<IScanResultApi> {
    return this.getJson<IScanResultApi>(`${BASE}/scan?meta=1`);
  }

  /**
   * Lazy boot: whole-corpus lite node list (`/api/folders`). The list
   * envelope carries the kind / provider / contributions registries, so
   * ingesting it here primes the SPA's registries before first paint.
   */
  async loadFolders(): Promise<IFolderNodeLite[]> {
    const envelope = await this.getJson<IListEnvelopeApi<IFolderNodeLite>>(
      `${BASE}/folders`,
    );
    this.ingestRegistry(envelope.kindRegistry);
    this.ingestContributionsRegistry(envelope.contributionsRegistry);
    this.ingestProviderRegistry(envelope.providerRegistry);
    return envelope.items;
  }

  /**
   * Lazy branch fetch for the graph map (`/api/branch`). Direct shape
   * (no envelope, like `/api/scan`), so it carries no registry, that is
   * primed by `loadFolders()` at boot. The scope carries the map scope
   * overrides: repeated `?path=` for includes, repeated `?exclude=` for
   * excludes, and `excludeRoot=1` when the root is excluded (the UI
   * always states the root explicitly; `0` is the wire default and is
   * omitted). An all-empty scope sends no scope params (= whole
   * corpus). `limit` (when set) can only lower the server cap.
   */
  async loadBranch(scope: IBranchScopeApi, limit?: number): Promise<IBranchResponseApi> {
    const params = new URLSearchParams();
    for (const path of scope.include) {
      if (path) params.append('path', path);
    }
    for (const path of scope.exclude) {
      if (path) params.append('exclude', path);
    }
    if (scope.excludeRoot) params.set('excludeRoot', '1');
    if (limit !== undefined) params.set('limit', String(limit));
    const query = params.toString();
    return this.getJson<IBranchResponseApi>(
      `${BASE}/branch${query ? `?${query}` : ''}`,
    );
  }

  async runScan(): Promise<IScanResultApi> {
    return this.patchJson<IScanResultApi>(`${BASE}/scan`, {}, 'POST');
  }

  async listNodes(q: INodesQuery = {}): Promise<IListEnvelopeApi<INodeApi>> {
    const params = buildNodesQueryString(q);
    const envelope = await this.getJson<IListEnvelopeApi<INodeApi>>(`${BASE}/nodes${params}`);
    this.ingestRegistry(envelope.kindRegistry);
    this.ingestContributionsRegistry(envelope.contributionsRegistry);
    this.ingestProviderRegistry(envelope.providerRegistry);
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
      this.ingestProviderRegistry(envelope.providerRegistry);
      return envelope;
    } catch (err) {
      if (err instanceof DataSourceError && err.code === 'not-found') return null;
      throw err;
    }
  }

  /**
   * Per-node AI-actions tray (`GET /api/nodes/:pathB64/findings`).
   * 404 (unknown node / missing DB) resolves to `null`, mirroring
   * `getNode`; every other failure propagates as `DataSourceError`.
   */
  async getNodeFindings(
    path: string,
    bucket?: 'dismissed' | 'fixed',
  ): Promise<IFindingsEnvelopeApi | null> {
    const encoded = encodeNodePath(path);
    try {
      const envelope = await this.getJson<IFindingsEnvelopeApi>(
        `${BASE}/nodes/${encoded}/findings${bucket ? `?${bucket}=1` : ''}`,
      );
      this.ingestRegistry(envelope.kindRegistry);
      this.ingestContributionsRegistry(envelope.contributionsRegistry);
      this.ingestProviderRegistry(envelope.providerRegistry);
      return envelope;
    } catch (err) {
      if (err instanceof DataSourceError && err.code === 'not-found') return null;
      throw err;
    }
  }

  /**
   * Per-node probabilistic launcher catalog
   * (`GET /api/nodes/:pathB64/prob-extensions`). Unwraps the single
   * envelope's `item`; 404 resolves to `null`, mirroring `getNode`.
   */
  async getNodeProbExtensions(path: string): Promise<IProbExtensionsApi | null> {
    const encoded = encodeNodePath(path);
    try {
      const envelope = await this.getJson<INodeProbExtensionsEnvelopeApi>(
        `${BASE}/nodes/${encoded}/prob-extensions`,
      );
      this.ingestRegistry(envelope.kindRegistry);
      this.ingestContributionsRegistry(envelope.contributionsRegistry);
      this.ingestProviderRegistry(envelope.providerRegistry);
      return envelope.item;
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
    this.ingestProviderRegistry(envelope.providerRegistry);
    return envelope;
  }

  async listIssues(q: IIssuesQuery = {}): Promise<IListEnvelopeApi<IIssueApi>> {
    const params = buildIssuesQueryString(q);
    const envelope = await this.getJson<IListEnvelopeApi<IIssueApi>>(`${BASE}/issues${params}`);
    this.ingestRegistry(envelope.kindRegistry);
    this.ingestContributionsRegistry(envelope.contributionsRegistry);
    this.ingestProviderRegistry(envelope.providerRegistry);
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
    this.ingestProviderRegistry(envelope.providerRegistry);
    return envelope.value;
  }

  /** `GET /api/nodes/:pathB64/summary` (direct shape; 404 -> null). */
  async getNodeSummary(path: string): Promise<INodeSummaryRowApi[] | null> {
    try {
      const payload = await this.getJson<{ items: INodeSummaryRowApi[] }>(
        `${BASE}/nodes/${encodeNodePath(path)}/summary`,
      );
      return payload.items;
    } catch (err) {
      if (err instanceof DataSourceError && err.code === 'not-found') return null;
      throw err;
    }
  }

  /** `DELETE /api/nodes/:pathB64/summary?summarizer=<id>` (204-style). */
  async deleteNodeSummary(path: string, summarizerActionId: string): Promise<void> {
    try {
      await firstValueFrom(
        this.http.delete(
          `${BASE}/nodes/${encodeNodePath(path)}/summary?summarizer=${encodeURIComponent(summarizerActionId)}`,
        ),
      );
    } catch (err) {
      throw this.translateError(err);
    }
  }

  async getConfigResolution(): Promise<IConfigResolutionRowApi[]> {
    const envelope = await this.getJson<
      IValueEnvelopeApi<{ rows: IConfigResolutionRowApi[] }>
    >(`${BASE}/config/resolution`);
    return envelope.value.rows;
  }

  async listPlugins(): Promise<IListEnvelopeApi<TPluginItem>> {
    const envelope = await this.getJson<IListEnvelopeApi<TPluginItem>>(`${BASE}/plugins`);
    this.ingestRegistry(envelope.kindRegistry);
    this.ingestContributionsRegistry(envelope.contributionsRegistry);
    this.ingestProviderRegistry(envelope.providerRegistry);
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
    this.ingestProviderRegistry(envelope.providerRegistry);
    return envelope;
  }

  async setPluginExtensionEnabled(
    pluginId: string,
    extensionId: string,
    enabled: boolean,
  ): Promise<IListEnvelopeApi<TPluginItem>> {
    const envelope = await this.patchJson<IListEnvelopeApi<TPluginItem>>(
      `${BASE}/plugins/${encodeURIComponent(pluginId)}/extensions/${encodeURIComponent(extensionId)}`,
      { enabled },
    );
    this.ingestRegistry(envelope.kindRegistry);
    this.ingestContributionsRegistry(envelope.contributionsRegistry);
    this.ingestProviderRegistry(envelope.providerRegistry);
    return envelope;
  }

  async setPluginTrusted(
    id: string,
    trusted: boolean,
  ): Promise<IListEnvelopeApi<TPluginItem>> {
    const envelope = await this.patchJson<IListEnvelopeApi<TPluginItem>>(
      `${BASE}/plugins/${encodeURIComponent(id)}/trust`,
      { trusted },
    );
    this.ingestRegistry(envelope.kindRegistry);
    this.ingestContributionsRegistry(envelope.contributionsRegistry);
    this.ingestProviderRegistry(envelope.providerRegistry);
    return envelope;
  }

  async applyPluginChanges(
    changes: ReadonlyArray<IPluginChange>,
  ): Promise<IListEnvelopeApi<TPluginItem>> {
    const envelope = await this.patchJson<IListEnvelopeApi<TPluginItem>>(
      `${BASE}/plugins`,
      { changes },
    );
    this.ingestRegistry(envelope.kindRegistry);
    this.ingestContributionsRegistry(envelope.contributionsRegistry);
    this.ingestProviderRegistry(envelope.providerRegistry);
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

  async getActiveProvider(): Promise<IActiveProviderApi> {
    return await this.getJson<IActiveProviderApi>(`${BASE}/active-provider`);
  }

  async setActiveProvider(activeProvider: string): Promise<IActiveProviderPutEnvelopeApi> {
    return await this.patchJson<IActiveProviderPutEnvelopeApi>(
      `${BASE}/active-provider`,
      { activeProvider },
    );
  }

  async acceptActiveProviderMarkers(): Promise<IActiveProviderApi> {
    // POST with no body (the endpoint takes none); `null` keeps the
    // request body empty rather than sending `{}`.
    return await this.patchJson<IActiveProviderApi>(
      `${BASE}/active-provider/accept-markers`,
      null,
      'POST',
    );
  }

  async getActivityInstallStatus(provider: string): Promise<IActivityInstallStatusApi> {
    return await this.getJson<IActivityInstallStatusApi>(
      `${BASE}/activity/install?provider=${encodeURIComponent(provider)}`,
    );
  }

  async installActivityHook(
    provider: string,
    opts?: { confirm?: boolean },
  ): Promise<IActivityInstallStatusApi> {
    return await this.patchJson<IActivityInstallStatusApi>(
      `${BASE}/activity/install`,
      opts?.confirm === true ? { provider, confirm: true } : { provider },
      'POST',
    );
  }

  async uninstallActivityHook(
    provider: string,
    opts?: { confirm?: boolean },
  ): Promise<IActivityUninstallEnvelopeApi> {
    return await this.patchJson<IActivityUninstallEnvelopeApi>(
      `${BASE}/activity/uninstall`,
      opts?.confirm === true ? { provider, confirm: true } : { provider },
      'POST',
    );
  }

  async getAgentSkillInstallStatus(provider: string): Promise<IAgentSkillInstallStatusApi> {
    return await this.getJson<IAgentSkillInstallStatusApi>(
      `${BASE}/agent/install?provider=${encodeURIComponent(provider)}`,
    );
  }

  async installAgentSkill(
    provider: string,
    opts?: { confirm?: boolean },
  ): Promise<IAgentSkillInstallEnvelopeApi> {
    return await this.patchJson<IAgentSkillInstallEnvelopeApi>(
      `${BASE}/agent/install`,
      opts?.confirm === true ? { provider, confirm: true } : { provider },
      'POST',
    );
  }

  async uninstallAgentSkill(
    provider: string,
    opts?: { confirm?: boolean },
  ): Promise<IAgentSkillUninstallEnvelopeApi> {
    return await this.patchJson<IAgentSkillUninstallEnvelopeApi>(
      `${BASE}/agent/uninstall`,
      opts?.confirm === true ? { provider, confirm: true } : { provider },
      'POST',
    );
  }

  async getActivitySummary(): Promise<IActivitySummaryApi> {
    return await this.getJson<IActivitySummaryApi>(`${BASE}/activity/summary`);
  }

  async getNodeActivity(path: string): Promise<IActivityNodeDetailApi | null> {
    const encoded = encodeNodePath(path);
    try {
      return await this.getJson<IActivityNodeDetailApi>(`${BASE}/activity/node/${encoded}`);
    } catch (err) {
      if (err instanceof DataSourceError && err.code === 'not-found') return null;
      throw err;
    }
  }

  /** `DELETE /api/activity/node/:pathB64` (204-style), the Activity clear-all. */
  async clearNodeActivity(path: string): Promise<void> {
    try {
      await firstValueFrom(
        this.http.delete(`${BASE}/activity/node/${encodeNodePath(path)}`),
      );
    } catch (err) {
      throw this.translateError(err);
    }
  }

  async getSpawnRecord(spawnId: string): Promise<IActivitySpawnDetailApi | null> {
    try {
      return await this.getJson<IActivitySpawnDetailApi>(
        `${BASE}/activity/spawns/${encodeURIComponent(spawnId)}`,
      );
    } catch (err) {
      // Unknown OR already-evicted id (the store is a bounded ring):
      // not-found is a normal value on this ephemeral surface.
      if (err instanceof DataSourceError && err.code === 'not-found') return null;
      throw err;
    }
  }

  async getActivityCapture(): Promise<IActivityCaptureStatusApi> {
    return await this.getJson<IActivityCaptureStatusApi>(`${BASE}/activity/capture`);
  }

  async setActivityCapture(body: {
    enabled: boolean;
    confirm?: boolean;
  }): Promise<IActivityCaptureStatusApi> {
    return await this.patchJson<IActivityCaptureStatusApi>(
      `${BASE}/activity/capture`,
      body.confirm === true ? { enabled: body.enabled, confirm: true } : { enabled: body.enabled },
      'POST',
    );
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

  async dispatchAction(
    actionId: string,
    nodePath: string,
    opts: IActionDispatchOpts = {},
  ): Promise<IActionAppliedEnvelopeApi> {
    // The qualified action id (`core/node-bump`) carries a slash, so each
    // segment is percent-encoded independently to land on the route's
    // `:plugin/:action` (or wildcard) path without collapsing the slash.
    const encodedId = actionId.split('/').map(encodeURIComponent).join('/');
    const body: Record<string, unknown> = { nodePath };
    if (opts.input !== undefined) body['input'] = opts.input;
    if (opts.confirm !== undefined) body['confirm'] = opts.confirm;
    if (opts.always !== undefined) body['always'] = opts.always;
    return this.patchJson<IActionAppliedEnvelopeApi>(
      `${BASE}/actions/${encodedId}`,
      body,
      'POST',
    );
  }

  /**
   * `POST /api/nodes/:pathB64/jobs`, enqueue a probabilistic extension
   * against one node. Any 4xx/5xx propagates as `DataSourceError`
   * carrying the envelope code (`no-processing-agent`, `duplicate-job`,
   * ...) so the launcher UI branches on it.
   */
  async submitNodeJob(
    nodePath: string,
    extensionId: string,
    autoFix = false,
    findingIds?: readonly number[],
  ): Promise<IJobSubmittedEnvelopeApi> {
    const encoded = encodeNodePath(nodePath);
    return this.patchJson<IJobSubmittedEnvelopeApi>(
      `${BASE}/nodes/${encoded}/jobs`,
      {
        extension: extensionId,
        autoFix,
        ...(findingIds !== undefined && findingIds.length > 0
          ? { findingIds: [...findingIds] }
          : {}),
      },
      'POST',
    );
  }

  /**
   * `POST /api/jobs`, enqueue a nodeless probabilistic Action (one that
   * declares `probNodeless`, so it takes no target). Same envelope and the
   * same `DataSourceError` propagation as `submitNodeJob`.
   */
  async submitNodelessJob(extensionId: string): Promise<IJobSubmittedEnvelopeApi> {
    return this.patchJson<IJobSubmittedEnvelopeApi>(
      `${BASE}/jobs`,
      { extension: extensionId },
      'POST',
    );
  }

  /**
   * `GET /api/jobs`, the queue projection for the workspace queue
   * inspector. Returns the registry-less `kind: 'jobs'` envelope's
   * `items`; any 4xx/5xx propagates as `DataSourceError` (via
   * `translateError`, threaded through `getJson`).
   */
  async listJobs(query: IJobsQuery = {}): Promise<IJobApi[]> {
    const params = new URLSearchParams();
    if (query.status) params.set('status', query.status);
    if (query.extension) params.set('extension', query.extension);
    if (query.node) params.set('node', query.node);
    const qs = params.toString();
    const envelope = await this.getJson<IJobsEnvelopeApi<IJobApi>>(
      `${BASE}/jobs${qs ? `?${qs}` : ''}`,
    );
    return envelope.items;
  }

  /**
   * `POST /api/jobs/:jobId/cancel`, cancel an active queued/running job.
   * Answers `204 No Content`, so this goes through the raw client (the
   * `patchJson` helper is typed around a JSON payload) with the same
   * envelope-error translation, mirroring the favorites mutations: any
   * 4xx/5xx (`job-terminal`, `not-found`, ...) propagates as
   * `DataSourceError` so the launcher UI branches on the code.
   */
  async cancelJob(jobId: string): Promise<void> {
    try {
      await firstValueFrom(this.http.post(`${BASE}/jobs/${encodeURIComponent(jobId)}/cancel`, null));
    } catch (err) {
      throw this.translateError(err);
    }
  }

  /** `POST /api/jobs/cancel-all`, cancel every active job. Answers `204`. */
  async cancelAllJobs(): Promise<void> {
    try {
      await firstValueFrom(this.http.post(`${BASE}/jobs/cancel-all`, null));
    } catch (err) {
      throw this.translateError(err);
    }
  }

  /**
   * `POST /api/nodes/:pathB64/findings/:id/dismiss` (204-style raw post,
   * mirror of `cancelJob`; `confirm-required` / `finding-not-dismissible`
   * / `not-found` propagate as `DataSourceError`).
   */
  async dismissFinding(
    nodePath: string,
    findingId: number,
    opts: { confirm?: boolean; always?: boolean; class?: boolean } = {},
  ): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post(
          `${BASE}/nodes/${encodeNodePath(nodePath)}/findings/${findingId}/dismiss`,
          opts,
        ),
      );
    } catch (err) {
      throw this.translateError(err);
    }
  }

  /**
   * `POST /api/nodes/:pathB64/findings/:id/reopen` (204-style raw post):
   * clear a row's resolution back to open (the row-dismiss / fixed
   * inverse; no sidecar, no consent).
   */
  async reopenFinding(nodePath: string, findingId: number): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post(
          `${BASE}/nodes/${encodeNodePath(nodePath)}/findings/${findingId}/reopen`,
          {},
        ),
      );
    } catch (err) {
      throw this.translateError(err);
    }
  }

  /** `POST /api/nodes/:pathB64/findings/:id/resolve` (204-style raw post). */
  async resolveFinding(nodePath: string, findingId: number, note?: string): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post(
          `${BASE}/nodes/${encodeNodePath(nodePath)}/findings/${findingId}/resolve`,
          note !== undefined ? { note } : {},
        ),
      );
    } catch (err) {
      throw this.translateError(err);
    }
  }

  /**
   * `DELETE /api/nodes/:pathB64/findings/:id` (204-style; hard row
   * delete; the consent flags ride the body for the orphan-suppression
   * lift on a dismissed class's last row).
   */
  async deleteFinding(
    nodePath: string,
    findingId: number,
    opts: { confirm?: boolean; always?: boolean } = {},
  ): Promise<void> {
    try {
      await firstValueFrom(
        this.http.delete(`${BASE}/nodes/${encodeNodePath(nodePath)}/findings/${findingId}`, {
          body: opts,
        }),
      );
    } catch (err) {
      throw this.translateError(err);
    }
  }

  /** `POST /api/nodes/:pathB64/findings/undismiss` (204-style raw post). */
  async undismissFinding(
    nodePath: string,
    entry: { extension: string; type?: string },
    opts: { confirm?: boolean; always?: boolean } = {},
  ): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post(`${BASE}/nodes/${encodeNodePath(nodePath)}/findings/undismiss`, {
          ...entry,
          ...opts,
        }),
      );
    } catch (err) {
      throw this.translateError(err);
    }
  }

  /**
   * `POST /api/nodes/:pathB64/issues/dismiss` (204-style raw post, mirror
   * of `dismissFinding`; `confirm-required` / `not-found` propagate as
   * `DataSourceError`). `analyzer` / `value` travel VERBATIM (the row's
   * short `analyzerId` and its `data.target`).
   */
  async dismissIssue(
    nodePath: string,
    analyzer: string,
    value: string,
    opts: { confirm?: boolean; always?: boolean } = {},
  ): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post(`${BASE}/nodes/${encodeNodePath(nodePath)}/issues/dismiss`, {
          analyzer,
          value,
          ...opts,
        }),
      );
    } catch (err) {
      throw this.translateError(err);
    }
  }

  /**
   * `POST /api/jobs/prune[?status=]`, delete terminal jobs now (all terminal
   * states, or just the given one). Answers `204`.
   */
  async pruneJobs(status?: 'completed' | 'failed' | 'cancelled'): Promise<void> {
    const url = status ? `${BASE}/jobs/prune?status=${status}` : `${BASE}/jobs/prune`;
    try {
      await firstValueFrom(this.http.post(url, null));
    } catch (err) {
      throw this.translateError(err);
    }
  }

  async getUpdateStatus(): Promise<IUpdateStatusResponseApi> {
    return this.getJson<IUpdateStatusResponseApi>(`${BASE}/update-status`);
  }

  async getGithubStars(): Promise<IGithubStarsApi> {
    return this.getJson<IGithubStarsApi>(`${BASE}/github-stars`);
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
   * Refresh the cached provider registry from any payload-bearing
   * envelope. Sibling of `ingestRegistry` for the `providerRegistry`
   * field. Sentinel / action-result / older envelopes carry `undefined`,
   * which the service treats as a no-op.
   */
  private ingestProviderRegistry(
    payload: import('../../models/api').IProviderRegistryApi | undefined,
  ): void {
    if (payload) this.providerRegistry.ingest(payload);
  }

  /**
   * Phase 4 / View contribution system, refresh the cached
   * contributions registry from any payload-bearing envelope. Mirror
   * of `ingestRegistry` for the parallel `contributionsRegistry`
   * field. Sentinel envelopes (`health`, `scan`, `graph`) and
   * action-result envelopes (`action.applied`) carry `undefined`,
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
  if (q.nodes && q.nodes.length > 0) params.set('nodes', q.nodes.join(','));
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
