---
name: deploy
description: Asks for confirmation, then invokes the CI deploy workflow. Reviews are delegated to #code-review.
tags:
  - ops
  - critical
  - ci
  - deploy
when_to_use: After a green build, when ready to ship to staging or production. Production deploys require an explicit confirmation prompt.
argument-hint: "<env>"
arguments:
  - env
disable-model-invocation: true
allowed-tools:
  - Bash(npm run release*)
  - Bash(git tag *)
---

# /deploy

Runs #code-review on the staged diff first. Production deploys require a green review and an explicit confirmation prompt. Triggered after a successful build via @frontend-specialist's release checklist.
