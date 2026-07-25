---
"@skill-map/cli": patch
"@skill-map/spec": patch
---

`GET /api/mcp/status` now reports `url`, the endpoint a client should register, built by the server from its own bind. Quick Start's MCP row uses it instead of the page origin, which named the dev proxy's port under a split dev setup. The row also stops assuming every runtime has an `mcp` CLI verb: Antigravity and OpenCode have none, so they copy a whole config document plus the file it goes in, always a personal one (OpenCode's global config, never the project file a team commits).

## User-facing

The MCP setup command now carries the port your server is really on, and Antigravity and OpenCode get a ready config file to save. It always points at your own config, never at a file your repository shares with the team.
