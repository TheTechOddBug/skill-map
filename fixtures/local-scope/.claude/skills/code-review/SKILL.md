---
name: code-review
description: Reviews a diff against the project's house rules. Flags violations, suggests minimal fixes, and defers architecture questions to @frontend-specialist.
tags:
  - review
  - quality
  - ci
  - claude
when_to_use: Before every commit and after every rebase, run against the staged diff to catch house-rule violations before they reach CI.
argument-hint: "[diff-path]"
arguments:
  - diffPath
allowed-tools:
  - Read
  - Grep
  - Bash(git diff *)
paths:
  - "src/**/*.{ts,tsx}"
  - "ui/src/**/*.{ts,html,css}"
---

# Code Review skill

Reads the diff with `Read`, groups hunks by file, applies rule packs. Escalates to @frontend-specialist on any component-boundary or design-system hunk. See https://google.github.io/eng-practices/review/ for the underlying principles.
