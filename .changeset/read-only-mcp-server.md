---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Implements the read-only MCP server for `sm serve`: an opt-in Streamable HTTP endpoint at `/mcp` (stateful sessions) exposing four query tools (query_graph, get_node, list_issues, get_branch) and skillmap:// resources for graph, issues, activity, and per-node views, with live `notifications/resources/updated` off the scan broadcaster. Enabled via `--mcp` / `--no-mcp` or the project-local `mcp.server.enabled` (off by default, toggleable from Settings > Project), behind the loopback-Origin gate.

## User-facing

`sm serve --mcp`, `mcp.server.enabled`, or a Settings > Project toggle now exposes an opt-in, read-only Model Context Protocol server at `/mcp`, so an MCP host like Claude Code can query your project graph as tools and read it as resources, with live updates as the map changes.
