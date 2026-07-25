---
"@skill-map/cli": patch
"@skill-map/spec": patch
---

`GET /api/mcp/status` now reports `url`, the endpoint a client should register, built by the server from its own bind. Quick Start's MCP row uses it instead of composing the URL from the page origin, which named the dev proxy's port under a split dev setup. The row also stops assuming every runtime has an `mcp` CLI verb: Antigravity and OpenCode have none, so they copy a ready config snippet plus the file it belongs in.

## User-facing

The MCP setup command now carries the port your server is really on, and Antigravity and OpenCode get a copyable config snippet instead of a vague instruction.
