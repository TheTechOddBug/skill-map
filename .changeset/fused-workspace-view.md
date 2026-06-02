---
"@skill-map/cli": minor
"@skill-map/spec": patch
---

Fuse the standalone files and map views into one workspace at `/`: a resizable files rail, the graph, and a floating inspector linked through the shared `?path` selection. The rail curates which nodes the map shows via per-file/per-folder visibility checkboxes, folder-depth presets, and an isolate-chain gesture (persisted to localStorage); the layout reset re-arranges only the visible nodes. Retires the `/files` and `/map` routes and the stability / has-issues / stale filters.

## User-facing

The Files and Map tabs are gone: skill-map opens on one screen, file tree left, graph right. Tick files or folders (or the 0/1/2 depth buttons) to pick what the map shows; the tree's map icon isolates a node's whole chain. "Re-arrange layout" tidies just what's visible.
