---
name: run-migrations
description: Apply pending database migrations safely before a deploy.
---

# Run migrations

Apply pending schema migrations against the target database, following
[the architecture](../../../docs/architecture.md). An OpenCode native skill
(`.opencode/skills/`), loaded on demand via the `skill` tool. The builder runs
it before handoff and the deployer runs it before every rollout.
