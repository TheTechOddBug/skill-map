---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

The antigravity activity adapter now maps a live MCP tool call to a PATH signal on the `mcp://<server>` node. Antigravity funnels every MCP call through a generic `call_mcp_tool` wrapper carrying the server in `toolCall.args.ServerName`, so the adapter reads that (not a `mcp__<server>__<tool>` name like Claude / Codex) and lights the same node `core/mcp-tools` draws from frontmatter. The `PreToolUse` matcher widens to `^(view_file|call_mcp_tool)$`; re-run the activity installer.

## User-facing

Under the Antigravity lens, calling an MCP tool (like Notion) now lights its node on the map in real time, the same as Claude and Codex. Re-run the activity installer so the hook catches MCP calls.
