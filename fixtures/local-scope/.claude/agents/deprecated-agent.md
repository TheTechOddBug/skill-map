---
name: deprecated-agent
description: "Retired Claude agent kept on disk for historical reference. Demonstrates the `stability: deprecated` annotation combined with `supersededBy` pointing at the newer @full-agent-claude."
model: sonnet
tools:
  - Read
---

# Deprecated Claude agent

Old reviewer that was replaced by @full-agent-claude. Kept here so the supersession chain renders in the graph and the UI's "deprecated" badge has a node to attach to. Annotation `conflictsWith` points back at @full-agent-claude so consumers cannot accidentally combine both.
