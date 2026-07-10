---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Promotes the `core/mcp-tools` extractor from `experimental` to `beta`, so it now ships ENABLED by default. A project whose skills or agents declare `tools: [mcp__<server>__<tool>]` in frontmatter gets the `mcp://<server>` nodes and reference edges on the map out of the box, no manual enable needed. Justified now that config-side discovery and live invocation (claude + codex) have landed.

## User-facing

MCP tools declared in your skills or agents now show on the map by default: skill-map draws the `mcp://<server>` node and an arrow to it without you enabling anything.
