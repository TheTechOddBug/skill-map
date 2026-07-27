---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Map visibility flips to a deviation model (spec §Map scope overrides): rail checkboxes start CHECKED, unchecking excludes the subtree, and overrides inherit nearest-ancestor-wins. `/api/branch` and MCP `get_branch` gain `exclude` / `excludeRoot` params evaluated server-side before the render cap; bare `?path=` keeps its historical union meaning via an inference rule, so existing callers are unaffected. The old localStorage include-set migrates automatically.

## User-facing

The file checkboxes now tell the truth: everything starts checked, unchecking a folder hides it from the map, and re-checking something inside brings just that part back. New files show up on the map by default. Use the new header checkbox to hide or show everything at once.
