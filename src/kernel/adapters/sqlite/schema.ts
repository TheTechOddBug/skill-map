/**
 * Typed Kysely schema for the kernel database. Mirrors `spec/db-schema.md`
 * at the TypeScript level — the `Database` interface below is what
 * downstream repositories consume via `Kysely<Database>`.
 *
 * **camelCase on TypeScript, snake_case on SQL.** Kysely's CamelCasePlugin
 * (wired in SqliteStorageAdapter) bridges the two: the interfaces here
 * use camelCase field names, and the plugin rewrites them to snake_case
 * on the way out to SQL. The migrations in `src/migrations/` use
 * snake_case (spec-authoritative).
 *
 * **Nullable columns** use `| null` rather than optional `?`: the column
 * exists in every row, its value is sometimes SQL NULL.
 *
 * **`Generated<T>`** marks columns the database fills (autoincrement
 * `INTEGER PRIMARY KEY` or DEFAULT-valued columns).
 */

import type { Generated } from 'kysely';

import type { Severity } from '../../types.js';

// --- Enum unions mirroring spec CHECK constraints --------------------------

/**
 * SQLite-side kind type. Open `string` to mirror `Node.kind` (open by
 * design — Providers may declare their own kinds). The `kernel/types.ts`
 * `NodeKind` alias still exists for code that intentionally narrows on
 * the built-in Claude Provider catalog (`skill` / `agent` / `command` /
 * `hook` / `note`); use that there. For everything else — column types,
 * loaders, persisters — `TNodeKind = string` is the right contract.
 */
export type TNodeKind = string;
export type TStability = 'experimental' | 'stable' | 'deprecated';

/**
 * Drift status of a node's co-located `.sm` sidecar (Step 9.6.2).
 *
 *   - `fresh` — both `for.bodyHash` and `for.frontmatterHash` match the
 *     current node hashes; the sidecar is up to date.
 *   - `stale-body` — `for.bodyHash` is outdated; the body changed since
 *     the last bump.
 *   - `stale-frontmatter` — `for.frontmatterHash` is outdated; the
 *     frontmatter changed since the last bump.
 *   - `stale-both` — both hashes are outdated.
 *
 * NULL on `scan_nodes.sidecar_status` when no sidecar accompanies the
 * node.
 */
export type TSidecarStatus = 'fresh' | 'stale-body' | 'stale-frontmatter' | 'stale-both';

export type TLinkKind = 'invokes' | 'references' | 'mentions' | 'supersedes';
export type TConfidence = 'high' | 'medium' | 'low';

// Alias the domain `Severity` so the DB and runtime stay in lock-step:
// today the unions are identical, and any future change to the domain
// type propagates here without manual sync. Distinct names are preserved
// to keep call-site intent visible (`TIssueSeverity` reads as "the
// severity stored in `scan_issues.severity`").
export type TIssueSeverity = Severity;

export type TJobStatus = 'queued' | 'running' | 'completed' | 'failed';
export type TJobFailureReason =
  | 'runner-error'
  | 'report-invalid'
  | 'timeout'
  | 'abandoned'
  | 'job-file-missing'
  | 'user-cancelled';
export type TJobRunner = 'cli' | 'skill' | 'in-process';

export type TExecutionKind = 'action';
export type TExecutionStatus = 'completed' | 'failed' | 'cancelled';

export type TSchemaVersionScope = 'kernel' | 'plugin';

// --- Scan zone -------------------------------------------------------------

export interface IScanNodesTable {
  path: string;
  kind: TNodeKind;
  provider: string;
  title: string | null;
  description: string | null;
  stability: TStability | null;
  version: number | null;
  /**
   * Step 9.6.2 — sidecar denormalisation. `sidecarPresent` is a SQLite
   * INTEGER (0 / 1) that bridges to a runtime boolean; `sidecarStatus`
   * carries the drift state when present (NULL when absent);
   * `annotationsJson` is the JSON-encoded `annotations:` block from the
   * parsed sidecar (NULL when absent or empty).
   *
   * R15 closure (2026-05-07) — `sidecarRootJson` is the JSON-encoded
   * full parsed YAML root (the entire `.sm` payload). Sibling to
   * `annotationsJson` per Decision R15 option (b) (additive column,
   * no rewrite of the existing read path); duplicates the
   * `annotations:` sub-block by design so existing
   * `annotationsJson` consumers keep working. NULL when no sidecar is
   * present, or when the sidecar failed to parse / validate.
   */
  sidecarPresent: Generated<number>;
  sidecarStatus: TSidecarStatus | null;
  annotationsJson: string | null;
  sidecarRootJson: string | null;
  frontmatterJson: string;
  bodyHash: string;
  frontmatterHash: string;
  bytesFrontmatter: number;
  bytesBody: number;
  bytesTotal: number;
  tokensFrontmatter: number | null;
  tokensBody: number | null;
  tokensTotal: number | null;
  linksOutCount: Generated<number>;
  linksInCount: Generated<number>;
  externalRefsCount: Generated<number>;
  scannedAt: number;
}

export interface IScanLinksTable {
  id: Generated<number>;
  sourcePath: string;
  targetPath: string;
  kind: TLinkKind;
  confidence: TConfidence;
  sourcesJson: string;
  originalTrigger: string | null;
  normalizedTrigger: string | null;
  locationLine: number | null;
  locationColumn: number | null;
  locationOffset: number | null;
  raw: string | null;
}

export interface IScanIssuesTable {
  id: Generated<number>;
  ruleId: string;
  severity: TIssueSeverity;
  nodeIdsJson: string;
  linkIndicesJson: string | null;
  message: string;
  detail: string | null;
  fixJson: string | null;
  dataJson: string | null;
}

export type TScanScope = 'project' | 'global';

export interface IScanMetaTable {
  id: number;
  scope: TScanScope;
  rootsJson: string;
  scannedAt: number;
  scannedByName: string;
  scannedByVersion: string;
  scannedBySpecVersion: string;
  providersJson: string;
  statsFilesWalked: number;
  statsFilesSkipped: number;
  statsDurationMs: number;
}

/**
 * Spec § A.9 — fine-grained Extractor cache.
 *
 * One row per `(node_path, extractor_id)` recording the body hash the
 * extractor saw when it last ran. The orchestrator consults this table on
 * incremental scans: a node-level cache hit (body+frontmatter unchanged)
 * is upgraded to a full skip ONLY when every currently-registered
 * extractor already has a row matching the prior body hash. A new
 * extractor registered between scans is detected by the absence of its
 * row and runs over the cached node without invalidating the rest of
 * the cache. Replace-all on every persist drops rows for extractors that
 * were uninstalled since the last scan.
 *
 * `extractor_id` is the qualified form `<pluginId>/<id>` per spec § A.6;
 * link `sources_json` carries the author-supplied short id (extractor
 * authors write `sources: ['slash']`, not `'claude/slash'`), so the
 * orchestrator builds a short→qualified map from the live extractor set
 * when filtering cached links by source.
 */
export interface IScanExtractorRunsTable {
  nodePath: string;
  extractorId: string;
  bodyHashAtRun: string;
  ranAt: number;
}

/**
 * Spec § A.8 — universal enrichment layer.
 *
 * One row per `(node_path, extractor_id)` capturing the partial Node fields
 * a single Extractor merged onto the enrichment layer via `ctx.enrichNode`.
 * The author-supplied frontmatter on `scan_nodes.frontmatter_json` stays
 * immutable; this table is the kernel-curated overlay.
 *
 *   - `body_hash_at_enrichment` — the `node.body_hash` the Extractor saw
 *     when it produced this enrichment. Always equal to the live body hash
 *     for Extractor writes (Extractors are deterministic-only and
 *     regenerate via the A.9 cache); reserved for the future Action-issued
 *     probabilistic enrichment revision where stale tracking matters.
 *   - `value_json` — JSON-serialised `Partial<Node>` bag the Extractor
 *     emitted (potentially the cumulative merge across multiple
 *     `enrichNode` calls within the same scan).
 *   - `stale` — reserved. Always `0` in this revision (Extractors are
 *     deterministic; rows simply pisar prior rows via the A.9 cache).
 *     Kept on the table for the future Action-issued enrichment revision.
 *   - `is_probabilistic` — reserved. Always `0` for Extractor writes
 *     (Extractors are deterministic-only). Kept so the future
 *     Action-issued enrichment revision can denormalise the writer's
 *     mode without a schema migration.
 *   - `enriched_at` — wall-clock ms; drives the deterministic merge order
 *     (`ASC` → last-write-wins per field) inside `mergeNodeWithEnrichments`.
 */
export interface INodeEnrichmentsTable {
  nodePath: string;
  extractorId: string;
  bodyHashAtEnrichment: string;
  valueJson: string;
  stale: Generated<number>;
  enrichedAt: number;
  isProbabilistic: Generated<number>;
}

/**
 * Phase 3 / View contribution system — `scan_contributions`.
 *
 * One row per `(plugin_id, extension_id, node_path, contribution_id)`
 * tuple. Carries per-node typed data emitted by extractors via
 * `ctx.emitContribution(id, payload)` (and rules via
 * `ctx.emitScopeContribution(id, payload)` for scope-level contracts).
 * Belongs to the `scan_*` family — replaced on every scan; NOT
 * analogous to `state_plugin_kvs` (which is plugin-private storage
 * the plugin manages).
 *
 *   - `contract` — closed-enum-by-spec contract name; mirror of
 *     `view-contracts.schema.json#/$defs/ContractName`. Kept open at
 *     the SQL layer (no CHECK) so catalog evolution does not need a
 *     DDL migration; `sm plugins upgrade` handles renames at the
 *     manifest layer.
 *   - `payload_json` — JSON-serialised payload, already validated
 *     against the contract's payload schema at emit time
 *     (`view-contracts.schema.json#/$defs/payloads/<contract>`).
 *     Off-contract payloads are silently dropped before they reach
 *     this table (mirror of `emitLink` rejecting off-`emitsLinkKinds`
 *     links).
 *   - `emitted_at` — wall-clock ms at emit time.
 *
 * Index on `node_path` for the inspector lazy-fetch route and for the
 * rename heuristic; index on `plugin_id` for the `purgeByPlugin` path
 * used when a plugin is uninstalled.
 */
export interface IScanContributionsTable {
  pluginId: string;
  extensionId: string;
  nodePath: string;
  contributionId: string;
  contract: string;
  payloadJson: string;
  emittedAt: number;
}

// --- State zone ------------------------------------------------------------

export interface IStateJobsTable {
  id: string;
  actionId: string;
  actionVersion: string;
  nodeId: string;
  contentHash: string;
  nonce: string;
  priority: Generated<number>;
  status: TJobStatus;
  failureReason: TJobFailureReason | null;
  runner: TJobRunner | null;
  ttlSeconds: number;
  filePath: string | null;
  createdAt: number;
  claimedAt: number | null;
  finishedAt: number | null;
  expiresAt: number | null;
  submittedBy: string | null;
}

export interface IStateExecutionsTable {
  id: string;
  kind: TExecutionKind;
  extensionId: string;
  extensionVersion: string;
  nodeIdsJson: Generated<string>;
  contentHash: string | null;
  status: TExecutionStatus;
  failureReason: string | null;
  exitCode: number | null;
  runner: string | null;
  startedAt: number;
  finishedAt: number;
  durationMs: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  reportPath: string | null;
  jobId: string | null;
}

export interface IStateSummariesTable {
  nodeId: string;
  kind: TNodeKind;
  summarizerActionId: string;
  summarizerVersion: string;
  bodyHashAtGeneration: string;
  generatedAt: number;
  summaryJson: string;
}

export interface IStateEnrichmentsTable {
  nodeId: string;
  providerId: string;
  dataJson: string;
  verified: number | null;
  fetchedAt: number;
  staleAfter: number | null;
}

export interface IStatePluginKvsTable {
  pluginId: string;
  nodeId: string;
  key: string;
  valueJson: string;
  updatedAt: number;
}

/**
 * Per-node "favorite" flag persisted per user. Single row per favorited
 * node — absence of a row means "not favorited". Lives in zone `state_`
 * so favorites survive `sm scan` truncation and `sm db reset`. Migrated
 * by `migrateNodeFks` (history.ts) on rename, same protocol as the other
 * state_* tables.
 */
export interface IStateNodeFavoritesTable {
  nodePath: string;
  favoritedAt: number;
}

// --- Config zone -----------------------------------------------------------

export interface IConfigPluginsTable {
  pluginId: string;
  enabled: Generated<number>;
  configJson: string | null;
  updatedAt: number;
}

export interface IConfigPreferencesTable {
  key: string;
  valueJson: string;
  updatedAt: number;
}

export interface IConfigSchemaVersionsTable {
  scope: TSchemaVersionScope;
  ownerId: string;
  version: number;
  description: string;
  appliedAt: number;
}

// --- Kysely database binding ----------------------------------------------

export interface IDatabase {
  scan_nodes: IScanNodesTable;
  scan_links: IScanLinksTable;
  scan_issues: IScanIssuesTable;
  scan_meta: IScanMetaTable;
  scan_extractor_runs: IScanExtractorRunsTable;
  scan_contributions: IScanContributionsTable;
  node_enrichments: INodeEnrichmentsTable;

  state_jobs: IStateJobsTable;
  state_executions: IStateExecutionsTable;
  state_summaries: IStateSummariesTable;
  state_enrichments: IStateEnrichmentsTable;
  state_plugin_kvs: IStatePluginKvsTable;
  state_node_favorites: IStateNodeFavoritesTable;

  config_plugins: IConfigPluginsTable;
  config_preferences: IConfigPreferencesTable;
  config_schema_versions: IConfigSchemaVersionsTable;
}
