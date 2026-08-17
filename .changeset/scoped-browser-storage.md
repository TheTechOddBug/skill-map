---
'@skill-map/spec': patch
'@skill-map/cli': minor
---

Browser-local project state (recording tape, node positions, map curation) is now namespaced per project: `sm serve` stamps the scope root into the served `index.html` as a `skill-map-scope` meta and the UI suffixes those localStorage keys with a hash of it, so two projects on one port stop seeing each other's sessions. A `sm.storage-version` gate resets stale layouts per-bump (this one wipes the pre-namespace era whole); `sm.scopes` maps hash to root for debugging.

## User-facing

Recorded sessions and your map layout now stay with their project: serving another folder on the same port no longer shows the other project's recordings. One-time cost on upgrade: node positions, curation and the browser tape reset (recordings on disk are kept).
