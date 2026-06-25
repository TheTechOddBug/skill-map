---
name: Codex demo project
description: A wired OpenAI Codex corpus for the fix:codex dev scope.
---

# Codex demo project

A small example project wired for OpenAI Codex. `pnpm fix:codex` brings
skill-map up against it so you can see the openai lens classify the
`.codex/agents/*.toml` sub-agents and draw the links extracted from each
agent's `developer_instructions` prompt (mentions between agents,
references to the docs).
