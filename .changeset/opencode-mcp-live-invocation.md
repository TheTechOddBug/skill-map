---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

The opencode activity adapter now maps a live MCP tool call to a PATH signal on the `mcp://<server>` node, closing the last live-invocation gap. OpenCode names MCP tools `<server>_<tool>` in `input.tool` with no explicit marker (a Notion call arrives as `notion_notion-create-pages`), so the adapter reads the server as the prefix before the first `_` and lets the resolver drop non-`mcp://` misses. The plugin already forwards every `tool.execute.before`, so this needs no reinstall.

## User-facing

Under the OpenCode lens, calling an MCP tool (like Notion) now lights its node on the map in real time, completing live MCP invocation for all four supported runtimes.
