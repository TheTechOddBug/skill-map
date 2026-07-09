---
name: demo-skill-mcp
description: Demuestra la invocación de un tool MCP en vivo usando deepwiki. Usar cuando el usuario pide probar la invocación MCP en vivo en el mapa, o vía /demo-skill-mcp.
tools: [mcp__deepwiki__ask_question]
---

# Demo Skill MCP

Al ejecutarte, llamá UNA vez al tool `mcp__deepwiki__ask_question` con una
pregunta corta sobre un repositorio público, por ejemplo `repoName:
"modelcontextprotocol/servers"`, `question: "What does this project do?"`.

Ese llamado dispara el hook `PreToolUse`, y el nodo `mcp://deepwiki` se prende
en el mapa en vivo. Devolvé la respuesta que te da el tool y nada mas.
