---
'@skill-map/cli': minor
'@skill-map/spec': minor
---

A drop-in extension's module is no longer imported unless its plugin is trusted and both the plugin and that extension are enabled. The four declarative fields (`version`, `description`, `stability`, `defaultEnabled`) moved to a per-extension `extension.json` beside `index.*`, so the decision no longer needs the code it governs; declaring them in the module is now `invalid-manifest`, `sm plugins upgrade` migrates them, and an untrusted plugin's inventory becomes listable. Built-ins are exempt.

## User-facing

**An extension you switch off no longer runs.** Its code is not even read until you trust the plugin and turn that extension on. `sm plugins list` now shows everything a plugin ships (ids, kinds, versions, maturity) before you trust it, instead of reporting `0 ext`.
