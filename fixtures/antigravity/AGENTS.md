# Portfolio handbook

A small static portfolio site, served by Express (`server.js`). The
Antigravity harness maintains it: a skill writes the pages, a skill checks
the links, a workflow publishes them, to the live site and, mirrored, to
Notion pages via the Notion MCP. The conventions live in the style guide;
the deploy steps in the deploy runbook. The pages still to build are tracked
in [the backlog](./docs/BACKLOG.md).

- When a page needs writing or fixing, invoke /content-editor.
- When the site is ready to go out, invoke /publish (it also mirrors the pages to Notion).
- To sync a single page to Notion by hand, invoke /notion-writer (deprecated, prefer /publish).

Workflows (`.agent/workflows/`) and skills (`.agents/skills/`) are both
invoked by `/<name>`. This file is plain Markdown (the open AGENTS.md rules
standard), classified by the universal `core/markdown` fallback, yet under
the antigravity lens its `/`-invocations still resolve, because the slash
extractor runs on every node body.
