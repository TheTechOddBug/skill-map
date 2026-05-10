/**
 * `IDataSourcePort` — the abstract data-source contract every concrete
 * implementation must satisfy. Mirrors the BFF surface (Step 14.2):
 * `/api/health`, `/api/scan`, `/api/nodes`, `/api/nodes/:pathB64`,
 * `/api/links`, `/api/issues`, `/api/graph`, `/api/config`,
 * `/api/plugins`.
 *
 * The SPA depends on this port; the factory (`data-source.factory.ts`)
 * picks an implementation based on the runtime mode token. Today only
 * `RestDataSource` (live mode) ships; `StaticDataSource` (demo mode)
 * lands at Step 14.3.b.
 *
 * Type names use `*Port` for the abstract contract and `I*` prefix for
 * option bags, per the project's type naming convention (AGENTS.md).
 */

import { InjectionToken } from '@angular/core';
import type { Observable } from 'rxjs';

import type {
  IContributionApi,
  IHealthResponseApi,
  IIssueApi,
  ILinkApi,
  IListEnvelopeApi,
  INodeApi,
  INodeDetailApi,
  IPluginItemApi,
  IPreferencesApi,
  IPreferencesPatchApi,
  IProjectConfigApi,
  IProjectPreferencesApi,
  IProjectPreferencesPatchApi,
  IScanResultApi,
} from '../../models/api';
import type { IWsEvent } from '../../models/ws-event';

/**
 * `/api/nodes` query bag. Lists are comma-joined when serialized to
 * URL params. Booleans are stringified `true`/`false`. Empty / null
 * values are omitted from the query.
 */
export interface INodesQuery {
  kind?: string[];
  hasIssues?: boolean;
  /** Glob-style path filter — see `src/server/query-adapter.ts`. */
  path?: string;
  limit?: number;
  offset?: number;
}

/**
 * `/api/links` query bag. `from` and `to` are exact `node.path` matches.
 */
export interface ILinksQuery {
  kind?: string[];
  from?: string;
  to?: string;
}

/**
 * `/api/issues` query bag. `node` is an exact `node.path` match.
 */
export interface IIssuesQuery {
  severity?: 'error' | 'warn' | 'info';
  ruleId?: string;
  node?: string;
}

/**
 * Output format for `/api/graph`. The endpoint defaults to `ascii`
 * (text/plain). Other formats are reserved for the formatter catalog.
 */
export type TGraphFormat = 'ascii' | 'json' | 'md';

/**
 * Plugin row shape returned by `/api/plugins` (list + PATCH responses).
 * Mirrors the BFF's `IPluginListItem`. The Settings view consumes the
 * full shape; the demo data source ships a static snapshot.
 */
export type TPluginItem = IPluginItemApi;

export interface IDataSourcePort {
  /** Liveness + version probe. Returns the BFF's health payload. */
  health(): Promise<IHealthResponseApi>;

  /** Full `ScanResult` (1:1 with `scan-result.schema.json`). */
  loadScan(): Promise<IScanResultApi>;

  /**
   * Trigger a fresh scan and persist it. Mirrors `POST /api/scan` —
   * the BFF runs the same `runScanWithRenames` + `persistScanResult`
   * pipeline the watcher uses, broadcasts `scan.started` /
   * `scan.completed` over WS, and returns the new `ScanResult` inline.
   *
   * Errors:
   *   - `scan-busy` (409) — another scan is already running. The UI
   *     should surface this to the user and let them retry.
   *   - `bad-query` (400) — server booted with `--no-built-ins` /
   *     `--no-plugins`; running a manual scan would persist a partial
   *     DB.
   *   - `db-missing` (500) — project DB absent. The user must run
   *     `sm scan` once on the CLI side first.
   *
   * Demo mode rejects with `code: 'demo-readonly'`.
   */
  runScan(): Promise<IScanResultApi>;

  /** Paginated, filtered list of persisted nodes. */
  listNodes(q?: INodesQuery): Promise<IListEnvelopeApi<INodeApi>>;

  /**
   * Single-node detail bundle. Returns `null` when the BFF responds
   * 404 (no such node) — callers branch on the null instead of catching.
   *
   * `opts.includeBody` (Step 14.5.a): when `true`, instructs the BFF to
   * read the markdown body from disk and attach it to `item.body`.
   * Inspector view passes `true`; other consumers (e.g. linked-nodes
   * panels that only need metadata) leave it false / unset.
   */
  getNode(path: string, opts?: { includeBody?: boolean }): Promise<INodeDetailApi | null>;

  /** Filtered list of persisted links. */
  listLinks(q?: ILinksQuery): Promise<IListEnvelopeApi<ILinkApi>>;

  /** Filtered list of persisted issues. */
  listIssues(q?: IIssuesQuery): Promise<IListEnvelopeApi<IIssueApi>>;

  /**
   * Rendered graph in the requested format. Defaults to `ascii`
   * (text/plain). Returns the formatter's verbatim output.
   */
  loadGraph(format?: TGraphFormat): Promise<string>;

  /** Project configuration as the BFF resolved it. */
  loadConfig(): Promise<IProjectConfigApi>;

  /** List of registered plugins. Mirrors `GET /api/plugins`. */
  listPlugins(): Promise<IListEnvelopeApi<TPluginItem>>;

  /**
   * Toggle a granularity=`bundle` plugin's user override. Mirrors
   * `PATCH /api/plugins/:id`. Returns the projected list — same shape
   * as `listPlugins()` — so the caller can replace its state in one
   * shot. Throws `DataSourceError` on 4xx (`bad-query` / `not-found`)
   * or 5xx (`db-missing` / `internal`). Demo mode rejects with
   * `code: 'demo-readonly'`.
   *
   * NOTE: the BFF's plugin runtime is boot-cached — the new override
   * applies on the next `sm scan` or `sm serve` restart. Callers are
   * expected to surface this caveat in the UI.
   */
  setPluginEnabled(id: string, enabled: boolean): Promise<IListEnvelopeApi<TPluginItem>>;

  /**
   * Toggle one extension under a granularity=`extension` plugin.
   * Mirrors `PATCH /api/plugins/:bundleId/extensions/:extensionId`.
   * Same response shape and error semantics as `setPluginEnabled`.
   */
  setPluginExtensionEnabled(
    bundleId: string,
    extensionId: string,
    enabled: boolean,
  ): Promise<IListEnvelopeApi<TPluginItem>>;

  /**
   * Read the user-scope preferences envelope (today: `updateCheck.enabled`).
   * Mirrors `GET /api/preferences`. Demo mode returns a sensible default
   * (no static fixture; the demo bundle is read-only).
   */
  getPreferences(): Promise<IPreferencesApi>;

  /**
   * Persist a partial patch of the user-scope preferences envelope.
   * Mirrors `PATCH /api/preferences`. Returns the post-write envelope
   * so the UI can replace its state in one shot. Throws
   * `DataSourceError` on 4xx / 5xx; demo mode rejects with
   * `code: 'demo-readonly'`.
   */
  setPreferences(patch: IPreferencesPatchApi): Promise<IPreferencesApi>;

  /**
   * Read the project-scope preferences envelope (today: the three
   * privacy-sensitive `scan.*` keys). Mirrors
   * `GET /api/project-preferences`. Demo mode returns the shipped
   * defaults so the Settings UI renders without errors.
   */
  getProjectPreferences(): Promise<IProjectPreferencesApi>;

  /**
   * Persist a partial patch of the project-scope preferences
   * envelope. Mirrors `PATCH /api/project-preferences`. Writes that
   * EXPAND the scan's disk-access surface MUST set `confirm: true`
   * in the patch body — otherwise the BFF rejects with 412
   * `confirm-required` (surfaces as `DataSourceError` with code
   * `confirm-required` and a `paths` field listing what the change
   * would expose). Demo mode rejects every write with
   * `code: 'demo-readonly'`.
   */
  setProjectPreferences(patch: IProjectPreferencesPatchApi): Promise<IProjectPreferencesApi>;

  /**
   * Phase 4 / View contribution system — lazy lookup for a single
   * contribution emitted on a single node. Used by the slot host
   * when the bulk endpoint omitted contributions because
   * `limit > bff.maxBulkContributions` (default 200). Returns `null`
   * when the contribution was not emitted for that node, when the
   * contribution is unknown, or when running in demo mode without a
   * static fixture for the lookup.
   */
  lookupContribution(
    pluginId: string,
    contributionId: string,
    path: string,
  ): Promise<IContributionApi | null>;

  /**
   * Mark `path` as favorited. PUT against `/api/favorites/:pathB64`.
   * 204 on success; throws `DataSourceError(code: 'not-found')` when the
   * path is not in the persisted scan. Idempotent — a second call
   * refreshes the timestamp without raising. The static (demo) data
   * source rejects with `code: 'demo-readonly'` because the bundle is
   * immutable.
   */
  setFavorite(path: string): Promise<void>;

  /**
   * Drop the favorite for `path`. DELETE against `/api/favorites/:pathB64`.
   * Always idempotent — un-favoriting a path that is not currently
   * favorited is a no-op. Demo data source rejects with `'demo-readonly'`.
   */
  unsetFavorite(path: string): Promise<void>;

  /**
   * WebSocket-backed event stream. In live mode, returns the
   * `WsEventStreamService` multicast observable that connects to `/ws`
   * on first subscribe. In demo mode, returns `EMPTY` (no live updates
   * — the static bundle is immutable).
   *
   * Consumers narrow events by `event.type`; unknown types MUST be
   * skipped silently per `spec/job-events.md` forward-compat rule.
   */
  events(): Observable<IWsEvent>;
}

/**
 * Injection token consumers use to resolve the active `IDataSourcePort`.
 * The factory (`dataSourceFactory`) provides this in `app.config.ts`.
 */
export const DATA_SOURCE = new InjectionToken<IDataSourcePort>('DATA_SOURCE');

/**
 * Error thrown by the data-source layer when the BFF returns an error
 * envelope (`{ ok: false, error: { code, message } }`) or when the
 * transport itself fails. The `code` mirrors the BFF's envelope code
 * so callers can branch on it.
 */
export class DataSourceError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'DataSourceError';
    this.code = code;
    this.details = details;
  }
}
