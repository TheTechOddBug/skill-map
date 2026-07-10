---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Codex now lights the map live when the model calls an MCP tool. The `codex` activity adapter maps a `PreToolUse` for an `mcp__<server>__<tool>` call to a PATH signal on the `mcp://<server>` node (matcher widened to `^(spawn_agent|mcp__.+)$`), reusing the shared `mapMcpInvocation` (Codex reports the same `mcp__` hook tool name as Claude). The `realtime-codex` fixture gains a deepwiki MCP server and a `demo-skill-mcp`.

## User-facing

When your Codex session calls an MCP tool, skill-map now lights up that MCP node on the map live, the same as Claude Code.
