---
"@skill-map/cli": patch
---

Quick Start's agent liveness check no longer surfaces a raw duplicate-job error when a prior ping is still queued: it adopts the existing job as the probe and, if no agent claims it in time, cancels it so the next check starts clean. The "MCP installed on your agent" row stacks its Copy and Check buttons in a column so they stop crowding, and the inspector's MCP-disconnected notice is shorter and set in smaller type.

## User-facing

Quick Start's agent check no longer errors when a ping is already queued, and the MCP install step's buttons no longer crowd together.
