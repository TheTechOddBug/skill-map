---
name: bump-sidecars
description: Reference command demonstrating every documented `command` frontmatter field. Refreshes the `for.{bodyHash,frontmatterHash}` block on every `.sm` sidecar whose accompanying `.md` has drifted, mirroring the `sm bump` CLI verb without bumping `annotations.version`.
tags:
  - reference
  - official
  - fixture
  - command
  - sidecar
when_to_use: After editing fixture `.md` files (frontmatter or body) when the matching `.sm` sidecar must stay in lock-step. Equivalent to `sm sidecar refresh` over the touched files.
argument-hint: "[paths...]"
arguments:
  - paths
disable-model-invocation: true
user-invocable: true
allowed-tools:
  - Read
  - Bash(sm sidecar refresh *)
  - Bash(git diff --name-only *)
model: sonnet
effort: low
context: fork
agent: general-purpose
hooks:
  PreToolUse:
    - matcher: Bash
      command: echo "/bump-sidecars about to refresh sidecars"
      blocking: false
  PostToolUse:
    - matcher: Bash
      command: echo "/bump-sidecars done"
      blocking: false
  Stop:
    - matcher: ""
      command: echo "/bump-sidecars exited"
      once: true
paths:
  - "fixtures/**/*.{md,sm}"
shell: bash
---

# /bump-sidecars

Refreshes `.sm` sidecars in the local-scope + demo-scope fixtures after their accompanying `.md` files were edited. Pairs with the @kitchen-sink agent's release flow and the audit-fixtures skill.

## What it does

- Scans the working tree for `.md` files whose paired `.sm` is stale (`for.bodyHash` or `for.frontmatterHash` no longer matches the live `.md`).
- For each drifted pair, recomputes the canonical hashes and writes them back into the sidecar's `for:` block.
- Does NOT bump `annotations.version`, that is reserved for the human-driven `sm bump`; this command is the lighter "refresh only" path.

## Relationship to the rest of the local scope

Invoked from the @kitchen-sink release flow before every fixture-touching commit. Defers diff-level review to @code-review. Required by the audit-fixtures skill (which checks for drift after every edit).
