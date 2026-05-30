---
"@skill-map/cli": patch
---

`sm plugins create` now scaffolds a plugin that loads. The generated `plugin.json` drops the `id` and root `settings` keys (both rejected by the structure-as-truth `PluginManifest` schema), and the extractor stub declares `ui` instead of the dead `viewContributions` field, with its `settings` co-located per-extension. A freshly scaffolded plugin now passes `sm plugins doctor` and emits its contribution on `sm scan` instead of failing with `invalid-manifest`.
