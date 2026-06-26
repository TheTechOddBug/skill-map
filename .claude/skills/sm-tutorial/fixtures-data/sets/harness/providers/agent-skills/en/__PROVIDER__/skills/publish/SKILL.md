---
name: publish
description: |
  Publishes the portfolio: runs the link check, hands off to the
  content editor for any last fixes, then follows the deploy runbook.
---

# publish

The one skill you run when the site is ready to go out.

## Steps
1. Run the [check-links](../check-links/SKILL.md) skill on the pages in public/. If it reports broken links, stop and fix them first.
2. If a page needs a content fix, hand the change to [content-editor](../content-editor/SKILL.md).
3. Follow the [deploy runbook](../../../docs/DEPLOY.md): regenerate pages, run the link check, start the server.
