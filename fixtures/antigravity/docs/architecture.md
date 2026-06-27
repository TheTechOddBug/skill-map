---
name: Architecture notes
description: How the project is structured and how the workflows compose.
---

# Architecture notes

The project automates its lifecycle with Antigravity workflows under
`.agent/workflows/` and shared skills under `.agents/skills/`. Workflows
chain into each other and into skills by slash invocation, so the deploy
path, the release path, and the scaffolder all reuse the same `run-tests`
skill.
