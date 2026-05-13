---
name: release-broker
description: Reference Gemini agent demonstrating every documented vendor frontmatter field. Brokers between the local skill-map release workflow and a remote review board; uses `kind: remote` to cover the secondary execution mode (most Gemini agents run `local`, which is demoed by @architect and @test-runner).
tags:
  - reference
  - official
  - fixture
  - agent
  - gemini
  - release
  - remote
kind: remote
model: gemini-3-flash-preview
temperature: 0.6
max_turns: 24
timeout_mins: 20
tools:
  - Read
  - Grep
  - mcp_release_*
  - mcp_changeset_writer
mcpServers:
  release-board:
    command: ./scripts/release-board-bridge
    args: [--bridge-port, '7213']
    env:
      REMOTE_REVIEW: 'true'
  changeset-writer:
    command: mcp-server-changeset
    args: []
---

# Release broker (Gemini)

Demonstrator agent that touches every documented frontmatter field for the Gemini Provider (7 vendor-specific fields plus the universal `name` + `description`). Uses `kind: remote` so the fixture also covers the second value of the enum — the more common `kind: local` is demonstrated by @architect and @test-runner.

## Why this exists

Reference fixture for documentation, screenshots, conformance regressions, and tutorial walkthroughs. When Google extends the Gemini frontmatter, this is the first file to update so reviewers can eyeball "what does a fully-annotated Gemini agent look like?" without spelunking through specs.

## Behaviour

- Brokers release pull requests between the local skill-map worktree and the remote review board MCP server.
- Routes spec-drift questions to @architect.
- Defers actual test execution to @test-runner.
- Returns a single triaged decision: ship / hold / kick-back.

## Relationship to the rest of the local scope

Cross-vendor counterpart of the Claude-side @kitchen-sink agent. Requires @architect for layering review and @test-runner for the green-test gate. Related to the `.agents/skills/diff-walker` open-standard skill.
