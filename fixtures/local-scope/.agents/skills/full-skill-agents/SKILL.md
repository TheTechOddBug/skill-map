---
name: full-skill-agents
description: Open-standard skill at the vendor-agnostic `.agents/skills/<name>/SKILL.md` path. Discovered by the `agent-skills` Provider, which any vendor (Anthropic, OpenAI, Google) can adopt without skill-map needing a vendor-specific copy.
tags:
  - fixture
  - reference
  - full
  - agents
  - skill
  - vendor-agnostic
---

# Full open-standard skill

Demonstrator skill for the neutral `.agents/skills/` convention. The schema mirrors Gemini's, only `name` + `description` are required; everything else flows through via `additionalProperties: true`. Pairs with #full-skill-claude and #full-skill-gemini for cross-vendor comparison.
