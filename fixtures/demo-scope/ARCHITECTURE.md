---
name: architecture
description: "One-page tour of the acme-toolkit demo: which agents own what, which skills back the review pipeline, and how the deploy command threads through both."
---

# Architecture

The toolkit splits responsibility across three layers: agents that hold context, skills that hold rules, and commands that orchestrate side effects.

## Review path

The review pipeline is the loudest cross-cutting concern in the demo. @frontend-specialist owns the Angular surface and defers to #code-review for diff-level rule enforcement. The retired @frontend-old agent is preserved as a deprecated node (`stability: deprecated` in its sidecar), useful for showing how the inspector renders a deprecated node without inventing fixtures on demand.

## Deploy path

`/deploy` is the only command in the demo today. It reads its rule pack from #code-review (so a deploy that the reviewer would block never starts), and writes its post-flight summary into the same audit channel the agents use.

## Cross-references

This file links to real nodes only: @frontend-specialist, @frontend-old, #code-review, /deploy. Each prefix corresponds to a different node kind, so the extractor records four outgoing edges (mentions for the agents, references for the skill, invokes for the command). The point is that a kind-`markdown` node can carry the same link surface that the vendor-specific kinds carry; nothing about the format-named fallback restricts what an author can wire up.
