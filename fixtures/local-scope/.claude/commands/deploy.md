---
name: deploy
description: Asks for confirmation, then invokes the CI deploy workflow. Reviews are delegated to #code-review.
args:
  - name: env
    type: "enum:staging|production"
    required: true
    description: Target environment.
shortcut: ctrl+alt+d
---

# /deploy

Runs #code-review on the staged diff first. Production deploys require a green review and an explicit confirmation prompt. Triggered after a successful build via @frontend-specialist's release checklist.
