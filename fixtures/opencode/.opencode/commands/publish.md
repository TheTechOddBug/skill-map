---
description: "Publish the portfolio: run the link check, hand off to the content editor, follow the deploy runbook, then mirror the pages to Notion."
agent: content-editor
---

The one command you run when the site is ready to go out.

1. Load [the check-links skill](../../.claude/skills/check-links/SKILL.md) and run it on public/. If it reports broken links, stop and fix them first.
2. If a page needs a content fix, hand it to [the content-editor agent](../agent/content-editor.md).
3. Follow [the deploy runbook](../../docs/DEPLOY.md): regenerate pages, run the link check, start the server.
4. Load [the notion-publish skill](../skills/notion-publish/SKILL.md), which mirrors each page to Notion via the Notion MCP (needs your Notion auth configured).
