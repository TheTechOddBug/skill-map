-- Step 9.6 catalog-curation follow-up (2026-05-07).
--
-- Drop the vestigial `scan_nodes.author` column. The 9.6.2 migration
-- denormalised `annotations.author` into the column; the 2026-05-07
-- catalog curation removed `author` from `annotations.schema.json`,
-- which left the column without a canonical source. Anyone who still
-- writes `author:` in their `.sm` rides on `additionalProperties: true`
-- — the value lands in `annotations_json` (no longer in a typed
-- column), and `unknown-field` warns on it as a typo guard.
--
-- Greenfield drop: pre-9.6 rows had the column reset to NULL by
-- migration 002, and the curation rolled out before any released
-- consumer pinned the post-9.6.2 shape. No automatic salvage path —
-- if a deployed DB carried real data, it is preserved verbatim under
-- `scan_nodes.annotations_json` until the next scan rewrites the row.
--
-- DROP COLUMN requires SQLite 3.35+; node:sqlite (Node 22+) ships
-- SQLite ≥ 3.45.

ALTER TABLE scan_nodes DROP COLUMN author;
