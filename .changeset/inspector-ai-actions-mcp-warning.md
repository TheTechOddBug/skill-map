---
"@skill-map/cli": patch
---

The node inspector's AI Actions section now shows a non-blocking warning when no client is connected to skill-map's MCP server (probed via `GET /api/mcp/status`, an O(1) read), so you know that actions you launch may queue without running until an agent connects. The copy is honest that a CLI agent draining the queue also counts, and points to Quick Start for setup.

## User-facing

The inspector's AI Actions now warns you when no agent is connected to the MCP server, so a launched action sitting unprocessed in the queue is no surprise.
