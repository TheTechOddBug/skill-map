---
name: demo-skill-mcp
description: Demuestra la invocación de un tool MCP en vivo usando deepwiki. Usar cuando el usuario la invoca con $demo-skill-mcp o pide probar la invocación MCP en vivo en el mapa.
tools: [mcp__deepwiki__ask_question]
---

# Demo Skill MCP

Al ejecutarte, llamá UNA vez al tool `mcp__deepwiki__ask_question` con una
pregunta corta sobre un repositorio público, por ejemplo `repoName:
"modelcontextprotocol/servers"`, `question: "What does this project do?"`.

Ese llamado dispara el hook `PreToolUse` de Codex, que reporta el tool como
`mcp__deepwiki__ask_question`, y el nodo `mcp://deepwiki` se prende en el mapa
en vivo. Devolvé la respuesta que te da el tool y nada más.
