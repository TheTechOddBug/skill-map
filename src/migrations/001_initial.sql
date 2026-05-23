-- Kernel initial migration. Provisions the kernel tables per
-- spec/db-schema.md. Up-only. Wrapped in BEGIN / COMMIT by the runner.

-- --- Scan zone -------------------------------------------------------------

CREATE TABLE scan_nodes (
  path TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  provider TEXT NOT NULL,
  title TEXT,
  description TEXT,
  -- `stability` is sourced from sidecar `annotations.stability`. NULL when
  -- no sidecar accompanies the node or the field is omitted.
  stability TEXT,
  -- `version` is a monotonic counter sourced from sidecar
  -- `annotations.version` (Decision #125). Pre-9.6.2 it was a semver
  -- string from `frontmatter.metadata.version`; this is greenfield —
  -- no auto-conversion path.
  version INTEGER,
  frontmatter_json TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  frontmatter_hash TEXT NOT NULL,
  bytes_frontmatter INTEGER NOT NULL,
  bytes_body INTEGER NOT NULL,
  bytes_total INTEGER NOT NULL,
  tokens_frontmatter INTEGER,
  tokens_body INTEGER,
  tokens_total INTEGER,
  links_out_count INTEGER NOT NULL DEFAULT 0,
  links_in_count INTEGER NOT NULL DEFAULT 0,
  external_refs_count INTEGER NOT NULL DEFAULT 0,
  -- JSON array of `IExternalRef` objects (every http(s) URL the body
  -- references, in extractor-order, deduped by normalised URL). NULL /
  -- unset when the body has no external URLs. The denormalised
  -- `external_refs_count` rides alongside and MUST equal the array
  -- length when both are present. Populated by
  -- `recomputeExternalRefsCount`, surfaced via `/api/nodes` so the
  -- inspector can list every external URL without a second round-trip.
  external_refs_json TEXT,
  scanned_at INTEGER NOT NULL,
  -- Sidecar denormalisation (Step 9.6.2 — Decision #3, option (a)):
  --   - `sidecar_present` — 1 when a co-located `.sm` file accompanies
  --     this node, 0 otherwise.
  --   - `sidecar_status` — fresh / stale-body / stale-frontmatter /
  --     stale-both. NULL when no sidecar is present.
  --   - `annotations_json` — JSON-encoded `annotations:` block from the
  --     parsed sidecar (typed surface declared by
  --     `spec/schemas/annotations.schema.json`). NULL when no sidecar
  --     or the block is empty.
  --   - `sidecar_root_json` — JSON-encoded full parsed YAML root of the
  --     `.sm` file (every reserved block + plugin `<plugin-id>:`
  --     namespaces). NULL when no sidecar accompanies the node, or
  --     when parsing/validation failed (R15). Duplicates the
  --     `annotations:` sub-block by design — pre-R15 readers of
  --     `annotations_json` keep working unchanged.
  sidecar_present INTEGER NOT NULL DEFAULT 0,
  sidecar_status TEXT,
  annotations_json TEXT,
  sidecar_root_json TEXT,
  -- `kind` is open-by-design (Provider-declared string; the built-in
  -- Claude Provider emits `skill` / `agent` / `command` / `hook` /
  -- `note`, but external Providers may declare their own — see
  -- `node.schema.json#/properties/kind` and `db-schema.md` § scan_nodes).
  -- A CHECK whitelist would close what the spec keeps open.
  CONSTRAINT ck_scan_nodes_stability CHECK (stability IS NULL OR stability IN ('experimental','stable','deprecated'))
);
CREATE INDEX ix_scan_nodes_kind ON scan_nodes(kind);
CREATE INDEX ix_scan_nodes_provider ON scan_nodes(provider);
CREATE INDEX ix_scan_nodes_body_hash ON scan_nodes(body_hash);
CREATE INDEX ix_scan_nodes_sidecar_status ON scan_nodes(sidecar_status);

CREATE TABLE scan_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_path TEXT NOT NULL,
  target_path TEXT NOT NULL,
  kind TEXT NOT NULL,
  confidence REAL NOT NULL,
  sources_json TEXT NOT NULL,
  original_trigger TEXT,
  normalized_trigger TEXT,
  location_line INTEGER,
  location_column INTEGER,
  location_offset INTEGER,
  -- JSON array of `LinkOccurrence` objects (every syntactic site in
  -- the source body that contributed to this edge). NULL when the
  -- link has no body-level evidence (frontmatter / sidecar-derived).
  -- Populated by extractors at emit time, accumulated by
  -- `dedupeLinks` across extractor merges. Read by
  -- `core/redundant-target-reference` and surfaced via `/api/links`
  -- so the UI can list per-row sites.
  occurrences_json TEXT,
  -- Node path the link resolved to per the post-walk lift transform.
  -- NULL when the link is unresolved (broken). Equal to `target_path`
  -- for path-style links; differs for trigger-style links (`@foo`,
  -- `/cmd`) where `target_path` keeps the authored trigger and
  -- `resolved_target` carries the resolved node path. The BFF's
  -- `?to=<path>` filter matches on EITHER column so an `@real-agent`
  -- mention surfaces in the incoming list of
  -- `.claude/agents/real-agent.md`.
  resolved_target TEXT,
  raw TEXT,
  CONSTRAINT ck_scan_links_kind CHECK (kind IN ('invokes','references','mentions','supersedes')),
  CONSTRAINT ck_scan_links_confidence CHECK (confidence >= 0.0 AND confidence <= 1.0)
);
CREATE INDEX ix_scan_links_source_path ON scan_links(source_path);
CREATE INDEX ix_scan_links_target_path ON scan_links(target_path);
CREATE INDEX ix_scan_links_normalized_trigger ON scan_links(normalized_trigger);
CREATE INDEX ix_scan_links_resolved_target ON scan_links(resolved_target);

CREATE TABLE scan_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  analyzer_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  node_ids_json TEXT NOT NULL,
  link_indices_json TEXT,
  message TEXT NOT NULL,
  detail TEXT,
  fix_json TEXT,
  data_json TEXT,
  CONSTRAINT ck_scan_issues_severity CHECK (severity IN ('error','warn','info'))
);
CREATE INDEX ix_scan_issues_analyzer_id ON scan_issues(analyzer_id);
CREATE INDEX ix_scan_issues_severity ON scan_issues(severity);

-- --- State zone ------------------------------------------------------------

CREATE TABLE state_jobs (
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL,
  action_version TEXT NOT NULL,
  node_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  nonce TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  failure_reason TEXT,
  runner TEXT,
  ttl_seconds INTEGER NOT NULL,
  file_path TEXT,
  created_at INTEGER NOT NULL,
  claimed_at INTEGER,
  finished_at INTEGER,
  expires_at INTEGER,
  submitted_by TEXT,
  CONSTRAINT ck_state_jobs_status CHECK (status IN ('queued','running','completed','failed')),
  CONSTRAINT ck_state_jobs_failure_reason CHECK (failure_reason IS NULL OR failure_reason IN ('runner-error','report-invalid','timeout','abandoned','job-file-missing','user-cancelled')),
  CONSTRAINT ck_state_jobs_runner CHECK (runner IS NULL OR runner IN ('cli','skill','in-process'))
);
CREATE INDEX ix_state_jobs_status ON state_jobs(status);
-- Unique partial index for duplicate-job detection: at most one
-- queued/running job per (action_id, node_id, content_hash).
CREATE UNIQUE INDEX ix_state_jobs_action_node_hash
  ON state_jobs(action_id, node_id, content_hash)
  WHERE status IN ('queued','running');

CREATE TABLE state_executions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  extension_id TEXT NOT NULL,
  extension_version TEXT NOT NULL,
  node_ids_json TEXT NOT NULL DEFAULT '[]',
  content_hash TEXT,
  status TEXT NOT NULL,
  failure_reason TEXT,
  exit_code INTEGER,
  runner TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER NOT NULL,
  duration_ms INTEGER,
  tokens_in INTEGER,
  tokens_out INTEGER,
  report_path TEXT,
  job_id TEXT,
  CONSTRAINT ck_state_executions_kind CHECK (kind IN ('action')),
  CONSTRAINT ck_state_executions_status CHECK (status IN ('completed','failed','cancelled'))
);
CREATE INDEX ix_state_executions_extension_id ON state_executions(extension_id);
CREATE INDEX ix_state_executions_started_at ON state_executions(started_at);
CREATE INDEX ix_state_executions_job_id ON state_executions(job_id);

CREATE TABLE state_summaries (
  node_id TEXT NOT NULL,
  -- `kind` is open-by-design (mirrors `scan_nodes.kind` — see the
  -- comment there for the spec rationale).
  kind TEXT NOT NULL,
  summarizer_action_id TEXT NOT NULL,
  summarizer_version TEXT NOT NULL,
  body_hash_at_generation TEXT NOT NULL,
  generated_at INTEGER NOT NULL,
  summary_json TEXT NOT NULL,
  PRIMARY KEY (node_id, summarizer_action_id)
);
CREATE INDEX ix_state_summaries_generated_at ON state_summaries(generated_at);

CREATE TABLE state_enrichments (
  node_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  data_json TEXT NOT NULL,
  verified INTEGER,
  fetched_at INTEGER NOT NULL,
  stale_after INTEGER,
  PRIMARY KEY (node_id, provider_id),
  CONSTRAINT ck_state_enrichments_verified CHECK (verified IS NULL OR verified IN (0,1))
);
CREATE INDEX ix_state_enrichments_stale_after ON state_enrichments(stale_after);

CREATE TABLE state_plugin_kvs (
  plugin_id TEXT NOT NULL,
  node_id TEXT NOT NULL DEFAULT '',
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (plugin_id, node_id, key)
);
CREATE INDEX ix_state_plugin_kvs_plugin_id ON state_plugin_kvs(plugin_id);

-- Per-node "favorite" flag persisted per user (single-user local DB).
-- Zone `state_` because favorites are user-authored preference and must
-- survive `sm scan` truncation and `sm db reset` (which drops only
-- `scan_*`). Absence of a row means "not favorited".
--
-- `node_path` is FK-semantic to `scan_nodes.path`. The rename heuristic
-- (`migrateNodeFks` in src/kernel/adapters/sqlite/history.ts) MUST migrate
-- rows here when a path is renamed, same protocol as the other state_*
-- tables. Simple PK update — no composite key, no collision shape.
--
-- The BFF's `/api/nodes` route loads the full set of paths once per
-- request (typical favorite count is small) and decorates the in-memory
-- node list with a derived `isFavorite` boolean by Set membership. No
-- SQL JOIN against `scan_nodes` is required.

CREATE TABLE state_node_favorites (
  node_path TEXT PRIMARY KEY,
  favorited_at INTEGER NOT NULL
);

-- --- Config zone -----------------------------------------------------------

CREATE TABLE config_plugins (
  plugin_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  config_json TEXT,
  updated_at INTEGER NOT NULL,
  CONSTRAINT ck_config_plugins_enabled CHECK (enabled IN (0,1))
);

CREATE TABLE config_preferences (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE config_schema_versions (
  scope TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  description TEXT NOT NULL,
  applied_at INTEGER NOT NULL,
  PRIMARY KEY (scope, owner_id, version),
  CONSTRAINT ck_config_schema_versions_scope CHECK (scope IN ('kernel','plugin'))
);

-- --- Scan meta envelope ----------------------------------------------------
-- Persists scan-result metadata so `loadScanResult` returns real values for
-- `roots`, `scannedAt`, `scannedBy`, `providers`, and the non-derivable
-- `stats` fields (filesWalked / filesSkipped / durationMs) instead of a
-- synthetic envelope. Single-row table (CHECK id = 1); replaced atomically
-- with the rest of the scan_* zone on every `sm scan` via
-- `persistScanResult`.
--
-- Per `spec/cli-contract.md` §Scope is always project-local, the
-- `scope` column was removed; every scan resolves against
-- `<cwd>/.skill-map/` and the on-the-wire `ScanResult` no longer
-- carries a `scope` field.

CREATE TABLE scan_meta (
  id INTEGER PRIMARY KEY,
  roots_json TEXT NOT NULL,
  scanned_at INTEGER NOT NULL,
  scanned_by_name TEXT NOT NULL,
  scanned_by_version TEXT NOT NULL,
  scanned_by_spec_version TEXT NOT NULL,
  providers_json TEXT NOT NULL,
  stats_files_walked INTEGER NOT NULL,
  stats_files_skipped INTEGER NOT NULL,
  stats_duration_ms INTEGER NOT NULL,
  CONSTRAINT ck_scan_meta_singleton CHECK (id = 1)
);

-- --- Fine-grained scan cache ----------------------------------------------
-- Phase 4 / A.9 — per-(node, extractor) cache breadcrumbs. Lets the
-- orchestrator skip rerunning extractors against an unchanged body when the
-- same extractor already ran against that body_hash, and — critically —
-- detect when a NEW extractor was registered between scans (no row yet for
-- that pair) so the new extractor runs over the cached node without
-- requiring a full cache invalidation. Replace-all on every persist:
-- obsolete rows (extractor uninstalled since the last scan) disappear
-- automatically and cannot mask a stale cache hit.
--
-- `sidecar_annotations_hash_at_run` participates in the cache key
-- alongside `body_hash_at_run`. Without it the cache silently reused
-- prior contributions after a `.sm`-only edit (`core/stability`,
-- `core/annotations`, any other sidecar-reading extractor). The column
-- is NOT NULL — every emitter writes the SHA-256 of the canonical-form
-- `node.sidecar.annotations` (`'{}'` when the sidecar is absent or
-- carries no annotations). The cache decision consults the hash
-- unconditionally; an author-facing opt-in flag was rejected because
-- forgetting it produces silent stale-data bugs and the cost of
-- universal invalidation (one extractor re-run on `.sm` edits) is
-- negligible.

CREATE TABLE scan_extractor_runs (
  node_path TEXT NOT NULL,
  extractor_id TEXT NOT NULL,
  body_hash_at_run TEXT NOT NULL,
  sidecar_annotations_hash_at_run TEXT NOT NULL,
  ran_at INTEGER NOT NULL,
  PRIMARY KEY (node_path, extractor_id)
);
CREATE INDEX ix_scan_extractor_runs_node ON scan_extractor_runs(node_path);
CREATE INDEX ix_scan_extractor_runs_extractor ON scan_extractor_runs(extractor_id);

-- --- Universal enrichment layer --------------------------------------------
-- Phase 4 / A.8 — stores `ctx.enrichNode(partial)` outputs separately from
-- the author-supplied frontmatter (which remains immutable from Extractors).
-- Extractors are deterministic-only; rows regenerate via the A.9 fine-grained
-- cache and simply overwrite the prior row via PRIMARY KEY conflict on the
-- next scan. The `stale` and `is_probabilistic` columns are persisted but
-- inert in this revision (always 0); they are reserved for the future
-- Action-issued probabilistic enrichment revision (queued LLM jobs that
-- must preserve paid output across body changes).
--
-- Read-side `node.merged` view (helper `mergeNodeWithEnrichments`):
-- author frontmatter + non-stale enrichments ordered by enriched_at ASC,
-- last-write-wins per field. Analyzers / `sm check` / `sm export` consume the
-- author frontmatter by default (CI-safe deterministic baseline);
-- enrichment consumption is opt-in.

CREATE TABLE node_enrichments (
  node_path TEXT NOT NULL,
  extractor_id TEXT NOT NULL,
  body_hash_at_enrichment TEXT NOT NULL,
  value_json TEXT NOT NULL,
  stale INTEGER NOT NULL DEFAULT 0,
  enriched_at INTEGER NOT NULL,
  is_probabilistic INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (node_path, extractor_id),
  CONSTRAINT ck_node_enrichments_stale CHECK (stale IN (0, 1)),
  CONSTRAINT ck_node_enrichments_is_probabilistic CHECK (is_probabilistic IN (0, 1))
);
CREATE INDEX ix_node_enrichments_node ON node_enrichments(node_path);
CREATE INDEX ix_node_enrichments_stale ON node_enrichments(stale);

-- --- View contribution layer ----------------------------------------------
-- Phase 3 / View contribution system. Per-node typed data emitted by
-- extractors via `ctx.emitContribution(id, payload)` (and analyzers via
-- `ctx.emitScopeContribution(id, payload)` for scope-level slots).
-- Belongs to the `scan_*` family — cleared on every scan and repopulated
-- by emissions; NOT analogous to the plugin-private `state_plugin_kvs`
-- (which the plugin manages).
--
-- See `spec/architecture.md` § View contribution system → Persistence
-- and `ROADMAP.md` § UI contribution system → Persistence for the
-- normative contract. The kernel publishes the closed catalog of
-- slots at `spec/schemas/view-slots.schema.json#/$defs/SlotName`;
-- payloads are AJV-validated at emit time against the per-slot
-- schemas in `$defs/payloads/<slot>` before reaching this table.
--
-- PK on `(plugin_id, extension_id, node_path, contribution_id)` so
-- re-emission of the same contribution for the same node REPLACES the
-- prior row. The qualified id mirrors the kernel's
-- `<pluginId>/<extensionId>/<contributionId>` identity.
--
-- Index on `node_path` for the inspector lazy-fetch path
-- (`GET /api/contributions/:pluginId/:contributionId?path=...`) and for
-- the rename heuristic (when a `.md` is renamed, the kernel migrates
-- `node_path` here alongside `scan_links` etc.). Without the index,
-- those reads scan the whole table; with it, they hit a B-tree.

CREATE TABLE scan_contributions (
  plugin_id TEXT NOT NULL,
  extension_id TEXT NOT NULL,
  node_path TEXT NOT NULL,
  contribution_id TEXT NOT NULL,
  -- Closed enum surfaced for fast filtering / debugging — the value
  -- mirrors `view-slots.schema.json#/$defs/SlotName`. Kept open at
  -- the SQL layer (no CHECK) by design: catalog evolution ships as
  -- a kernel + spec change with `sm plugins upgrade` migration; a
  -- hard CHECK here would force a DDL migration on every catalog
  -- rename and conflict with the upgrade verb's autonomy.
  slot TEXT NOT NULL,
  -- JSON-serialized payload, already validated against the slot's
  -- payload schema at emit time. Kept opaque at the SQL layer;
  -- readers (BFF, analyzers) parse on demand.
  payload_json TEXT NOT NULL,
  emitted_at INTEGER NOT NULL,
  PRIMARY KEY (plugin_id, extension_id, node_path, contribution_id)
);

CREATE INDEX ix_scan_contributions_node_path ON scan_contributions(node_path);
CREATE INDEX ix_scan_contributions_plugin_id ON scan_contributions(plugin_id);

-- scan_node_tags: dual-source tag system (Phase 2 — `tags` decision).
-- One row per (node_path, tag, source) triple. Projected at persist
-- time from `frontmatter.tags` (source='author') and
-- `sidecar.annotations.tags` (source='user'). Drives `sm list --tag`
-- and the UI's tag-faceted search; the (tag) index keeps lookups
-- O(log n). The same tag string MAY appear under both sources for the
-- same node (the PK accepts the pair); search returns the node once
-- via DISTINCT, the UI renders both chips with their attribution.
CREATE TABLE scan_node_tags (
  node_path TEXT NOT NULL,
  tag TEXT NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY (node_path, tag, source),
  CONSTRAINT ck_scan_node_tags_source CHECK (source IN ('author','user'))
);
CREATE INDEX ix_scan_node_tags_tag ON scan_node_tags(tag);
CREATE INDEX ix_scan_node_tags_node_path ON scan_node_tags(node_path);
