---
"@skill-map/cli": patch
---

Fix `core/link-conflict` embedding two literal NUL bytes (0x00) as the `(source, target)` group-key separator: git treated the file as binary so its diffs were hidden in review and grep skipped it. The separator is now a plain JS unicode escape (still NUL at runtime, identical behavior) and the hardcoded `pluginId: 'core'` reads the shared `CORE_PLUGIN_ID` const like the other core analyzers.
