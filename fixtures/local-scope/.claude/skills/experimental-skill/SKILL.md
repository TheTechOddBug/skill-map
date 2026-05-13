---
name: experimental-skill
description: Claude skill in active development. Demonstrates the `stability: experimental` annotation with a partial frontmatter — common pattern for skills that are still iterating on their contract.
tags:
  - fixture
  - experimental
  - claude
  - skill
when_to_use: While the contract is still under review; not yet ready for production callers.
allowed-tools:
  - Read
  - Grep
model: sonnet
effort: low
---

# Experimental Claude skill

Used by @experimental-agent. Once promoted to stable, the annotation `stability` flips to `stable` and the skill joins the canonical surface alongside #full-skill-claude.
