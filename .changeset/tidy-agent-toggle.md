---
'@skill-map/cli': patch
'@skill-map/spec': patch
---

New project-local `ui.showRuntimeAgents` preference (default `true`, subordinate to `ui.realtimeActivity`): gates the map's ephemeral capsules for runtime sub-agents that match no scanned node. Rides the standard preferences pipeline (`project-config` schema, `GET/PATCH /api/project-preferences`, a third toggle in Settings > Project's Real Time block); switching it off restores the pre-capsule rendering without touching resolved-node spawn edges or session anchors.

## User-facing

New toggle in Settings > Project, "Show runtime sub-agents": turn off the floating capsules for your agent's built-in helpers if you prefer the map to show only your own files. On by default.
