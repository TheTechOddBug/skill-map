---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

`sm plugins show` is now extension-only: it takes a qualified `<plugin>/<ext>` id and renders one extension's detail. The whole-plugin view (manifest plus extension rows) moves to `sm plugins list <id>`, and the top-level `sm plugins list` index drops the per-extension name sub-lines. A bare `show <plugin>` id and a qualified `list <plugin>/<ext>` id are each rejected with a directed redirect to the other verb.

## User-facing

**Plugin commands split by altitude.** `sm plugins list <id>` now shows a whole plugin's extensions (kinds, versions, status); `sm plugins show` is for a single `<plugin>/<ext>` extension. The plain `sm plugins list` stays a clean index, one row per plugin.
