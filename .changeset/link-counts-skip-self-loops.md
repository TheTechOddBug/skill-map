---
'@skill-map/cli': minor
---

`core/link-counts` analyzer no longer counts self-loop links toward the per-node footer chips (`linksIn` / `linksOut`). The chips disagreed with the `LinkedNodesPanel` sidecar which already filtered self-loops out of its outgoing / incoming lists.

## User-facing

Card chips for incoming / outgoing links no longer count self-loops, so a node that links back to itself stops showing inflated 1 in / 1 out. The `core/self-loop` analyzer still surfaces the self-reference as a warning, only the misleading count goes away.
