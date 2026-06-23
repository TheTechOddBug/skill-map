---
"@skill-map/cli": patch
"@skill-map/spec": patch
---

The `/api/branch` map projection now keeps an edge when its RESOLVED target is a rendered node, not only when the raw authored target is. Trigger-style `invokes` / `mentions` links store the trigger (`/cmd`, `@agent`) in `target` and the real node path in `resolvedTarget`; the old filter matched the raw target alone, so every resolved trigger edge was dropped from the graph and the map showed only path-style `references`. Genuinely-broken links (no resolved node) stay excluded.

## User-facing

The graph map again draws `invokes` and `mentions` arrows (a command running a skill, an agent referenced by name), not just plain file references. A recent change had hidden every resolved trigger edge from the map.
