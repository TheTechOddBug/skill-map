---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Inspector action buttons are now self-projected by the dispatching Action instead of a sibling projector Analyzer: an Action may declare a `ui` button plus an optional deterministic scan-time `project(ctx)` (read-only graph) that emits its own `inspector.action.button` per node. The pure projector analyzers `core/supersede` and `core/tags` were removed and `core/annotation-stale` trimmed to its badge + issue (the Bump button moved to `core/node-bump`).

## User-facing

No change to how the inspector behaves: the Supersede, Edit tags, and Bump buttons look and work exactly as before, they are just now produced by the action they trigger rather than a separate analyzer.
