---
"@skill-map/cli": minor
---

The `defaultEnabled` axis is honored end to end (`core/node-set-stability` and a now-stable `core/node-bump` ship disabled by default), the redundant `core/auto-fix` built-in is removed while the `job.completed` dispatch stays public, bump stamps `version: 1` on a versionless fresh sidecar, the inspector header hosts the stability and version chips as the Set-stability and Bump affordances, and stored analyses gain a delete endpoint and language-matched prompts.

## User-facing

**Stability and version now live next to the file's title.** Enable their plugins to see the chips; a versionless file shows "v?" and bump stamps v1. Analyses get a delete X and are written in the file's language. The auto-fix plugin is gone, the Auto-fixer toggle covers it.
