# Portfolio handbook

A small static portfolio site, served by Express (`server.js`). The OpenCode
harness maintains it: an agent writes the pages, a skill checks the links, a
command publishes them, to the live site and, mirrored, to Notion pages via the
Notion MCP. The conventions live in the style guide; the deploy steps in the
deploy runbook. The pages still to build are tracked in [the backlog](./docs/BACKLOG.md).

- For a full release, start with [the orchestrator agent](./.opencode/agent/orchestrator.md): it plans and delegates, it never edits a file itself.
- When a page needs writing or fixing, hand it to the content-editor agent.
- For a read-only survey (which pages exist, which links are dead), use [the researcher subagent](./.opencode/agent/researcher.md); it delegates the dead-link walk to [the link-auditor subagent](./.opencode/agent/link-auditor.md).
- When the site is ready to go out, run /publish (it also mirrors the pages to Notion).
- To sync a single page to Notion by hand, run the notion-writer subagent (deprecated, prefer /publish).

OpenCode is omnivorous about skills: the link checker lives under
`.claude/skills/` (authored for Claude Code) yet OpenCode reads it too, while
notion-publish is a native `.opencode/skills/` skill. Custom commands under
`.opencode/commands/` are slash-invocable; skills load through OpenCode's
native skill tool, not the slash.
