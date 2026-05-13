---
name: test-runner
description: Runs the project's test suite, summarises failures, and proposes minimal fixes. Inherits the parent session's tools by omitting the field — useful when the user wires a new test runner without re-declaring agent tools.
kind: local
model: gemini-3-flash-preview
temperature: 0.2
max_turns: 6
timeout_mins: 8
tags:
  - testing
  - gemini
  - ci
  - quality
mcpServers:
  acme-test-runner:
    command: ./scripts/test-server
    args: [--port, '7212']
---

# Test runner (Gemini)

Spawns the `acme-test-runner` MCP server, runs the project's vitest + node:test suites in parallel, and reports a triaged failure list:

- **Likely flaky** — same assertion alternates pass/fail on re-run.
- **Real regression** — fails consistently and matches a recently-touched file.
- **Snapshot drift** — assertion fails on a serialized snapshot only.

Defers root-cause investigation to @architect when the failure crosses module boundaries.
