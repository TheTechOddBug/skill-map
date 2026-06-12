---
'@skill-map/cli': minor
---

The `tools-counter` extractor moved from the `core` plugin into the `claude` plugin: its qualified id is now `claude/tools-counter` (settings toggles keyed `core/tools-counter` no longer match), and disabling the `claude` plugin now drops the agent tools chip together with the provider it serves.
