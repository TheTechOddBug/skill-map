---
'@skill-map/cli': patch
---

The Settings modal now re-opens on the last section the user visited (persisted per project in the browser, `sm.settings.section`) instead of always landing on Plugins. A remembered per-plugin section whose plugin no longer offers settings falls back to the Plugins panel, and explicit deep-links (like the drift banner opening Project) still win and become the new remembered section.

## User-facing

Settings now opens where you left it: the modal remembers the last section you visited instead of always starting on Plugins.
