---
'@skill-map/cli': patch
'@skill-map/spec': patch
---

The sm-process-jobs skill now resolves the MCP endpoint from the live `.skill-map/serve.json` (the running server's real host + port) instead of hardcoding the default port: the MCP-absent checklist probes that endpoint and every per-runtime register snippet carries the composed `<mcp-url>`, with `http://127.0.0.1:4242/mcp` surviving only when the file is absent. `spec/cli-contract.md` §Agent process skill names serve.json as the endpoint authority.

## User-facing

The agent processing skill now discovers the skill-map server's real port from the project (instead of assuming the default), so agents running against a custom port register and probe the right MCP address. Installed skills show an update in Settings; apply it to pick this up.
