---
name: Codex demo project
description: A wired OpenAI Codex corpus for the fix:codex dev scope.
---

# Codex demo project

A small example project wired for OpenAI Codex. `pnpm fix:codex` brings
skill-map up against it so you can see the codex lens classify the
`.codex/agents/*.toml` sub-agents and the `.agents/skills/*/SKILL.md`
skills (Codex reads skills from the open `.agents/skills/` layout), then
draw the links extracted from each agent's `developer_instructions`
prompt and each skill's body: mentions between agents (`@reviewer`),
slash invocations of skills (`/run-tests`), and references to the docs.
