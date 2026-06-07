---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Inspector action-button adopters: `core/node-stability`, `core/supersede` and a new `core/tags` analyzer emit Set stability / Supersede / Edit tags buttons, each parametrized via an input-type prompt pre-loaded with the current value, backed by deterministic actions `core/node-set-stability`, `core/node-set-tags`, `core/node-supersede`. A new `inspector.body.section` slot lets a plugin own a collapsible zone titled `<pluginId>:<zone>` with key/value content.

## User-facing

The inspector now offers Supersede, Set stability and Edit tags buttons; each opens a small form pre-filled with the node's current value. Plugins can also contribute their own collapsible section to the inspector body.
