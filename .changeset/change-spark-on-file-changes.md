---
"@skill-map/spec": patch
"@skill-map/cli": patch
---

The map now flashes a node once (~1s, theme primary color) when the live watcher detects its file changed on disk, gated by the new project-local `ui.changeSpark` preference (default on) and suppressed around agent activity so the executing glow never double-flashes. `scan.started` now reports its real `{ mode, roots }` payload (`changed` on watcher file-change batches, `full` otherwise) and `scan.progress` documents the actual per-node shape with `cached` / `partialCache` semantics.

## User-facing

**See file changes on the map.** When a file changes on disk (your editor saving, a git pull), its node now flashes briefly in your theme color so you notice the update. Your agent activity glow always wins. Turn it off in Settings > Project with Flash on file changes.
