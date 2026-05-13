---
name: audit-fixtures
description: Reference skill demonstrating every documented `skill` frontmatter field. Audits the fixture catalog under `fixtures/local-scope/` and `fixtures/demo-scope/` against the Claude / Gemini provider schemas, flags missing fields, invented fields, and stale `.sm` hashes.
tags:
  - reference
  - official
  - fixture
  - skill
  - audit
when_to_use: When `.md` or `.sm` files under `fixtures/` change, or when the provider schemas under `src/built-in-plugins/providers/*/schemas/` evolve. Re-run before every fixture-touching PR so the catalog stays an honest reference.
argument-hint: "[glob]"
arguments:
  - paths
  - mode
disable-model-invocation: false
user-invocable: true
allowed-tools:
  - Read
  - Grep
  - Bash(sm sidecar refresh *)
  - Bash(npm run validate*)
model: sonnet
effort: medium
context: fork
agent: Explore
hooks:
  PreToolUse:
    - matcher: Bash
      command: echo "audit-fixtures about to shell out"
      blocking: false
  PostToolUse:
    - matcher: Edit
      command: echo "audit-fixtures finished editing a fixture"
      blocking: false
paths:
  - "fixtures/**/*.md"
  - "fixtures/**/*.sm"
  - "src/built-in-plugins/providers/**/schemas/*.json"
shell: bash
---

# Audit Fixtures skill

Reference skill that touches every documented frontmatter field for `skill` nodes (13 vendor-specific fields plus the universal `name` + `description`). Operationally, it audits the local-scope + demo-scope fixture catalog against the provider schemas so the fixture set stays an honest reference for documentation, screenshots, and conformance tests.

## What it does

- Walks the fixture tree and groups files by resolved `provider.kind`.
- Cross-checks frontmatter keys against the matching schema's `properties`.
- Flags `additionalProperties: true` carry-throughs (keys that pass validation but are not in the spec) so the fixture stays honest.
- Verifies sidecar hashes match the live `.md` content via `sm sidecar refresh --check`.

## Relationship to the rest of the local scope

Pairs with the matching `/bump-sidecars` command (used to refresh hashes after a fixture edit) and the @kitchen-sink agent (which demonstrates the agent half of the same catalog). Defers diff-level house-rule checks to @code-review.
