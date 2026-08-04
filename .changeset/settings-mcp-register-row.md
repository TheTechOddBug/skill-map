---
'@skill-map/cli': minor
---

Settings > Project gains an MCP registration row: the ready-to-paste snippet for the active lens (a command, or a config document plus its paste target) and a Copy button, reusing the catalog the Quick Start modal already uses. Both agent-facing rows now show a restart line naming that agent: the MCP one once the snippet is copied, the skill one once an install or update writes the file. Row order regrouped: skill install, MCP Server, MCP registration, symlink opt-in.

## User-facing

Settings now shows the exact line your agent needs to reach skill-map over MCP, with a Copy button, right under the MCP Server switch. Installing the skill or copying that line also reminds you to restart your agent, since agents read both only at startup.
