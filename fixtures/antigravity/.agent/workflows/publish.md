---
description: "Publish the portfolio: run the link check, hand off any fixes to the content editor, follow the deploy runbook, then mirror the pages to Notion."
---

# Publish

The one workflow you run when the site is ready to go out.

1. Check the links

   Invoke /check-links on the pages in public/. If it reports broken links, stop and fix them first.

2. Fix any content

   If a page needs a content fix, invoke /content-editor with the change.

3. Deploy

   Follow the [deploy runbook](../../docs/DEPLOY.md): regenerate pages, run the link check, start the server.

4. Mirror to Notion

   Invoke /notion-publish, which creates a Notion page per site page via the Notion MCP (needs your Notion auth configured).
