/**
 * `IDataSourcePort`, the abstract data-source contract every concrete
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
  IActiveProviderApi,
  IActiveProviderPutEnvelopeApi,
  IBranchResponseApi,
  IFolderNodeLite,
  IProjectIgnoreApi,
  IProjectIgnorePatchApi,
  IProjectPreferencesApi,
  IProjectPreferencesPatchApi,
  IRegisteredAnnotationKeyApi,
  IScanResultApi,
  ISidecarBumpedEnvelopeApi,
  IActionAppliedEnvelopeApi,
  IUpdateStatusResponseApi,
} from '../../models/api';
import type { IWsEvent } from '../../models/ws-event';

/**
 * Options for `bumpSidecar`. Mirrors `POST /api/sidecar/bump` body.
 */
export interface ISidecarBumpOpts {
  /**
   * Force the bump on a fresh node (silent no-op per the Action spec).
   * UI default is `false`, the bump button is disabled when the
   * overlay reports `fresh`.
   */
  force?: boolean;
  /**
   * Consent for `.sm` sidecar writes in this project. The BFF gates the
   * first `.sm` write behind `allowEditSmFiles` (default `false`); when
   * the flag is still `false` and `confirm` is omitted / `false`, the
   * server answers 412 with `code: 'confirm-required'`.
   */
  confirm?: boolean;
}

/**
 * Options for `dispatchAction`. Mirrors the `POST /api/actions/:qualifiedId`
 * body beyond the (required) `nodePath`.
 */
export interface IActionDispatchOpts {
  /**
   * Action-defined input bag (e.g. set-stability's target enum value).
   * Reserved for Steps 2+; the bump action ignores it. Passed verbatim
   * to the kernel Action's `invoke()`.
   */
  input?: unknown;
  /**
   * Consent for `.sm` sidecar writes in this project. When the
   * `allowEditSmFiles` flag is still `false` and `confirm` is omitted /
   * `false`, the BFF answers 412 `confirm-required`.
   */
  confirm?: boolean;
  /**
   * Persist the consent forever (flips the project-wide
   * `allowEditSmFiles` flag) instead of granting it for this one write.
   * Implies `confirm`. Only sent when the user ticked "always allow" in
   * the consent dialog.
   */
  always?: boolean;
}

/**
 * `/api/nodes` query bag. Lists are comma-joined when serialized to
 * URL params. Booleans are stringified `true`/`false`. Empty / null
 * values are omitted from the query.
 */
export interface INodesQuery {
  kind?: string[];
  hasIssues?: boolean;
  /** Glob-style path filter, see `src/server/query-adapter.ts`. */
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
 * `/api/issues` query bag. `node` is an exact `node.path` match;
 * `nodes` is a multi-path variant for surfaces (linked-nodes panel)
 * that need issues for a focused node + its neighbours in one
 * round-trip. Passing both narrows further (intersection: only issues
 * matching `node` AND intersecting `nodes`).
 */
export interface IIssuesQuery {
  severity?: 'error' | 'warn' | 'info';
  analyzerId?: string;
  node?: string;
  nodes?: readonly string[];
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

/**
 * One entry in the bulk `PATCH /api/plugins` body. Mirrors the BFF's
 * `IBulkChange`: an `id` (a bare plugin id `claude` for the cascade
 * macro, or a qualified `<plugin>/<ext>` id `core/node-stability`) plus at
 * least one of `enabled` (toggle delta) / `settings` (per-setting value
 * patch). `settings` REQUIRES a qualified id; values are real JSON,
 * already coerced to the declared input-type by the client. A change
 * carries whichever axis actually moved, never an `{ id }`-only entry.
 */
export interface IPluginChange {
  id: string;
  enabled?: boolean;
  settings?: Record<string, unknown>;
}

export interface IDataSourcePort {
  /** Liveness + version probe. Returns the BFF's health payload. */
  health(): Promise<IHealthResponseApi>;

  /** Full `ScanResult` (1:1 with `scan-result.schema.json`). */
  loadScan(): Promise<IScanResultApi>;

  /**
   * Lightweight scan meta (`GET /api/scan?meta=1`). Returns a
   * `ScanResult` with EMPTY `nodes` / `links` / `issues` arrays but real
   * `stats` counts and the scalar meta (`scannedAt`, `roots`,
   * `providers`, `scannedBy`, `tokenizer?`, `scanCeiling`,
   * `scanTruncated`, `maxRenderNodes`, `oversizedFiles`). Cheap; feeds
   * the header + the scan-truncated / skipped-files banners without
   * hydrating the whole corpus.
   */
  loadScanMeta(): Promise<IScanResultApi>;

  /**
   * Whole-corpus lightweight node list (`GET /api/folders`). One
   * `IFolderNodeLite` per scanned node (`{ path, kind, errorCount,
   * warnCount }`), no pagination. Feeds the folders tree, text search,
   * kind filter, and the per-folder severity badges.
   */
  loadFolders(): Promise<IFolderNodeLite[]>;

  /**
   * Branch projection for the graph map (`GET /api/branch?path=<prefix>
   * &path=<prefix>&...&limit=<n>`). `paths` is the multi-prefix
   * selection (folder prefixes and / or exact leaf paths); an empty
   * array = whole-corpus root. The response is the UNION of the subtrees
   * under every prefix, returning the first `branch.rendered` nodes in
   * stable path order, capped at the scan's `maxRenderNodes`; `links`
   * only where both endpoints are in `nodes`; `issues` only those
   * touching `nodes`. `limit` can only LOWER the cap (clamped to
   * `[1, maxRenderNodes]` server-side).
   */
  loadBranch(paths: string[], limit?: number): Promise<IBranchResponseApi>;

  /**
   * Trigger a fresh scan and persist it. Mirrors `POST /api/scan`,
   * the BFF runs the same `runScanWithRenames` + `persistScanResult`
   * pipeline the watcher uses, broadcasts `scan.started` /
   * `scan.completed` over WS, and returns the new `ScanResult` inline.
   *
   * Errors:
   *   - `scan-busy` (409), another scan is already running. The UI
   *     should surface this to the user and let them retry.
   *   - `bad-query` (400), server booted with `--no-built-ins` /
   *     `--no-plugins`; running a manual scan would persist a partial
   *     DB.
   *   - `db-missing` (500), project DB absent. The user must run
   *     `sm scan` once on the CLI side first.
   *
   * Demo mode rejects with `code: 'demo-readonly'`.
   */
  runScan(): Promise<IScanResultApi>;

  /** Paginated, filtered list of persisted nodes. */
  listNodes(q?: INodesQuery): Promise<IListEnvelopeApi<INodeApi>>;

  /**
   * Single-node detail bundle. Returns `null` when the BFF responds
   * 404 (no such node), callers branch on the null instead of catching.
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
   * `PATCH /api/plugins/:id`. Returns the projected list, same shape
   * as `listPlugins()`, so the caller can replace its state in one
   * shot. Throws `DataSourceError` on 4xx (`bad-query` / `not-found`)
   * or 5xx (`db-missing` / `internal`). Demo mode rejects with
   * `code: 'demo-readonly'`.
   *
   * Apply window: the override is honoured on the next scan (manual
   * via `runScan()` / `sm scan`, automatic via watcher batch), the
   * BFF rebuilds the resolver from `config_plugins` per batch.
   * Exception: plugins whose row carries `startsAsDisabled: true`
   * still need an `sm serve` restart to re-engage (their handlers
   * were never loaded into memory at boot).
   *
   * Kept on the port for CLI parity (`sm plugins enable / disable`)
   * and external automation; the Settings modal uses
   * `applyPluginChanges` for buffered multi-row edits.
   */
  setPluginEnabled(id: string, enabled: boolean): Promise<IListEnvelopeApi<TPluginItem>>;

  /**
   * Toggle one extension under a granularity=`extension` plugin.
   * Mirrors `PATCH /api/plugins/:pluginId/extensions/:extensionId`.
   * Same response shape and error semantics as `setPluginEnabled`.
   */
  setPluginExtensionEnabled(
    pluginId: string,
    extensionId: string,
    enabled: boolean,
  ): Promise<IListEnvelopeApi<TPluginItem>>;

  /**
   * Grant (`trusted: true`) or revoke (`trusted: false`) LOCAL import
   * trust for a single plugin. Mirrors `PATCH /api/plugins/:id/trust`
   * with body `{ trusted }`; `id` MUST be a bare plugin id (no slash).
   * This is the security axis, orthogonal to the enable toggles: a
   * plugin runs only when it is both enabled (config) AND trusted (this
   * write). The grant is per-machine and never travels in a commit.
   *
   * Returns the same `IListEnvelopeApi<TPluginItem>` shape as
   * `listPlugins()` reflecting the post-write `trusted` projection, so
   * the caller can replace its state in one shot. Built-ins and locked
   * ids reject with `code: 'locked'` (403); demo mode rejects with
   * `code: 'demo-readonly'`.
   *
   * Apply window: granting trust lets the plugin's code import on the
   * next scan / `sm serve` restart (handlers load on restart, like the
   * `startsAsDisabled` case); revoking reverts it to discovered-but-
   * unexecuted. Does NOT touch the enable axis.
   */
  setPluginTrusted(id: string, trusted: boolean): Promise<IListEnvelopeApi<TPluginItem>>;

  /**
   * Apply a buffered batch of plugin changes atomically. Mirrors the
   * bulk `PATCH /api/plugins` endpoint. Each change carries an `id`
   * (plugin id `claude`, or qualified `<plugin>/<ext>` id
   * `core/node-stability`) plus a toggle delta (`enabled`), a per-setting
   * value patch (`settings`), or both; the BFF dispatcher branches on
   * the slash the same way the per-id PATCHes do. `settings` requires a
   * qualified id and ships only the keys that changed, as real JSON.
   *
   * All-or-nothing: a single invalid entry (unknown id, granularity
   * mismatch, lock, bad setting value) rejects the whole batch and the
   * DB is not touched. The error's `details.id` carries the offending
   * entry so the Settings modal can pinpoint the row that broke the
   * apply.
   *
   * Returns the same `IListEnvelopeApi<TPluginItem>` shape as
   * `listPlugins()` with the post-write state. Demo mode rejects with
   * `code: 'demo-readonly'`.
   */
  applyPluginChanges(
    changes: ReadonlyArray<IPluginChange>,
  ): Promise<IListEnvelopeApi<TPluginItem>>;

  /**
   * Read the per-machine preferences envelope (today: `updateCheck.enabled`,
   * persisted at `~/.skill-map/settings.json`, the single home-reads
   * exception). Mirrors `GET /api/preferences`. Demo mode returns a
   * sensible default (no static fixture; the demo bundle is read-only).
   */
  getPreferences(): Promise<IPreferencesApi>;

  /**
   * Persist a partial patch of the per-machine preferences envelope.
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
   * EXPAND a surface MUST set `confirm: true` in the patch body,
   * otherwise the BFF rejects with 412 `confirm-required` (surfaces
   * as `DataSourceError` with code `confirm-required` and a `paths`
   * field listing what the change would expose). Two surface-
   * expanding sub-keys ride this route: `scan.referencePaths` (disk
   * access outside the project) and `pluginTrust.projectEnabled`
   * (local code-execution trust for every enabled plugin). Demo mode
   * rejects every write with `code: 'demo-readonly'`.
   */
  setProjectPreferences(patch: IProjectPreferencesPatchApi): Promise<IProjectPreferencesApi>;

  /**
   * Read the active `.skillmapignore` patterns (project-root file).
   * Mirrors `GET /api/project-ignore`. Comments and blank lines are
   * filtered server-side; only the active pattern list is on the
   * wire. Demo mode returns `{ patterns: [] }`.
   */
  getProjectIgnore(): Promise<IProjectIgnoreApi>;

  /**
   * Replace the active `.skillmapignore` patterns. Mirrors
   * `PATCH /api/project-ignore`. The server preserves any comments
   * and blank lines from the prior file; new patterns append at the
   * end. Validation (non-empty, no control chars, no duplicates) is
   * enforced server-side, the UI rejects locally too to give an
   * immediate error. Demo mode rejects with `code: 'demo-readonly'`.
   */
  setProjectIgnore(patch: IProjectIgnorePatchApi): Promise<IProjectIgnoreApi>;

  /**
   * Read the active provider lens envelope. Mirrors
   * `GET /api/active-provider`. Carries the resolved lens (always a
   * concrete id, `markdown` when no marker is present), the filesystem
   * auto-detected provider list, the source the value came from, and
   * `selectable` (the enabled Provider ids the dropdown may offer).
   * Used by the Settings UI's Project section to render the lens
   * dropdown. Demo mode returns
   * `{ activeProvider: 'markdown', detected: [], source: 'default', selectable: [] }`.
   */
  getActiveProvider(): Promise<IActiveProviderApi>;

  /**
   * Switch the active provider lens. Mirrors
   * `PUT /api/active-provider`. The server atomically drops the
   * scan_* DB zone after persisting the new lens (see
   * `spec/architecture.md` §Active Provider Lens), the response
   * envelope's `switch.dropped` field reports what was cleared so
   * the UI can prompt the operator to run `sm scan`. Demo mode
   * rejects with `code: 'demo-readonly'`.
   */
  setActiveProvider(activeProvider: string): Promise<IActiveProviderPutEnvelopeApi>;

  /**
   * Reconcile the persisted provider-marker snapshot with what the
   * filesystem currently shows, clearing any pending drift. Mirrors
   * `POST /api/active-provider/accept-markers` (no request body). Returns
   * the SAME refreshed `GET /api/active-provider` envelope, now with
   * `markerDrift: null`. This is the "Dismiss" action behind the
   * provider-marker drift notice: it clears the drift permanently and
   * only re-surfaces if a later, different marker change occurs. Demo
   * mode is a read-only no-op that returns the baked envelope unchanged.
   */
  acceptActiveProviderMarkers(): Promise<IActiveProviderApi>;

  /**
   * Phase 4 / View contribution system, lazy lookup for a single
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
   * path is not in the persisted scan. Idempotent, a second call
   * refreshes the timestamp without raising. The static (demo) data
   * source rejects with `code: 'demo-readonly'` because the bundle is
   * immutable.
   */
  setFavorite(path: string): Promise<void>;

  /**
   * Drop the favorite for `path`. DELETE against `/api/favorites/:pathB64`.
   * Always idempotent, un-favoriting a path that is not currently
   * favorited is a no-op. Demo data source rejects with `'demo-readonly'`.
   */
  unsetFavorite(path: string): Promise<void>;

  /**
   * `POST /api/sidecar/bump`. Returns the success envelope on 200;
   * throws `DataSourceError` on any 4xx/5xx (the caller branches on
   * `code`). Demo mode rejects with `'demo-readonly'`.
   *
   * The success path does NOT update the in-memory node store directly
   *, the `sidecar.bumped` WS event broadcast by the BFF feeds the
   * `SidecarService` subscription that owns the patch, so the card
   * and inspector re-render via the same path the CLI / pre-commit
   * hook would trigger.
   */
  bumpSidecar(nodePath: string, opts?: ISidecarBumpOpts): Promise<ISidecarBumpedEnvelopeApi>;

  /**
   * `POST /api/actions/:qualifiedId`, the generic action-dispatch
   * endpoint. Resolves the kernel Action by qualified id (`core/node-bump`,
   * `core/node-set-stability`, ...), invokes it against `nodePath`, and
   * materialises any `.sm` writes through the consent gate. Returns the
   * success envelope on 200; throws `DataSourceError` on any 4xx/5xx so
   * the caller branches on `code`.
   *
   * Consent: the first `.sm` write in a project where `allowEditSmFiles`
   * is `false` answers 412 `code: 'confirm-required'` with
   * `details.key === 'allowEditSmFiles'`. The caller re-dispatches with
   * `{ confirm: true }` (one-shot) or `{ confirm: true, always: true }`
   * (persist) after the user accepts the consent dialog.
   *
   * The success path does NOT patch the in-memory node store directly,
   * the `action.applied` WS event broadcast by the BFF feeds the
   * loader's subscription so the card and inspector re-render via the
   * same path the CLI / pre-commit hook would trigger. Demo mode
   * rejects with `code: 'demo-readonly'`.
   */
  dispatchAction(
    actionId: string,
    nodePath: string,
    opts?: IActionDispatchOpts,
  ): Promise<IActionAppliedEnvelopeApi>;

  /**
   * `GET /api/update-status`. Always 200 in live mode. Demo mode
   * returns a synthetic "up-to-date" snapshot so the topbar renders
   * cleanly without an `/api/*` round-trip.
   */
  getUpdateStatus(): Promise<IUpdateStatusResponseApi>;

  /**
   * `GET /api/annotations/registered`. Returns the runtime annotation
   * contribution catalog declared by plugin manifests. Demo mode
   * returns `[]` so consumers render every namespace as "unregistered"
   *, same fallback the live path takes when the fetch fails.
   */
  getRegisteredAnnotations(): Promise<readonly IRegisteredAnnotationKeyApi[]>;

  /**
   * WebSocket-backed event stream. In live mode, returns the
   * `WsEventStreamService` multicast observable that connects to `/ws`
   * on first subscribe. In demo mode, returns `EMPTY` (no live updates
   *, the static bundle is immutable).
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
