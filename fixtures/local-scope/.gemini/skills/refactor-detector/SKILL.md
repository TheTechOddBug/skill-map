---
name: refactor-detector
description: Detects opportunities to extract shared helpers from sibling files. Ships as a Gemini Agent Skill at the Gemini-namespaced path — distinct from the open-standard `.agents/skills/` adopted by all three vendors.
---

# Refactor detector

Walks a directory, clusters near-duplicate functions by AST shape, and proposes a single extraction site per cluster. The skill body is the agent's instructions; only `name` and `description` are required by Google's documented Skill format.

## Usage

When the user requests a refactor pass on a sub-tree:

1. Cluster functions by AST hash (length-normalised).
2. For each cluster ≥ 3 members, propose an extraction.
3. Defer the actual edit to a follow-up apply step once the user approves; the skill itself is read-only.

Pairs with @architect when the proposed extraction crosses module boundaries.
