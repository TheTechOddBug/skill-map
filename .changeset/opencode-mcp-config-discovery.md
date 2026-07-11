---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

OpenCode gains config-side MCP discovery: the opencode provider declares an `mcpConfig` source over `opencode.json`, and the JSON dialect now tolerates OpenCode's `mcp` top-level key plus its `type: remote/local` / `enabled` server shape (unlike Antigravity, OpenCode's MCP config is project-local and committable). So an `mcp://<server>` node materialises config-side from `opencode.json`, the same node `core/mcp-tools` draws from a skill's `tools:` frontmatter.

## User-facing

Under the OpenCode lens, MCP servers declared in your project's `opencode.json` now appear on the map as `mcp://` nodes, even when no skill references them.
