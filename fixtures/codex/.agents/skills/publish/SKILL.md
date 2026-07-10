---
name: publish
description: |
  Publishes the portfolio: runs the link check, follows the deploy
  runbook, then mirrors the pages to Notion.
---

# publish

The one skill you run when the site is ready to go out.

## Steps
1. Run $check-links on the pages in public/. If it reports broken links, stop and fix them first.
2. If a page needs a content fix, hand it to the content-editor agent before continuing.
3. Follow the [deploy runbook](../../../docs/DEPLOY.md): regenerate pages, run the link check, start the server.
4. Mirror the published pages to Notion: run $notion-publish, which creates a Notion page per site page via the Notion MCP (needs your Notion auth configured).
