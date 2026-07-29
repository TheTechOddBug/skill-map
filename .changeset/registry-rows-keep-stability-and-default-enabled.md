---
'@skill-map/cli': patch
---

`toExtensionRow` dropped `stability` / `defaultEnabled` from every built-in registry row, and `bucketing.ts` never copied them onto user-plugin rows, so `installedDefaultEnabled` read `undefined` for both and answered "enabled": `github/enrichment` (experimental) and `core/node-bump` (`defaultEnabled: false`) registered on a project with no config at all. Execution was never affected, since those gates read live instances rather than rows, so the bug was registry visibility.

## User-facing

`sm help` and the plugin registry no longer list extensions that ship switched off, such as the GitHub enrichment and the version bump. They appear once you enable them.
