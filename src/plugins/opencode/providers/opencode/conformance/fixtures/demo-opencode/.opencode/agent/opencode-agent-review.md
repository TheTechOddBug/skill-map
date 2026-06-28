---
description: Reviews changes without editing; suggests fixes only.
mode: subagent
model: anthropic/claude-opus-4-8
permission:
  edit: deny
  bash: ask
---

# OpenCode review agent

An OpenCode subagent (lives under `.opencode/agent/`, singular). Run
/opencode-cmd-deploy once the review passes.
