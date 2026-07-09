---
"@skill-map/cli": minor
---

Implements the read-only MCP server for `sm serve`: an opt-in Streamable HTTP endpoint at `/mcp` (stateful sessions) exposing four query tools (query_graph, get_node, list_issues, get_branch) and skillmap:// resources for the graph, issues, activity, and per-node views, pushing live `notifications/resources/updated` off the scan broadcaster. Enabled via `--mcp` / `--no-mcp` or `mcp.server.enabled` (off by default), behind the same loopback-Origin gate as `/api` and `/ws`.

## User-facing

`sm serve --mcp` (or `mcp.server.enabled`) now exposes an opt-in, read-only Model Context Protocol server at `/mcp`, so an MCP host like Claude Code can query your project's graph as tools and read it as resources, with live updates as the map changes.
