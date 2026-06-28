---
description: Ships approved changes to production.
mode: subagent
permission:
  edit: deny
  bash: allow
---

# Deployer

Ships approved changes following [the deploy runbook](../../docs/deploy-runbook.md).
Always run the [run-migrations skill](../skills/run-migrations/SKILL.md) first,
then /deploy.
