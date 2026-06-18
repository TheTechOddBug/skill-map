---
name: master-agent
description: |
  Example agent used by the advanced tutorial. Has a couple of
  tools so the `core/tools-counter` extractor emits a count.
tools: [Read, Bash, Edit]
model: sonnet
---

# master-agent

Walks the master-skill outputs and reports findings. Used as the
target node when we exercise extractors, analyzers, and the
plugin-authoring flow.
