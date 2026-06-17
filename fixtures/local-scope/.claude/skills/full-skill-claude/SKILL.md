---
name: full-skill-claude
description: Reference Claude skill populating every documented frontmatter field on the shared skill-base. The 14 vendor-specific fields plus the universal `name`/`description` are all set, so reviewers can eyeball "what does a fully-annotated Claude skill look like?" in one shot.
when_to_use: When a reference frontmatter shape is needed for documentation, screenshots, or conformance regressions.
argument-hint: "[scope]"
arguments:
  - scopes
  - mode
disable-model-invocation: false
user-invocable: true
allowed-tools:
  - Read
  - Grep
  - Bash(sm sidecar refresh *)
  - Bash(npm run validate*)
disallowed-tools:
  - Bash(rm *)
  - AskUserQuestion
model: sonnet
effort: medium
context: fork
agent: Explore
hooks:
  PreToolUse:
    - matcher: Bash
      command: echo "full-skill-claude about to shell out"
      blocking: false
  PostToolUse:
    - matcher: Edit
      command: echo "full-skill-claude finished editing"
      blocking: false
paths:
  - "fixtures/**/*.md"
  - "fixtures/**/*.sm"
shell: bash
---

# Full Claude skill

Demonstrator skill that touches every documented frontmatter field on `skill-base.schema.json`. Pairs with @full-agent-claude (the agent half) and /full-command-claude (the command half).
