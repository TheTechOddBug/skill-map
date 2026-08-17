---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

New capture-level ladder: one cumulative runtime knob (`executions` < `reads` < `writes` < `mcp` < `shell`, default `mcp`) filtering resolved activity at ingest before stats, journal and broadcast, moved live via `POST /api/activity/capture-level` and persisted project-local (`activity.captureLevel`). Adapters now stamp `access: "write"` on write-shaped tools, recordings carry their minimum `captureLevel`, and the UI gains a selector beside Record plus a Settings mirror.

## User-facing

A capture-level selector next to Record (and in Settings) decides how much detail the live map and recordings keep, from executions only up to reads, writes and MCP calls, chosen before each recording (it locks while one runs). Writes now show as their own access type.
