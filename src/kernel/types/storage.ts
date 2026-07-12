/**
 * Storage-port domain types, option bags and result shapes the
 * `StoragePort` namespaces consume / return. Live next to the port
 * (`kernel/ports/storage.ts`) so adapters and CLI consumers share a
 * single source of truth without depending on the SQLite adapter's
 * internal types.
 *
 * Naming bucket: category 4 (internal shapes) per `context/kernel.md` §Type
 * naming convention. Every name carries the `I*` prefix.
 */

import type {
  ExecutionStatus,
  Issue,
  JobStatus,
  Link,
  Node,
} from '../types.js';

/**
 * Row-level filter for `port.scans.findNodes(...)` (driven by
 * `sm list`'s flags). All fields are optional, an empty filter
 * returns every node sorted by `path` asc.
 */
export interface INodeFilter {
  /** Restrict to a single node kind. Open string (matches `Node.kind`). */
  kind?: string;
  /**
   * When `true`, keep only nodes whose path is referenced by at least
   * one `scan_issues.nodeIds` array.
   */
  hasIssues?: boolean;
  /**
   * Sort column. The adapter validates against its own whitelist and
   * rejects anything else with an Error (the CLI's own usage-error
   * exit is the right place to surface a bad `--sort-by`; the port
   * defends in depth).
   */
  sortBy?: string;
  /** `'asc'` or `'desc'`. Defaults to the adapter's per-column convention. */
  sortDirection?: 'asc' | 'desc';
  /** Cap the result. Positive integer; absent → no limit. */
  limit?: number;
}

/**
 * Bundled fetch for `port.scans.findNode(path)`, one node and
 * everything `sm show <path>` displays alongside it. Every field is
 * computed from `scan_*` zone reads only; per-domain data (history,
 * jobs, plugin enrichments) ships through other namespaces.
 */
export interface INodeBundle {
  node: Node;
  linksOut: Link[];
  linksIn: Link[];
  issues: Issue[];
}

/**
 * Output of `port.scans.countRows()`. Used by `sm scan` to decide
 * whether the persist would wipe a populated DB (the "refusing to
 * wipe" guard) and by `sm db status` for the human summary.
 */
export interface INodeCounts {
  nodes: number;
  links: number;
  issues: number;
}

/**
 * Lightweight per-node projection for the BFF `/api/folders` endpoint.
 * Carries only the cheap scalar columns the SPA folders tree needs
 * (`path`, `kind`, the two link counts, total tokens, mtime), never the
 * full `Node` (no frontmatter, body, links, signals, contributions).
 * Pushed straight from `scan_nodes` so a 50K corpus does not hydrate the
 * whole `ScanResult` into memory.
 */
export interface ILiteNode {
  path: string;
  kind: string;
  linksInCount: number;
  linksOutCount: number;
  tokensTotal: number | null;
  modifiedAtMs: number | null;
  /**
   * The persisted `scan_nodes.sidecar_status`, null when there is no
   * parseable sidecar. Lets the folders rail flag staleness corpus-wide,
   * sibling of the issue counts.
   */
  sidecarStatus: string | null;
}

/**
 * Per-node issue incidence counts by severity, output of
 * `port.scans.issueCountsByPath()`. One entry per node that has at least
 * one error- or warn-severity issue whose `nodeIds` array includes the
 * path; nodes with no error / warn issues are absent from the map. The
 * `info` severity is intentionally ignored (the SPA badges only error /
 * warn). Counts are issue incidence (one per matching issue), the same
 * semantics the UI's `countIssuesByPath` rolls up per node.
 */
export interface IIssueIncidenceCount {
  error: number;
  warn: number;
}

/**
 * Output of `port.scans.loadBranch(...)`, the prefix-union + capped
 * graph projection the BFF `/api/branch` endpoint returns. `nodes` is
 * the first `LIMIT` nodes of the union (every requested prefix's
 * subtree) in stable path order (`ORDER BY path`); `links` carries only
 * edges whose source AND RESOLVED target (`resolvedTarget`, else the raw
 * `target` for path-style links) are both in that node set, so a
 * trigger-style `invokes` / `mentions` edge that resolves to a rendered
 * node is kept and a genuinely-broken link is dropped; `issues`
 * carries only those whose `nodeIds` intersect it. `total` is the count
 * of nodes in the union BEFORE the cap (so the route can compute
 * `truncated`). `paths` echoes the (de-duped) requested prefixes; the
 * whole-corpus case (no prefix) echoes `[]`.
 */
export interface IBranchProjection {
  nodes: Node[];
  links: Link[];
  issues: Issue[];
  total: number;
  paths: string[];
}

/**
 * Lightweight option bag for `port.scans.persist`. Mirrors the optional
 * inputs of the `persistScanResult(db, result, inputs)` free function
 * (`IPersistScanInputs` in `kernel/adapters/sqlite/scan-persistence.ts`),
 * so the adapter implementation is a one-line delegation; the named-bag
 * shape lets new optional inputs land without breaking callers.
 */
export interface IPersistOptions {
  renameOps?: import('../orchestrator.js').RenameOp[];
  extractorRuns?: import('../orchestrator.js').IExtractorRunRecord[];
  enrichments?: import('../orchestrator.js').IEnrichmentRecord[];
  contributions?: import('../adapters/sqlite/contributions.js').IContributionRecord[];
  /**
   * "off-shape visible" follow-up, per-scan records of view
   * contributions REJECTED at emit time (undeclared ref, or payload
   * failed the slot's AJV schema). Plain REPLACE-ALL into
   * `scan_contribution_errors` (delete all, then insert), the same
   * posture as `scan_issues`. Empty / absent wipes the table (a clean
   * scan clears any stale rows). Surfaced by `sm plugins doctor`.
   */
  contributionErrors?: import('../adapters/sqlite/contributions.js').IContributionErrorRecord[];
  /**
   * Per-op confidence-attribution audit trail for `scan_link_scores`.
   * One entry per attributed `ctx.adjustConfidence(link, op)` call a
   * `score`-phase analyzer buffered this scan; the orchestrator already
   * folded them into `link.confidence`, so these rows are the attribution
   * (which plugin / extension / op moved a given link, plus the folded
   * `result_confidence`). Plain REPLACE-ALL into `scan_link_scores`
   * (delete all, then insert), the same posture as `scan_issues`. Empty /
   * absent wipes the table (a scan whose scorers touched nothing clears
   * any stale rows).
   */
  linkScores?: import('../adapters/sqlite/link-scores.js').IConfidenceAdjustment[];
  /**
   * Phase 3 / View contribution system, active runtime catalog of
   * registered view contributions, keyed by qualified id
   * `<pluginId>/<extensionId>/<contributionId>`. Passed to the
   * `scan_contributions` upsert so the catalog sweep can drop rows
   * belonging to plugins / extensions that are no longer in the
   * catalog (uninstalled plugins, disabled plugins, removed
   * contributions). Empty / absent set = no catalog sweep (legacy
   * behaviour, leaves disabled-plugin rows stale per design F24
   * pre-fix).
   */
  registeredContributionKeys?: ReadonlySet<string>;
  /**
   * Phase 3 / View contribution system, set of `(plugin, extension,
   * node)` tuples where the extension actually RAN against that node
   * in this scan. Format: `<pluginId>/<extensionId>/<nodePath>` (no
   * contribution-id segment, the sweep operates at the (plugin,
   * extension, node) level and inspects the buffer to decide which
   * contribution-ids survive).
   *
   * Membership rules:
   *   - Extractor + cache miss: tuple INCLUDED (extract() ran).
   *   - Extractor + cache hit: tuple OMITTED (extract() skipped, prior
   *     rows must be preserved).
   *   - Rule, every node in `ctx.nodes`: tuple INCLUDED (rules always
   *     run and see the full graph).
   *
   * Drives the per-tuple sweep documented in `spec/architecture.md`
   * §View contribution system → Persistence (sweep #3): rows whose
   * `(plugin_id, extension_id, node_path)` is in this set but whose
   * `(plugin_id, extension_id, node_path, contribution_id)` is NOT in
   * the buffer get DELETEd before the upsert. Catches the "extractor
   * used to emit, now does not" case (e.g. body change removes the
   * trigger). Empty / absent set = no per-tuple sweep (legacy
   * callers preserve the pre-fix behaviour where stale rows linger).
   */
  freshlyRunTuples?: ReadonlySet<string>;
}

/**
 * Issue row as the storage layer sees it, paired with its DB-assigned
 * id so `port.issues.deleteById(id)` can target it inside a
 * transaction. The runtime `Issue` shape (per `issue.schema.json`) does
 * not carry `id` because the spec models issues as ephemeral findings
 * scoped to a scan; the DB does need the synthetic id to update / delete
 * a single row.
 */
export interface IIssueRow {
  id: number;
  issue: Issue;
}

/**
 * Filter + pagination shape for `port.issues.list(...)`, driven by the
 * BFF's `/api/issues` route. Every field is optional, an empty filter
 * returns every issue ordered by `id` ASC (insertion order, stable
 * across pages so `offset` / `limit` paging is deterministic).
 *
 * The three semantic filters mirror `/api/issues`'s query params:
 *
 *   - `severities`, narrowed list of `Severity` values. Empty / absent
 *     matches every severity.
 *   - `analyzerIds`, accepts qualified (`<plugin>/<id>`) AND short
 *     (`<id>`) forms; the suffix-match semantics live in
 *     `matchesAnalyzerFilter`. Each entry generates two SQL clauses
 *     (`= ?` and `LIKE '%/' || ?`) ORed together so the filter remains
 *     a single SQL pass with parameterised values, no string
 *     interpolation. Empty / absent matches every analyzer id.
 *   - `nodePath`, keeps issues whose `nodeIds` JSON array contains the
 *     given path (correlated EXISTS over `json_each`). Absent / null
 *     skips the filter.
 *   - `nodePaths`, multi-node variant of `nodePath`: keeps issues
 *     whose `nodeIds` JSON array intersects the given set (correlated
 *     EXISTS over `json_each` with an `IN(...)` predicate). Used by
 *     the linked-nodes panel to fetch issues for the focused node +
 *     its neighbours in one round-trip instead of pulling the whole
 *     table. Empty array matches zero rows; absent skips the filter.
 *     Combines with `nodePath` (intersection); when both are set, the
 *     `nodePath` predicate is AND-ed with `nodePaths`.
 *
 * Pagination is mandatory; the route layer fills the defaults via
 * `parsePagination`. `total` in `IIssueListResult` reports the total
 * MATCHING the filters (not just the page slice) so the SPA can
 * surface a correct page-count without a second round-trip.
 */
export interface IIssueListFilter {
  /**
   * Severity tokens to match. Typed as open `string` (not the
   * `Severity` union) so an unknown value from a URL query string
   * surfaces as a zero-match SQL query, not a kernel validation
   * error. The adapter parameterises each entry into the `IN(...)`
   * clause; unrecognised severities simply match no rows.
   */
  severities?: readonly string[];
  analyzerIds?: readonly string[];
  nodePath?: string | null;
  nodePaths?: readonly string[];
  offset: number;
  limit: number;
}

/**
 * Output of `port.issues.list(...)`. `items` is the page slice (length
 * ≤ `filter.limit`); `total` is the count of rows matching the filters
 * before pagination was applied.
 */
export interface IIssueListResult {
  items: Issue[];
  total: number;
}

// --- jobs namespace --------------------------------------------------------

/** Output of `port.jobs.pruneTerminal` / `listTerminalCandidates`. */
export interface IPruneResult {
  /** How many `state_jobs` rows were deleted (or would be, in dry-run). */
  deletedCount: number;
  /**
   * How many orphaned `state_job_contents` rows were collected in the
   * same transaction (content blobs referenced by zero surviving
   * `state_jobs` rows). Always `0` for the `listTerminalCandidates`
   * dry-run preview; the live `pruneTerminal` returns the real count.
   */
  prunedContents: number;
}

/**
 * Content row inserted into `state_job_contents` at submit time via
 * `INSERT OR IGNORE`. Keyed by `contentHash`; a second submit of the same
 * hash is a no-op (the blob is stored once, refcounted by reference).
 */
export interface IJobContentInput {
  contentHash: string;
  content: string;
  createdAt: number;
}

/**
 * The `state_jobs` row values a submit provides. Lifecycle-null columns
 * (`failureReason` / `runner` / `claimedAt` / `finishedAt` / `expiresAt`)
 * are filled by the adapter; the caller supplies only the frozen-at-submit
 * fields. `status` is `queued` for every real submit but stays typed for
 * reuse.
 */
export interface IJobSubmitRow {
  id: string;
  actionId: string;
  actionVersion: string;
  nodeId: string;
  contentHash: string;
  nonce: string;
  priority: number;
  status: JobStatus;
  ttlSeconds: number;
  createdAt: number;
  submittedBy?: string | null;
}

/**
 * Filter for `port.jobs.list(...)` (drives `sm job list`). All optional;
 * an empty filter returns every job, newest first. `actionId` matches the
 * stored (qualified) id exactly OR by bare-id suffix, mirroring the
 * analyzer-filter semantics so `--action skill-summarizer` finds
 * `core/skill-summarizer`.
 */
export interface IJobListFilter {
  status?: JobStatus;
  actionId?: string;
  nodeId?: string;
}

// --- history namespace -----------------------------------------------------

/** Filter shape for `port.history.list`. All fields optional. */
export interface IListExecutionsFilter {
  /** Restrict to executions whose `nodeIds` array contains this path. */
  nodePath?: string;
  /** Exact match on `extension_id`. */
  actionId?: string;
  /** Subset of {`completed`,`failed`,`cancelled`}. */
  statuses?: ExecutionStatus[];
  /** Lower bound (inclusive) on `started_at`. Unix ms. */
  sinceMs?: number;
  /** Upper bound (exclusive) on `started_at`. Unix ms. */
  untilMs?: number;
  /** Cap result count. No default. */
  limit?: number;
}

/** Window shape for `port.history.aggregateStats`. */
export interface IHistoryStatsRange {
  /** Inclusive lower bound. `null` = all-time. */
  sinceMs: number | null;
  /** Exclusive upper bound. */
  untilMs: number;
}

/** Period bucket granularity for `port.history.aggregateStats`. */
export type THistoryStatsPeriod = 'day' | 'week' | 'month';

/**
 * Output of `port.transaction(tx => tx.history.migrateNodeFks(from, to))`.
 * Lists how many rows in each `state_*` table were repointed plus any
 * composite-PK collisions that forced a drop instead of an update.
 */
export interface IMigrateNodeFksReport {
  jobs: number;
  executions: number;
  summaries: number;
  enrichments: number;
  pluginKvs: number;
  nodeFavorites: number;
  /**
   * Collisions encountered when migrating any of the keyed-by-node
   * `state_*` tables because a row already existed at the destination
   * PK. The pre-existing rows are preserved, the migrating rows are
   * dropped (deleted from `fromPath` without a corresponding INSERT).
   * One entry per dropped row, with the affected PK fields included
   * for diagnostic output. `state_node_favorites` has no composite key
   * so its `keys` is the empty object.
   */
  collisions: Array<{
    table:
      | 'state_summaries'
      | 'state_enrichments'
      | 'state_plugin_kvs'
      | 'state_node_favorites';
    fromPath: string;
    toPath: string;
    keys: Record<string, string>;
  }>;
}

// --- trust namespace ------------------------------------------------------

/**
 * A single `config_plugins` trust row as the kernel sees it. The table
 * is the per-machine import-trust store (the SECURITY axis); the
 * operational enable/disable toggle lives in the config layers, not
 * here. Keyed by the bare plugin id.
 */
export interface IPluginTrustRow {
  pluginId: string;
  trusted: boolean;
  updatedAt: number;
}

// --- migrations namespace --------------------------------------------------

/** Discovered kernel migration file (one of `NNN_snake_case.sql`). */
export interface IMigrationFile {
  version: number;
  description: string;
  filePath: string;
}

/** A row from the `config_schema_versions` ledger for the kernel scope. */
export interface IMigrationRecord {
  scope: string;
  ownerId: string;
  version: number;
  description: string;
  appliedAt: number;
}

/** `port.migrations.plan` output: applied vs pending. */
export interface IMigrationPlan {
  applied: IMigrationRecord[];
  pending: IMigrationFile[];
}

/** Apply-time options for `port.migrations.apply`. */
export interface IApplyOptions {
  backup?: boolean;
  dryRun?: boolean;
  to?: number;
}

/** Result of `port.migrations.apply`. */
export interface IApplyResult {
  applied: IMigrationFile[];
  backupPath: string | null;
}

// --- pluginMigrations namespace -------------------------------------------

/** Discovered plugin migration file. Same `NNN_snake_case.sql` convention. */
export interface IPluginMigrationFile {
  version: number;
  description: string;
  filePath: string;
}

/** A row from the `config_schema_versions` ledger for a single plugin. */
export interface IPluginMigrationRecord {
  version: number;
  description: string;
  appliedAt: number;
}

/** `port.pluginMigrations.plan` output for a single plugin. */
export interface IPluginMigrationPlan {
  pluginId: string;
  applied: IPluginMigrationRecord[];
  pending: IPluginMigrationFile[];
}

/** Apply-time options for `port.pluginMigrations.apply`. */
export interface IPluginApplyOptions {
  /** No actual writes; surfaces what would run. Default false. */
  dryRun?: boolean;
}

/** Result of `port.pluginMigrations.apply`. */
export interface IPluginApplyResult {
  pluginId: string;
  applied: IPluginMigrationFile[];
  /** Catalog intrusions caught by Layer 3 (post-apply sweep). Empty when clean. */
  intrusions: string[];
}

// --- contributions namespace ----------------------------------------------

/**
 * Single contribution row as returned to callers of the
 * `contributions` namespace on `StoragePort`. The payload is
 * `unknown` because the slot space is open at the type layer (catalog
 * evolution is a kernel + spec concern); narrow at the call site by
 * reading `slot`.
 *
 * Lives next to the port (not under `adapters/sqlite/`) so non-SQLite
 * implementations of `StoragePort` (in-memory test harness, future
 * Postgres adapter) can satisfy the port contract without importing
 * from the SQLite adapter. The SQLite adapter re-exports this type
 * for backwards compatibility with callers that still import from
 * the adapter path.
 */
export interface IPersistedContribution {
  pluginId: string;
  extensionId: string;
  nodePath: string;
  contributionId: string;
  slot: string;
  payload: unknown;
  emittedAt: number;
}
