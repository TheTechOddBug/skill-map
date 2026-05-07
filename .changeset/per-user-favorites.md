---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Per-user favorites. The UI gains a subtle heart button on every node card (stacked under the chevron in the actions cluster) plus a "Favorites only" toggle in the filter-bar that hides while the user has zero favorites. State persists across `sm scan` and `sm db reset` because favorites live in a new `state_node_favorites` table (zone `state_`).

**Spec.** New table in `spec/db-schema.md`: `state_node_favorites(node_path PRIMARY KEY, favorited_at INTEGER NOT NULL)`. Listed in the rename heuristic's FK migration set so renaming a favorited file preserves the mark. New optional `Node.isFavorite: boolean` field in `spec/schemas/node.schema.json` — decorated by the BFF on every `/api/nodes` and `/api/nodes/:pathB64` response; consumers that don't recognise it MUST ignore it.

**BFF.** Two new endpoints, both idempotent:
- `PUT /api/favorites/:pathB64` — 204 on success, 404 when the path is not in the persisted scan.
- `DELETE /api/favorites/:pathB64` — 204 always (un-favoriting an already-unmarked path is a no-op).

The `/api/nodes` route loads the favorites set once per request via a tiny `SELECT node_path FROM state_node_favorites` query and decorates each emitted node with `isFavorite` by `Set` membership in memory — no SQL JOIN against `scan_nodes`. Cost is `O(favorites)` per request (typical projects pin a handful of nodes).

**Storage.** New `port.favorites.{ set, unset, listPaths }` namespace on `StoragePort`. `migrateNodeFks` (rename heuristic) updates `state_node_favorites.node_path` alongside the other `state_*` tables; `findStrandedStateOrphans` scans it too. New `IMigrateNodeFksReport.nodeFavorites` counter; `sm orphans reconcile` summary line includes the count.

**Migration `005_node_favorites.sql`** creates the table. No backfill — fresh installs and existing scopes alike start with zero favorites.

**UI.** New `<sm-node-card>` `[isFavorite]` input + `(favoriteToggle)` output (path + new value). The graph view wires the output to `CollectionLoaderService.toggleFavorite(path, value)` which (a) flips the local store optimistically, (b) fires the BFF call, (c) rolls back on failure. The filter-bar's "Favorites only" toggle is gated by a `hasAnyFavorites` computed signal so the row stays uncluttered for first-time users; the toggle stays visible if the filter is currently active so the user can disable it after un-favoriting the last node.

**Out of scope (deliberate).**
- No CLI verb (`sm fav`). Favoriting is a visual / personal preference; the CLI surface stays focused on lifecycle verbs.
- No WebSocket broadcast on favorite toggle. Multi-tab sync (`favorite.set` / `favorite.unset` events) can land later if the use case surfaces.
- Demo (`StaticDataSource`) rejects favorite mutations with `code: 'demo-readonly'` — the optimistic flip rolls back, surfacing the read-only stance to the user.

Tests: `src/test/favorites-storage.test.ts` (CRUD + rename heuristic + collision report — 6 cases), `src/test/server-favorites-endpoint.test.ts` (PUT/DELETE happy paths, 404, idempotency, isFavorite decoration on the list and single-node routes — 9 cases). UI: 5 new cases in `node-card.spec.ts` and 4 in `collection-loader.spec.ts`.
