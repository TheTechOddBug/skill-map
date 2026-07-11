---
"@skill-map/cli": patch
---

Node cards no longer show a "0 B" byte size for virtual / derived nodes (`mcp://<server>`), which have no backing file. The byte pill now hides when a node carries no file mtime, the way the tokens pill already hides on a null count.

## User-facing

MCP nodes on the map no longer show a meaningless "0 B" size.
