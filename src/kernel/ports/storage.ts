/**
 * `StoragePort`, the kernel's persistence boundary. Driving adapters
 * (CLI, future server, in-memory test harness) consume this surface
 * exclusively; nothing in `cli/**` should reach into the SQLite
 * adapter's internal helpers (free functions on
 * `kernel/adapters/sqlite/*`) directly. Phase F of the
 * storage-port-promotion refactor finishes that hardening; A-E grow
 * the port enough that the CLI has somewhere to land.
 *
 * The port is namespaced by domain (`scans`, `issues`, `enrichments`,
 * etc.), explicitly NOT a generic `port.query<T>(sql)`. Each
 * namespace's methods name an operation the kernel cares about; the
 * adapter translates to its persistence engine's idioms.
 *
 * Phase A lands the **scans / issues / enrichments / transaction**
 * namespaces, the core scan pipeline. The remaining namespaces
 * (history / jobs / pluginConfig / migrations / pluginMigrations)
 * arrive in subsequent phases. The port shape declared here is the
 * Phase A subset; later phases extend it without reshaping what
 * lands today.
 */

import type {
  ExecutionRecord,
  HistoryStats,
  Issue,
  Node,
  ScanResult,
} from '../types.js';
import type {
  IEnrichmentRecord,
  IExtractorRunRecord,
  IPersistedEnrichment,
} from '../orchestrator.js';
import type { IPriorExtractorRun } from '../adapters/sqlite/scan-load.js';
import type { IUpdateCheckCache } from '../update-check/index.js';
import type { IDiscoveredPlugin } from './plugin-loader.js';
import type {
  IApplyOptions,
  IApplyResult,
  IBranchProjection,
  IHistoryStatsRange,
  IIssueIncidenceCount,
  IIssueListFilter,
  IIssueListResult,
  IIssueRow,
  IListExecutionsFilter,
  ILiteNode,
  IMigrateNodeFksReport,
  IMigrationFile,
  IMigrationPlan,
  INodeBundle,
  INodeCounts,
  INodeFilter,
  IPersistedContribution,
  IPersistOptions,
  IPluginApplyOptions,
  IPluginApplyResult,
  IPluginConfigRow,
  IPluginMigrationFile,
  IPluginMigrationPlan,
  IPruneResult,
  THistoryStatsPeriod,
} from '../types/storage.js';

/**
 * Subset of `StoragePort` exposed inside a `transaction(fn)` callback.
 * Lifecycle methods are intentionally omitted, a transaction that
 * tries to `init()` the adapter mid-flight is a category error.
 *
 * Every callable in the subset MUST run on the same underlying
 * transaction handle the adapter opened for the callback. Adapters
 * are responsible for that wiring; consumers only see the namespace
 * surfaces.
 */
export interface ITransactionalStorage {
  scans: {
    persist(result: ScanResult, opts?: IPersistOptions): Promise<void>;
  };
  issues: {
    deleteById(id: number): Promise<void>;
    insert(issue: Issue): Promise<void>;
  };
  enrichments: {
    /**
     * Upsert a batch of fresh enrichment records produced by an
     * extractor pass. Composite PK is `(nodePath, extractorId)`;
     * conflict → replace. Every row lands with `stale = 0` (the
     * caller just refreshed it; ROADMAP §B.10, staleness is
     * computed downstream when the body hash changes again).
     */
    upsertMany(records: IEnrichmentRecord[]): Promise<void>;
  };
  history: {
    /**
     * Repoint every `state_*` reference from `fromPath` to `toPath`.
     * Atomic across the four state tables; the report flags any
     * composite-PK collisions so callers can diagnose them.
     * `sm orphans reconcile` / `undo-rename` and the scan-time
     * rename heuristic are the canonical consumers.
     */
    migrateNodeFks(from: string, to: string): Promise<IMigrateNodeFksReport>;
  };
  // jobs / pluginConfig namespaces land in Phases C-D.
}

export interface StoragePort {
  // --- lifecycle ---------------------------------------------------------
  init(): Promise<void>;
  close(): Promise<void>;

  // --- scans namespace ---------------------------------------------------
  scans: {
    /**
     * Persist a fresh `ScanResult` (replace-all on the scan zone).
     * Called by `sm scan` after the orchestrator returns. The renames /
     * extractor-runs / enrichments side bags ride along inside the
     * same transaction, the call is atomic from the caller's view.
     */
    persist(result: ScanResult, opts?: IPersistOptions): Promise<void>;
    /**
     * Hydrate the persisted `ScanResult`. Returns the snapshot the
     * scan zone holds today (including external-Provider kinds,
     * `node.kind` is open string per `node.schema.json`).
     */
    load(): Promise<ScanResult>;
    /**
     * Metadata-only `ScanResult`: every scalar field plus real
     * `COUNT(*)` stats, but empty `nodes` / `links` / `issues` arrays.
     * Reads only the single `scan_meta` row plus the counts, never the
     * node / link / issue tables, so the BFF `GET /api/scan?meta=1` boot
     * fetch stays cheap on a large corpus. The SPA pairs it with
     * `/api/folders` (tree) and `/api/branch` (map).
     */
    loadMeta(): Promise<ScanResult>;
    /**
     * Spec § A.9, fine-grained extractor-runs cache breadcrumbs.
     * Returns `Map<nodePath, Map<qualifiedExtractorId, IPriorExtractorRun>>`.
     * Inner value carries `bodyHash` AND `sidecarAnnotationsHash`; both
     * participate in the cache hit condition for every Extractor.
     */
    loadExtractorRuns(): Promise<Map<string, Map<string, IPriorExtractorRun>>>;
    /** Universal enrichment layer, every persisted `(node, extractor)` pair. */
    loadNodeEnrichments(): Promise<IPersistedEnrichment[]>;
    /**
     * Row counts for `scan_nodes` / `scan_links` / `scan_issues`.
     * Used by `sm scan`'s "refusing to wipe a populated DB" guard.
     */
    countRows(): Promise<INodeCounts>;
    /** Row-level filter for `sm list`. Open `kind` (matches `Node.kind`). */
    findNodes(filter: INodeFilter): Promise<Node[]>;
    /**
     * Bundled fetch for `sm show <path>`. Returns `null` if the node
     * is not in the persisted scan.
     */
    findNode(path: string): Promise<INodeBundle | null>;
    /**
     * Lightweight full-corpus node list `{ path, kind }[]`, ordered by
     * `path` ASC. Backs the BFF `/api/folders` endpoint: the SPA folders
     * tree renders the whole scanned corpus (up to `scan.maxScan`)
     * without hydrating the full `ScanResult`. Pushes the projection to
     * SQL (`SELECT path, kind`), never loads the rest of the row.
     */
    listLiteNodes(): Promise<ILiteNode[]>;
    /**
     * Per-node issue incidence counts by severity, keyed by node path.
     * Expands every `scan_issues.node_ids_json` array with SQLite
     * `json_each` and groups by `(value, severity)` so the count is
     * computed in SQL, not by loading every issue into memory. Only
     * error / warn severities are tallied (the SPA badges ignore
     * `info`); nodes with no error / warn issue are absent from the
     * map. Backs the `errorCount` / `warnCount` fields on `/api/folders`.
     */
    issueCountsByPath(): Promise<Map<string, IIssueIncidenceCount>>;
    /**
     * Effective map-render cap recorded by the latest scan
     * (`scan_meta.max_render_nodes`). Returns the design default (256)
     * when no `scan_meta` row exists (DB freshly migrated / never
     * scanned). Backs the `/api/branch` cap default + clamp ceiling.
     */
    effectiveMaxRenderNodes(): Promise<number>;
    /**
     * Prefix-union, capped graph projection for the BFF `/api/branch`
     * endpoint. A node is in the branch when, for ANY prefix in
     * `prefixes`, its `path === prefix` or starts with `prefix + '/'`;
     * the per-prefix subtrees are UNIONed. An empty `prefixes` array
     * selects the whole corpus. Identical prefixes are de-duped
     * defensively. `nodes` is the first `limit` matching nodes of the
     * union in stable path order (`ORDER BY path LIMIT`); `links`
     * carries only edges whose source AND target are both in `nodes`;
     * `issues` carries only those whose `nodeIds` intersect `nodes`.
     * `total` is the count of union nodes BEFORE the cap (so the route
     * can compute `truncated`); `paths` echoes the de-duped prefixes.
     * All scoping + capping happens in SQL so a 50K corpus never
     * hydrates into memory.
     */
    loadBranch(prefixes: string[], limit: number): Promise<IBranchProjection>;
  };

  // --- contributions namespace -----------------------------------------
  /**
   * Phase 3 / View contribution system, read access to
   * `scan_contributions`, plus the targeted purge used by
   * `sm plugins disable` to clear stale rows immediately at toggle time.
   * Bulk writes still happen exclusively via
   * `scans.persist({ contributions })` (replace-all semantics).
   */
  contributions: {
    /** Every contribution row for a single node. Stable order. */
    listForNode(nodePath: string): Promise<IPersistedContribution[]>;
    /**
     * Bulk variant for the BFF nodes-list route. Returns rows for
     * every path in `paths`, sorted `nodePath` ASC, then qualified-id
     * ASC. Empty `paths` returns `[]` without a query.
     */
    listForPaths(paths: readonly string[]): Promise<IPersistedContribution[]>;
    /**
     * Lookup by qualified id + path. Used by
     * `GET /api/contributions/:pluginId/:contributionId?path=...`.
     */
    lookup(
      pluginId: string,
      contributionId: string,
      nodePath: string,
      extensionId?: string,
    ): Promise<IPersistedContribution[]>;
    /**
     * Drop rows for a plugin (optionally narrowed to a single
     * extension within the plugin). Returns the number of deleted
     * rows. Called by `sm plugins disable` so the UI stops rendering
     * the disabled plugin's chips before the next scan.
     */
    purgeByPlugin(pluginId: string, extensionId?: string): Promise<number>;
    /**
     * "off-shape visible" follow-up, every view contribution the last
     * scan REJECTED at emit time (undeclared ref, or payload failed the
     * slot's AJV schema), ordered by `(pluginId, extensionId, nodePath,
     * emittedAt)` ASC. Consumed by `sm plugins doctor` to surface
     * runtime contribution rejections per plugin (and later the BFF).
     */
    listAllErrors(): Promise<
      import('../adapters/sqlite/contributions.js').IContributionErrorRecord[]
    >;
  };

  // --- tags namespace ----------------------------------------------------
  /**
   * Read-only access to `scan_node_tags`. Writes happen exclusively
   * via `scans.persist({...})` (the persistence layer projects from
   * `node.sidecar.annotations.tags`, the only tag source); this
   * namespace is read-only.
   */
  tags: {
    /** Every tag row for a single node, ordered by tag name. */
    listForNode(nodePath: string): Promise<import('../adapters/sqlite/tags.js').ITagRecord[]>;
    /**
     * Bulk variant for the BFF nodes-list route. Returns rows for every
     * path in `paths`, sorted `tag` ASC. Empty `paths` returns `[]`
     * without a query.
     */
    listForPaths(
      paths: readonly string[],
    ): Promise<import('../adapters/sqlite/tags.js').ITagRecord[]>;
    /**
     * Find every node carrying `tag` in its `.sm` sidecar
     * (`annotations.tags`). Drives `sm list --tag <name>`.
     */
    findNodes(tag: string): Promise<string[]>;
  };

  // --- issues namespace --------------------------------------------------
  issues: {
    /** Every issue from the latest scan, in insertion order. */
    listAll(): Promise<Issue[]>;
    /**
     * Paginated, filtered issue read. Drives `/api/issues` (the BFF
     * route used to call `listAll()` and filter in JS, which loaded
     * every persisted issue into memory before paging; the audit
     * L6 fix pushes both filtering AND pagination into SQL).
     *
     * `total` in the result is the count matching the filters BEFORE
     * pagination is applied; `items` is the page slice (length ≤
     * `filter.limit`). Order is `id` ASC (insertion order, stable
     * across pages so the route's `offset` / `limit` is deterministic).
     *
     * Empty filters match every row (the route still passes
     * `offset` + `limit` so pagination always applies). See
     * `IIssueListFilter` for the per-field semantics.
     */
    list(filter: IIssueListFilter): Promise<IIssueListResult>;
    /**
     * Issue rows whose runtime `Issue` shape passes `predicate`.
     * `port.issues.findActive((i) => i.analyzerId === 'orphan')` is the
     * canonical use; `sm orphans` consumes this. The returned shape
     * carries the DB-assigned `id` so a follow-up
     * `transaction(tx => tx.issues.deleteById(row.id))` can target
     * a specific row.
     */
    findActive(predicate: (issue: Issue) => boolean): Promise<IIssueRow[]>;
  };

  // The `enrichments` namespace is intentionally transactional-only
  // at Phase A. The mutation surface (`upsertMany`) is exposed inside
  // `transaction(fn)` only, `sm refresh`'s upsert path is the
  // canonical caller and it always wraps in a tx. A non-transactional
  // read shape lands when a non-refresh consumer surfaces; the
  // contract starts minimal on purpose.

  // --- pluginConfig namespace -------------------------------------------
  pluginConfig: {
    /**
     * Upsert the per-plugin enabled override into `config_plugins`.
     * Caller is `sm plugins enable / disable`.
     */
    set(pluginId: string, enabled: boolean): Promise<void>;
    /** Read a single override; `undefined` when no row exists. */
    get(pluginId: string): Promise<boolean | undefined>;
    /** Every override row, sorted by `pluginId` for stable rendering. */
    list(): Promise<IPluginConfigRow[]>;
    /** Drop a single override row (no-op when absent). */
    delete(pluginId: string): Promise<void>;
    /**
     * Load every override into a map for quick lookup by id. Used by
     * `loadPluginRuntime` to layer the DB overrides over the
     * `settings.json` defaults at scan boot.
     */
    loadOverrideMap(): Promise<Map<string, boolean>>;
  };

  // --- jobs namespace ----------------------------------------------------
  jobs: {
    /**
     * Delete `state_jobs` rows in terminal `status` whose `finishedAt`
     * is older than `cutoffMs` (Unix ms). Returns the deleted count
     * plus every non-null `filePath` from the deleted rows so the
     * caller can unlink the on-disk MD files. Caller computes
     * `cutoffMs` from the configured retention.
     */
    pruneTerminal(
      status: 'completed' | 'failed',
      cutoffMs: number,
    ): Promise<IPruneResult>;
    /**
     * Same SELECT side as `pruneTerminal` but without the DELETE.
     * Powers `sm job prune --dry-run` previews so the dry-run output
     * names exactly the rows the live mode would delete.
     */
    listTerminalCandidates(
      status: 'completed' | 'failed',
      cutoffMs: number,
    ): Promise<IPruneResult>;
    /**
     * Read every `state_jobs.filePath` currently set, normalized through
     * `path.resolve()`. The CLI's `sm job prune --orphan-files` flow
     * pairs this set with `kernel/jobs/orphan-files.ts:findOrphanJobFiles`
     * (which walks the directory) to compute the MD files on disk that
     * no row references, keeps the storage layer FS-free.
     */
    listReferencedFilePaths(): Promise<Set<string>>;
  };

  // --- preferences namespace -------------------------------------------
  /**
   * Generic key/value preferences keyed by a stable string. Backs the
   * `config_preferences` table, one row per `key`, `value_json` is a
   * single JSON blob the caller serialises. Keys with the `_kernel.`
   * prefix are reserved for kernel-managed entries (today: the
   * update-check cache); user-set preferences land under unprefixed
   * keys when those ship.
   *
   * Read-only by design at the port level, the only writer is the
   * CLI's post-run hook (`cli/util/update-check-banner.ts`), which
   * reaches the persistence helpers directly. The port surfaces the
   * read so the BFF's `GET /api/update-status` projection can stay
   * inside the abstract contract.
   */
  preferences: {
    /**
     * Load the update-check cache row. Returns `null` when the row
     * is absent, malformed JSON, or fails the shape guard. Never
     * throws, read failures degrade silently because the banner is
     * a non-essential surface.
     */
    loadUpdateCheckCache(): Promise<IUpdateCheckCache | null>;
    /**
     * Upsert the update-check cache row. Always overwrites the
     * existing JSON blob in place. `updated_at` tracks wall-clock
     * now, separate from the embedded `checkedAt` field, which
     * the caller controls.
     */
    saveUpdateCheckCache(cache: IUpdateCheckCache): Promise<void>;
  };

  // --- favorites namespace ----------------------------------------------
  favorites: {
    /**
     * Mark `path` as favorited. Idempotent, a second call refreshes
     * `favoritedAt` but does not error. The path is FK-semantic to
     * `scan_nodes.path`; the route layer is responsible for confirming
     * the path exists in the live scan before calling.
     */
    set(path: string): Promise<void>;
    /** Drop the favorite row for `path`. Idempotent, no-op when absent. */
    unset(path: string): Promise<void>;
    /**
     * Load every favorited path as a `Set<string>` ready for `O(1)`
     * membership checks. Used by the BFF's `/api/nodes` decorator,
     * one query per request, no SQL JOIN against `scan_nodes`.
     */
    listPaths(): Promise<Set<string>>;
  };

  // --- history namespace -------------------------------------------------
  history: {
    /** List `state_executions` rows (paginated by filter). */
    list(filter: IListExecutionsFilter): Promise<ExecutionRecord[]>;
    /**
     * Aggregate counters / period buckets / top-nodes / error rates
     * over `state_executions`. Body matches the spec
     * `history-stats.schema.json` shape minus `range`/`elapsedMs`
     * (the verb fills those in around the call).
     */
    aggregateStats(
      range: IHistoryStatsRange,
      period: THistoryStatsPeriod,
      topN: number,
    ): Promise<
      Omit<HistoryStats, 'elapsedMs' | 'range'> & {
        rangeMs: { sinceMs: number | null; untilMs: number };
      }
    >;
  };

  // --- migrations namespace (sm db verb) --------------------------------
  migrations: {
    /** Enumerate kernel migration files bundled with this build. */
    discover(): IMigrationFile[];
    /**
     * Compute the apply / pending plan against the current `config_
     * schema_versions` ledger. Read-only; safe under `--dry-run`.
     */
    plan(files?: IMigrationFile[]): IMigrationPlan;
    /**
     * Apply pending migrations in order. Each runs inside its own
     * `BEGIN/COMMIT` (per `kernel/adapters/sqlite/migrations.ts`); a
     * partial failure rolls back to the prior state. Returns the
     * applied list + backup path (when `backup: true`).
     */
    apply(options?: IApplyOptions, files?: IMigrationFile[]): IApplyResult;
    /**
     * WAL-checkpoint + atomic file copy of the DB to `destPath`.
     * Caller composes the path. Returns the destination on success,
     * or `null` for in-memory DBs (no file to copy).
     */
    writeBackup(destPath: string): string | null;
    /**
     * Read `PRAGMA user_version` from the underlying DB. The migrations
     * runner keeps that pragma in sync with the latest applied kernel
     * migration, so this is the canonical "current schema version"
     * read for `sm version --json`'s `dbSchema` field. Returns `null`
     * on engine quirks (non-numeric / null pragma).
     */
    currentSchemaVersion(): number | null;
  };

  // --- pluginMigrations namespace (sm db verb, per-plugin) --------------
  pluginMigrations: {
    /** Path to the plugin's `migrations/` directory, or `null` when absent. */
    resolveDir(plugin: IDiscoveredPlugin): string | null;
    /** Discover the plugin's migration files. */
    discover(plugin: IDiscoveredPlugin): IPluginMigrationFile[];
    /**
     * Plan against `config_schema_versions` for the plugin's
     * `(scope='plugin', ownerId=plugin.id)`.
     */
    plan(
      plugin: IDiscoveredPlugin,
      files?: IPluginMigrationFile[],
    ): IPluginMigrationPlan;
    /** Apply pending plugin migrations. Same per-file BEGIN/COMMIT pattern. */
    apply(
      plugin: IDiscoveredPlugin,
      options?: IPluginApplyOptions,
      files?: IPluginMigrationFile[],
    ): IPluginApplyResult;
  };

  // --- transactions ------------------------------------------------------
  /**
   * Open a transaction. The callback receives a transactional subset
   * of the port; the adapter commits on resolution and rolls back on
   * rejection. `sm orphans reconcile / undo-rename` and `sm refresh`
   * are the canonical consumers.
   */
  transaction<T>(fn: (tx: ITransactionalStorage) => Promise<T>): Promise<T>;
}

export type {
  IApplyOptions,
  IApplyResult,
  IBranchProjection,
  IHistoryStatsRange,
  IIssueIncidenceCount,
  IIssueRow,
  IListExecutionsFilter,
  ILiteNode,
  IMigrateNodeFksReport,
  IMigrationFile,
  IMigrationPlan,
  IMigrationRecord,
  INodeBundle,
  INodeCounts,
  INodeFilter,
  IPersistedContribution,
  IPersistOptions,
  IPluginApplyOptions,
  IPluginApplyResult,
  IPluginConfigRow,
  IPluginMigrationFile,
  IPluginMigrationPlan,
  IPluginMigrationRecord,
  IPruneResult,
  THistoryStatsPeriod,
} from '../types/storage.js';
