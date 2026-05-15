---
name: full-agent-gemini
description: Reference Gemini agent populating every documented vendor frontmatter field (7 fields plus the universal `name`/`description`). Uses `kind: remote` so the fixture also covers the secondary enum value, the more common `kind: local` is demonstrated by @local-agent and @inherits-tools-agent.
tags:
  - fixture
  - reference
  - full
  - gemini
  - agent
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

# Full Gemini agent

Demonstrator agent that touches every documented frontmatter field for the Gemini Provider. Cross-vendor counterpart of @full-agent-claude. Requires #full-skill-gemini; pairs with @local-agent and @inherits-tools-agent for the `kind: local` case.
