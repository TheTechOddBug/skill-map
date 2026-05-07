---
"@skill-map/cli": minor
---

Fold the four post-001 SQLite kernel migrations (`002_sidecar_columns.sql`, `003_drop_node_author.sql`, `004_sidecar_root_json.sql`, `005_node_favorites.sql`) into `001_initial.sql`. Pre-1.0 greenfield consolidation — no released consumer depends on the historical migration steps, so collapsing the schema evolution into a single up-only migration removes the per-step bookkeeping cost and gives new databases the final shape on first init. The runner now sees `user_version: 1` as the latest. Schema content unchanged from the pre-fold endpoint (sidecar denormalisation via `sidecar_present` / `sidecar_status` / `annotations_json`, `author` column dropped from `scan_nodes`, `sidecar_root_json` column, `state_node_favorites` table, `version INTEGER` per Decision #125).

**Breaking** (per the pre-1.0 minor convention — see CONTRIBUTING.md / `spec/versioning.md` §Pre-1.0): the schema reset means existing `.skill-map/skill-map.db` files from a pre-fold install need to be wiped (`rm -rf .skill-map/`) before re-running `sm init`; downstream users on built-from-source forks are advised the same.
