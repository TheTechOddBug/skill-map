---
name: Project handbook
description: How the OpenCode agents collaborate to ship this project.
---

# Project handbook

This project is driven by three OpenCode agents that hand off in sequence: a
builder implements, a reviewer signs off, and a deployer ships. Each agent's
prompt lives under `.opencode/agent/` and links the doc it owns.

The day-to-day loop is: run /test and /lint while building, then /deploy once
the reviewer approves. Those slash commands live under `.opencode/commands/`.

Architecture decisions are recorded in [the architecture doc](docs/architecture.md).
