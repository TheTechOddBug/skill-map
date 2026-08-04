---
'@skill-map/spec': minor
'@skill-map/cli': patch
---

`GET /api/mcp/status` verifies attendance instead of counting tracked sessions. A session ends only on `DELETE /mcp` or shutdown, which the reference SDK client never sends, so every agent that ever attached left one behind and the probe reported it as connected until the next `sm serve` restart. It now pings each session and counts only responders, reaping those that stay unreachable and silent past a grace window. Spec: `mcp-server.md` §Session liveness.

## User-facing

Quick Start's "MCP installed on your agent" check no longer reports a connected agent when none is running. It now asks the agent to answer before saying yes, so closing or killing your agent turns the row red on the next Check instead of staying green until you restart `sm`.
