---
name: architecture
description: One-page tour of the acme-toolkit demo — which agents own what, which skills back the review pipeline, and how the deploy command threads through both.
---

# Architecture

The toolkit splits responsibility across three layers — agents that hold context, skills that hold rules, and commands that orchestrate side effects.

## Review path

The review pipeline is the loudest cross-cutting concern in the demo. @frontend-specialist owns the Angular surface and defers to #code-review for diff-level rule enforcement. The retired @frontend-old agent is preserved as a deprecated node so the graph carries a `supersededBy` edge — useful for testing the inspector's banner without inventing fixtures on demand.

## Deploy path

`/deploy` is the only command in the demo today. It reads its rule pack from #code-review (so a deploy that the reviewer would block never starts), and writes its post-flight summary into the same audit channel the agents use.

## Cross-references

This file deliberately exercises every Claude-flavoured prefix — `@agent`, `#skill`, `/command` — so the link extractor has a markdown node to crawl that is neither an agent nor a skill nor a command. The result is a graph entry of kind `markdown` with three outgoing edges to the three kinds it points at.
