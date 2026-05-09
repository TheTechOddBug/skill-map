---
name: diff-walker
description: Walks a unified diff hunk-by-hunk and emits one structured event per hunk. Vendor-agnostic by design — lives at the open-standard path `.agents/skills/<name>/SKILL.md` so Anthropic, OpenAI, and Google clients all pick it up without a vendor-specific Provider claiming it first.
tags:
  - diff
  - refactor
  - vendor-agnostic
  - parsing
---

# Diff walker

Open-standard skill demonstrating the neutral `agent-skills` Provider: any vendor that follows the joint Anthropic / OpenAI / Google `.agents/skills/` convention discovers it without skill-map having to add a vendor-specific copy.

## Usage

Pipe a unified diff into the agent. The skill emits, per hunk:

- `path` — the file the hunk touches.
- `range` — `{ before: { start, end }, after: { start, end } }`.
- `kind` — `add` | `delete` | `modify`.
- `body` — the verbatim hunk text.

Downstream agents (architect, test-runner, refactor-detector — whichever vendor) consume the event stream without re-parsing the diff.
