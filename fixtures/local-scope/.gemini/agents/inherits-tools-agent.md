---
name: inherits-tools-agent
description: Gemini agent that intentionally omits the `tools` field so it inherits the parent session's full tool set. Useful pattern when the operator wires a new test runner without re-declaring agent tools.
tags:
  - fixture
  - inherits-tools
  - gemini
  - agent
kind: local
model: gemini-3-flash-preview
temperature: 0.2
max_turns: 6
timeout_mins: 8
mcpServers:
  acme-test-runner:
    command: ./scripts/test-server
    args: [--port, '7212']
---

# Inherits-tools Gemini agent

The frontmatter has no `tools` block, so the subagent runs with whatever tools the parent session exposes. Useful demo of the "omit to inherit" semantic. Pairs with @full-agent-gemini (the explicit-tools counterpart) and @local-agent.
