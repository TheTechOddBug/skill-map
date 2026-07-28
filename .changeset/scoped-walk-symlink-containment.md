---
'@skill-map/cli': patch
---

Applies the symlink containment gate to the scoped read, not just the directory traversal. The watcher's incremental pass checked containment lexically, so a file reached through a symlinked directory escaping the scan roots was read into the graph on the next save, despite `scan.followExternalSymlinks` being off. Both walks now resolve the real target first and agree: contained links are followed, escaping ones refused. Per-directory verdicts are memoised so the gate stays off the hot path.

## User-facing

Fixed: while watching a project, a symlinked folder pointing outside it could pull that outside content into your map. It is now refused unless you opt in, matching what a full scan already did.
