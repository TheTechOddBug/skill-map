---
name: local-agent
description: Gemini agent running in-process (`kind: local`). Demonstrates the default execution mode with a partial vendor-field set, the common shape for everyday subagents.
tags:
  - fixture
  - local
  - gemini
  - agent
kind: local
model: gemini-3-flash-preview
temperature: 0.4
max_turns: 10
timeout_mins: 5
tools:
  - Read
  - Grep
  - mcp_*
---

# Local Gemini agent

Standard in-process Gemini subagent. Pairs with @full-agent-gemini (the exhaustive remote reference) and @inherits-tools-agent (the "no tools, inherits parent" variant).
