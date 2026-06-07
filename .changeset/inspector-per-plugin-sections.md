---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Inspector body view contributions now render one collapsible section per plugin (titled by the trusted `pluginId`, collapsed by default) instead of a shared drawer; the `inspector.body.section` slot is retired. New optional inspector-only `order` fields on `plugin.json` (sorts sections) and the extension manifest (sorts bricks) drive layout, default 100. `inspector.action.button` is now uncapped.

## User-facing

Plugin contributions in the inspector now appear as one collapsed section per plugin, ordered by the new `order` fields you can set in `plugin.json` and your extension manifest. The inspector also shows every action button a plugin contributes.
