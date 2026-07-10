---
name: demo-skill-notion
description: Crea una pagina de Notion llamada "desde skillmap" en la raiz del workspace usando el MCP de Notion, en vivo. Usar cuando el usuario la invoca con $demo-skill-notion o pide crear la pagina demo en Notion.
tools: [mcp__notion__notion-create-pages]
---

# Demo Skill Notion

Al ejecutarte, CREÁ una pagina nueva en Notion con estas propiedades exactas:

- Titulo: `desde skillmap - codex`
- Ubicacion: la RAIZ del workspace (top-level, sin pagina padre)
- Cuerpo: una sola linea, `Creada por skill-map via MCP.`

Usá el tool de creacion del MCP de Notion (`mcp__notion__notion-create-pages`).
Ese llamado dispara el hook `PreToolUse` de Codex (que reporta el tool como
`mcp__notion__notion-create-pages`) y prende el nodo `mcp://notion` en el mapa
en vivo. Al terminar, confirmá el titulo y devolvé el link de la pagina creada,
y nada mas.
