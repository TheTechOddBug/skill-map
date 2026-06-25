---
name: Project handbook
description: How the Codex sub-agents collaborate to ship this project.
---

# Project handbook

This project is driven by four Codex sub-agents that hand off to each
other in sequence: an architect designs, a builder implements, a reviewer
signs off, and a releaser ships. Each agent's prompt links to the doc it
owns and mentions the next agent in the chain.

Two shared skills live under `.agents/skills/` (the open standard Codex
reads skills from): the builder invokes `/run-tests` before handoff, and
the releaser invokes `/changelog-entry` when cutting a release. Each
skill links the doc it leans on and mentions the agent that runs it.
