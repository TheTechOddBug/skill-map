---
name: experimental-agent
description: "Claude agent in active development. Demonstrates the `stability: experimental` annotation paired with partial vendor-field coverage, the shape new agents typically have before being promoted to stable."
tags:
  - fixture
  - experimental
  - claude
  - agent
model: sonnet
tools:
  - Read
  - Grep
effort: medium
color: orange
---

# Experimental Claude agent

Scaffolded for a new review flow that is not yet ready for promotion. The annotation `stability: experimental` in the sidecar warns consumers the contract may shift. Pairs with #experimental-skill and points back to @full-agent-claude as the stable reference shape.
