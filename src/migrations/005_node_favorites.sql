-- Per-node "favorite" flag persisted per user (single-user local DB).
--
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
