---
'@skill-map/cli': minor
---

Dismissing an issue with an analyzer id that does not exist is now refused on all three faces (CLI exit 2, HTTP 400, MCP invalid-params) before anything is written. It used to succeed silently and plant a permanent, never-matching `issueSuppressions` entry in the node's committed `.sm` sidecar, so a typo became repo state. Undismiss deliberately does NOT validate: a stale suppression whose plugin was uninstalled must stay removable.

## User-facing

Dismissing an issue with a misspelled analyzer name is now refused instead of silently recorded. Before, the typo was written into the node's committed `.sm` file and never matched anything.
