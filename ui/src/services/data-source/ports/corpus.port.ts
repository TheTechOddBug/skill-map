/**
 * `ICorpusPort`, the scan-corpus read surface plus the two node-level
 * favorite writes. Mirrors the BFF's corpus endpoints: `/api/health`,
 * `/api/scan`, `/api/folders`, `/api/branch`, `/api/nodes`,
 * `/api/nodes/:pathB64`, `/api/links`, `/api/issues`, `/api/graph`,
 * `/api/config`, `/api/contributions/...`, `/api/favorites/:pathB64`.
 *
 * One of the domain ports composed into `IDataSourcePort`
 * (`../data-source.port.ts`); consumers keep injecting the composed
 * port via `DATA_SOURCE`, the split exists so each domain's contract
 * grows in its own file instead of one 600-line interface.
 */

import type {
  IConfigResolutionRowApi,
  IBranchResponseApi,
  IContributionApi,
  IFindingsEnvelopeApi,
  IFolderNodeLite,
  IHealthResponseApi,
  IMcpStatusApi,
  IIssueApi,
  ILinkApi,
  IListEnvelopeApi,
  INodeApi,
  INodeDetailApi,
  INodeSummaryRowApi,
  IProbExtensionsApi,
  IProjectConfigApi,
  IScanResultApi,
} from '../../../models/api';

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

export interface ICorpusPort {
  /** Liveness + version probe. Returns the BFF's health payload. */
  health(): Promise<IHealthResponseApi>;

  /**
   * Live MCP-connection probe (`GET /api/mcp/status`). Reports whether
   * `/mcp` is exposed and whether at least one client is currently
   * connected (scope-agnostic live session count).
   */
  mcpStatus(): Promise<IMcpStatusApi>;

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

  /**
   * `GET /api/config/resolution`: the effective config flattened to
   * leaf rows with per-key layer provenance (the Settings > About
   * hierarchy viewer). Secret-typed plugin settings arrive MASKED. The
   * static (demo) source returns an empty list (no layered project).
   */
  getConfigResolution(): Promise<IConfigResolutionRowApi[]>;

  /**
   * `GET /api/nodes/:pathB64/summary`: the node's stored semantic
   * summaries (recorded by a summarizer Action through the job queue),
   * each with its server-derived `stale` flag. Returns `null` on 404
   * (unknown node / missing DB), mirroring `getNode`; a summarized-never
   * node returns an empty array. Demo returns `[]`.
   */
  getNodeSummary(path: string): Promise<INodeSummaryRowApi[] | null>;

  /**
   * `DELETE /api/nodes/:pathB64/summary?summarizer=<id>`: hard-delete
   * the node's stored summary for that action (the block's delete X).
   * A regenerable machine judgment, no consent. Resolves on `204`; the
   * caller re-fetches. Demo rejects `'demo-readonly'`.
   */
  deleteNodeSummary(path: string, summarizerActionId: string): Promise<void>;

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
   * Per-node AI-actions tray (`GET /api/nodes/:pathB64/findings`, Step 16
   * piece 1). Returns the `findings` envelope: the needs-attention rows
   * in `items` (the `sm findings -n <path>` default view; stale rows
   * ride inline with their per-row `stale` flag) with the excluded-count
   * honesty pair on `counts` (`dismissedExcluded` / `fixedExcluded`) so
   * the UI can render the same "N dismissed, M fixed hidden" line as the
   * CLI. `bucket` narrows to ONE hidden bucket instead (the
   * `?dismissed=1` / `?fixed=1` filters), backing the tray's reveal
   * toggles. Returns `null` when the BFF responds 404 (unknown node /
   * missing DB), mirroring `getNode`. The static (demo) data source
   * returns an empty tray (the bundle records no AI actions).
   */
  getNodeFindings(
    path: string,
    bucket?: 'dismissed' | 'fixed',
  ): Promise<IFindingsEnvelopeApi | null>;

  /**
   * Per-node probabilistic launcher catalog
   * (`GET /api/nodes/:pathB64/prob-extensions`, Step 16), classified
   * manifest-mechanically: `finders` are probabilistic Analyzers
   * matching the node that HAVE a fixer (each entry carries `fixerIds`
   * plus `hasOpenFindings`, driving the two-state Detect ⇄ Fix button);
   * `standalone` are finders WITHOUT a fixer plus probabilistic Actions
   * with no `analyzerIds` (single-action buttons). Each entry carries the
   * live queue `state` (`idle` / `queued` / `running`) for this (node,
   * extension) pair. Returns the unwrapped `item`; `null` on a 404
   * (unknown node / missing DB). The static (demo) data source returns
   * the empty catalog.
   */
  getNodeProbExtensions(path: string): Promise<IProbExtensionsApi | null>;

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
}
