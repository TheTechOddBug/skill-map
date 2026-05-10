---
name: kitchen-sink
description: Reference agent demonstrating every documented frontmatter field plus the full skill-map annotation catalog. Lives in the local-scope fixture as a normative example; see the matching `.sm` sidecar for the annotation surface.
tags:
  - reference
  - official
  - contracts
  - fixture
  - agent
tools:
  - Read
  - Grep
  - Bash(git add *)
  - Edit
disallowedTools:
  - WebFetch
  - WebSearch
model: claude-opus-4-7
permissionMode: acceptEdits
maxTurns: 12
skills:
  - code-review
  - architecture-review
mcpServers:
  - name: filesystem
    command: mcp-server-filesystem
    args:
      - /tmp
  - name: git
    command: mcp-server-git
    args: []
hooks:
  PreToolUse:
    - matcher: Bash
      command: echo "kitchen-sink agent about to run a Bash command"
      blocking: false
  PostToolUse:
    - matcher: Edit
      command: echo "kitchen-sink agent finished an Edit"
      blocking: false
memory: project
background: false
effort: high
isolation: worktree
color: cyan
initialPrompt: Greet the operator, list the active scope, and propose a starting task.
---

# Kitchen Sink Agent

Demonstrator agent that touches every documented frontmatter field and every annotation in the skill-map catalog. The vendor block above mirrors Anthropic's full agent frontmatter (14 vendor-specific fields plus the universal `name` + `description`) verbatim; the matching `.sm` sidecar fills the 15-field annotation catalog plus every reserved block (`for`, `annotations`, `settings`, `audit`) and a namespaced plugin block.

## Why this exists

Reference fixture for documentation, screenshots, conformance regressions, and tutorial walkthroughs. When the catalog grows, this is the first file to update so reviewers can eyeball "what does a fully-annotated node look like?" without spelunking through specs.

## Behaviour

- Reviews diffs against the local design-system tokens.
- Routes architectural questions to the `architecture-review` skill.
- Defers to `code-review` for line-level rules.
- Refuses to edit anything outside the project root.

## Relationship to the rest of the local scope

Supersedes `frontend-old.md`. Pairs with `frontend-specialist.md` (related — both are Angular reviewers) and `deploy.md` (related — invoked from the same release flow). Requires `code-review/SKILL.md` to be loadable.
