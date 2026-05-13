---
name: full-skill-gemini
description: Reference Gemini skill. Google's documented Gemini Agent Skill format requires only `name` and `description` from the universal spec base; the schema permits `additionalProperties: true` so the optional `tags` block flows through unchanged.
tags:
  - fixture
  - reference
  - full
  - gemini
  - skill
---

# Full Gemini skill

Demonstrator Gemini skill, exhaustively populated within the bounds of Google's documented frontmatter (just `name` + `description` per https://geminicli.com/docs/cli/creating-skills/). The extra `tags` array is allowed via `additionalProperties: true`. Pairs with @full-agent-gemini and #full-skill-claude (the Claude-side counterpart).
