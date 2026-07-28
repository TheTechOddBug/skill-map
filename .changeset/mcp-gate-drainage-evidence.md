---
'@skill-map/cli': patch
---

The Quick Start "MCP installed on your agent" row now verdicts on the MCP server being ON (the attached-client count becomes a detail line refreshed by Check), and the AI-action submit gate dropped its MCP-session half: an agent draining the queue over the CLI holds no MCP session, so a healthy setup sat disabled as "mcp-disconnected" even after a green agent check. The gate now rides the skill install state plus drainage evidence (an observed claim or the manual check's verdict).

## User-facing

AI action buttons no longer lock up when your agent processes the queue without an MCP connection, and the Quick Start MCP row now simply shows whether the MCP server is on, reporting any attached agent after a Check.
