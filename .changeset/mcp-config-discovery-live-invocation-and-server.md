---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

MCP support lands in three parts. A declarative `mcpConfig` Provider capability and a shared kernel MCP parser materialise `mcp://<server>` nodes from a project's config files, canonical over the consumer-side `core/mcp-tools` emission. Live MCP tool calls light the same node: `node.activity` gains `detail`/`access` and the recent ring records typed `mcp`/`read` entries with `caller`/`target`. A read-only MCP server (`spec/mcp-server.md`) is specified on `sm serve` at `/mcp` (off by default).

## User-facing

The map now shows the MCP servers your project configures and lights them live when an agent calls a tool. The inspector logs each MCP tool call and file read with who ran it. `sm serve` gains an opt-in read-only MCP server at `/mcp` (spec only so far).
