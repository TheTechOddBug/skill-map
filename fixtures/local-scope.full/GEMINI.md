---
name: gemini-context
description: Project context file Gemini CLI loads at session start. Equivalent to CLAUDE.md but on the Gemini side; documents the same acme-toolkit domain so a Gemini-driven session has the same shared understanding.
tags:
  - documentation
  - gemini
  - context
---

# acme-toolkit (Gemini context)

The fictional acme-toolkit scope used by skill-map's local-dev fixture. This file mirrors `README.md` (the Claude-side context) so a Gemini session running over the same project starts with the same shared understanding.

## Project conventions

- **Layers**: `presentation` (Angular components), `domain` (pure TypeScript services), `infra` (HTTP / storage adapters). Boundary crossings need an explicit DTO.
- **Refactor passes**: cluster near-duplicates with #refactor-detector; review with @architect.
- **Test runs**: defer to @test-runner; raw `vitest --run` discouraged in PR loops.

## Vendor split

skill-map exists precisely so a multi-vendor project (Claude + Gemini side-by-side) reads as one connected graph. Pieces that live under `.claude/` are owned by the Claude Provider; pieces under `.gemini/` are owned by the Gemini Provider; `.agents/skills/` is the open-standard path the neutral `agent-skills` Provider claims so neither vendor squats it.
