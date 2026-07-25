---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

New `GET /api/agent/presence` reports whether a processing agent has been observed claiming work since the server started, and the inspector's second warning uses it instead of the live MCP session count. That count was the wrong proxy: an agent parked on the CLI `sm jobs claim --wait` talks straight to SQLite and holds no MCP session, so a healthy setup warned forever. Both claim paths count now, and a startup ping learns the answer without waiting for traffic.

## User-facing

The inspector no longer claims no agent is available when one is running through the CLI: it now reports whether an agent has actually picked up work.
