-- Phase 3 / View contribution system — `scan_contributions` table.
--
-- Per-node typed data emitted by extractors via `ctx.emitContribution(id,
-- payload)` (and rules via `ctx.emitScopeContribution(id, payload)` for
-- scope-level contracts). Belongs to the `scan_*` family — cleared on
-- every scan and repopulated by emissions; NOT analogous to the
-- plugin-private `state_plugin_kvs` (which the plugin manages).
--
-- See `spec/architecture.md` § View contribution system → Persistence
-- and `ROADMAP.md` § UI contribution system → Persistence for the
-- normative contract. The kernel publishes the closed catalog of
-- contracts at `spec/schemas/view-contracts.schema.json#/$defs/ContractName`;
-- payloads are AJV-validated at emit time against the per-contract
-- schemas in `$defs/payloads/<contract>` before reaching this table.
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
--
-- Up-only. Wrapped in BEGIN / COMMIT by the runner.

CREATE TABLE scan_contributions (
  plugin_id TEXT NOT NULL,
  extension_id TEXT NOT NULL,
  node_path TEXT NOT NULL,
  contribution_id TEXT NOT NULL,
  -- Closed enum surfaced for fast filtering / debugging — the value
  -- mirrors `view-contracts.schema.json#/$defs/ContractName`. Kept open
  -- at the SQL layer (no CHECK) by design: catalog evolution ships as
  -- a kernel + spec change with `sm plugins upgrade` migration; a hard
  -- CHECK here would force a DDL migration on every catalog rename
  -- and conflict with the upgrade verb's autonomy.
  contract TEXT NOT NULL,
  -- JSON-serialized payload, already validated against the contract's
  -- payload schema at emit time. Kept opaque at the SQL layer; readers
  -- (BFF, rules) parse on demand.
  payload_json TEXT NOT NULL,
  emitted_at INTEGER NOT NULL,
  PRIMARY KEY (plugin_id, extension_id, node_path, contribution_id)
);

CREATE INDEX ix_scan_contributions_node_path ON scan_contributions(node_path);
CREATE INDEX ix_scan_contributions_plugin_id ON scan_contributions(plugin_id);
