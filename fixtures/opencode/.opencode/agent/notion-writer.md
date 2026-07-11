---
description: Deprecated. Mirrors a single page into Notion by following the notion-publish skill. Superseded by /publish, which mirrors every page to Notion on release; kept only so existing references keep resolving.
mode: subagent
model: anthropic/claude-opus-4-8
---

# notion-writer (deprecated)

> Deprecated: use /publish, which runs the notion-publish skill for the whole
> site. This standalone subagent stays only for a one-off page sync.

Pushes a single page to Notion by loading [the notion-publish
skill](../skills/notion-publish/SKILL.md), which calls
`mcp__notion__notion-create-pages` and lights the `mcp://notion` node on the
map. It never calls the MCP tool directly. Return the Notion link it produced.
