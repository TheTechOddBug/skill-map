---
name: master-agent
description: |
  Example skill used by the advanced tutorial. Declares a couple of
  tools so the `core/tools-counter` extractor emits a count.
allowed-tools: Read Bash Edit
---

# master-agent

Walks the master-skill outputs and reports findings. Used as the
target node when we exercise extractors, analyzers, and the
plugin-authoring flow.
