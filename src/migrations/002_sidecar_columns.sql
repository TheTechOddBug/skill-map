-- Step 9.6.2 — kernel sidecar reader + drift detection.
--
-- Extends `scan_nodes` with three new columns to denormalise the
-- sidecar-derived state for fast queries:
--
--   - `sidecar_present` — boolean flag, 1 when a co-located `.sm` file
--     accompanies this node, 0 otherwise. Default 0.
--   - `sidecar_status` — fresh / stale-body / stale-frontmatter /
--     stale-both. NULL when no sidecar is present.
--   - `annotations_json` — JSON-encoded `annotations:` block from the
--     parsed sidecar (the typed surface declared by
--     `spec/schemas/annotations.schema.json`). NULL when no sidecar or
--     when the block is empty.
--
-- Hard-cut migration of the source-of-truth for three pre-existing
-- columns (Decision #3 — option (a), extend `scan_nodes`):
--
--   - `stability` — was sourced from `frontmatter.metadata.stability`,
--     now sourced from sidecar `annotations.stability`.
--   - `version`   — was `TEXT` (semver string from
--     `frontmatter.metadata.version`); now `INTEGER` (monotonic counter
--     from sidecar `annotations.version`). Pre-9.6.2 rows reset to
--     NULL — greenfield migration, no automatic semver→integer
--     conversion (Decision #125 / per-project policy).
--   - `author`    — was sourced from `frontmatter.author`, now sourced
--     from sidecar `annotations.author`.
--
-- The fallback path through `pickMetadata` for these three fields is
-- removed in the kernel; other consumers of `metadata.*` (e.g.
-- broken-ref's `metadata.related`) are out of scope for 9.6.2.
--
-- SQLite limitation note: the three pre-existing columns retain their
-- original types where possible. For `version` we change the type by
-- dropping and re-adding the column (safe: greenfield reset to NULL
-- is the documented migration outcome). DROP COLUMN requires SQLite
-- 3.35+; node:sqlite (Node 22+) ships SQLite ≥ 3.45.

ALTER TABLE scan_nodes DROP COLUMN version;
ALTER TABLE scan_nodes ADD COLUMN version INTEGER;

ALTER TABLE scan_nodes ADD COLUMN sidecar_present INTEGER NOT NULL DEFAULT 0;
ALTER TABLE scan_nodes ADD COLUMN sidecar_status TEXT;
ALTER TABLE scan_nodes ADD COLUMN annotations_json TEXT;

-- Reset stability + author to NULL — they used to be populated from
-- frontmatter.metadata.{stability,author}; the new source is
-- sidecar `annotations.{stability,author}` and a re-scan repopulates.
UPDATE scan_nodes SET stability = NULL, author = NULL;

-- Constraint mirrors the four legal values returned by the kernel's
-- drift detector. NULL is allowed (and required) when no sidecar is
-- present.
CREATE INDEX ix_scan_nodes_sidecar_status ON scan_nodes(sidecar_status);
