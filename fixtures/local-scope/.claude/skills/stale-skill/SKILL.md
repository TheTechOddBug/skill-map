---
name: stale-skill
description: Claude skill whose sidecar carries deliberately drifted hashes (`for.bodyHash` and `for.frontmatterHash` differ from the live `.md`). Demonstrates the stale-state chip rendered by the UI and the `sm sidecar refresh` workflow that fixes the drift.
tags:
  - fixture
  - stale
  - drift
  - claude
  - skill
when_to_use: Never; this fixture exists so the stale chip has a node to attach to.
model: sonnet
---

# Stale Claude skill

The matching `.sm` sidecar carries an intentional drift on both `for.bodyHash` and `for.frontmatterHash`. Running `sm sidecar refresh` against this node should clear the drift and the UI's stale chip should disappear. Pairs with #full-skill-claude (the same shape without the drift).
