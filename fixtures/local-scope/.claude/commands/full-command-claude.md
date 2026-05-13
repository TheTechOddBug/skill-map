---
name: full-command-claude
description: Reference Claude command populating every documented frontmatter field on the shared skill-base. Both Claude `skill` and `command` use the same `skill-base.schema.json`, so the field catalog mirrors #full-skill-claude.
tags:
  - fixture
  - reference
  - full
  - claude
  - command
when_to_use: When a reference command frontmatter shape is needed.
argument-hint: "<env>"
arguments:
  - env
disable-model-invocation: true
user-invocable: true
allowed-tools:
  - Bash(npm run release*)
  - Bash(git tag *)
model: claude-opus-4-7
effort: high
context: fork
agent: general-purpose
hooks:
  PreToolUse:
    - matcher: Bash
      command: echo "/full-command-claude about to run"
      blocking: false
  Stop:
    - matcher: ""
      command: echo "/full-command-claude exited"
      once: true
paths:
  - "src/**/*.{ts,js}"
shell: bash
---

# /full-command-claude

Demonstrator command that touches every documented frontmatter field on `skill-base.schema.json`. Required by @full-agent-claude's release flow; pairs with #full-skill-claude.
