# Portfolio handbook

A small static portfolio site, served by Express (`server.js`). The Codex
harness maintains it: an agent writes the pages, a skill checks the links,
a skill publishes them, to the live site and, mirrored, to Notion pages via
the Notion MCP. The conventions live in the style guide; the deploy steps in
the deploy runbook. The pages still to build are tracked in
[the backlog](./docs/BACKLOG.md).

- When a page needs writing or fixing, brief the content-editor agent.
- When the site is ready to go out, run $publish (it also mirrors the pages to Notion).
- To sync a single page to Notion by hand, brief notion-writer (deprecated, prefer $publish).
