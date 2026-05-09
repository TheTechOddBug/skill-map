---
name: code-review
description: Reviews a diff against the project's house rules. Flags violations, suggests minimal fixes, and defers architecture questions to @frontend-specialist.
tags:
  - review
  - quality
  - ci
  - claude
inputs:
  - name: diffPath
    type: path
    required: true
    description: Path to a unified diff file or git ref range.
  - name: strict
    type: boolean
    required: false
    default: false
outputs:
  - name: findings
    type: array
    description: One entry per violation, each with severity, cite, and proposed patch.
---

# Code Review skill

Reads the diff with `Read`, groups hunks by file, applies rule packs. Escalates to @frontend-specialist on any component-boundary or design-system hunk. See https://google.github.io/eng-practices/review/ for the underlying principles.
