---
description: "Deprecated. Mirror a single page into Notion by following the notion-publish skill. Superseded by /publish, which mirrors every page to Notion on release; kept only so existing references keep resolving."
---

# notion-writer (deprecated)

> Deprecated: use /publish, which runs /notion-publish for the whole site.
> This standalone workflow stays only for a one-off page sync.

Pushes a single page to Notion by delegating to the publishing skill; it
never calls the MCP tool directly.

1. Mirror the page

   Invoke /notion-publish: it creates the Notion page by calling
   `mcp__notion__notion-create-pages`, drawing the `mcp://notion` edge.

2. Return the Notion link it produced.
