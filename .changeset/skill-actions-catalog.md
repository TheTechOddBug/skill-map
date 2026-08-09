---
"@skill-map/spec": patch
"@skill-map/cli": patch
---

Skill actions: agent skills installed under the project's private `.skill-map/.agents/skills/` catalog (skills.sh installer) are discovered at `sm serve` boot and run as per-node probabilistic jobs. New `spec/skill-actions.md` contract plus canonical report schema; `prob-extensions` gains an optional `skills` bucket, the BFF job submit accepts `skill:<name>` targets, and the inspector's AI actions card gains a Skills group. The CLI submit grammar for `skill:` stays reserved.

## User-facing

New Skills group in the AI actions panel: install agent skills into your project's .skill-map folder (npx skills add) and run them on any node; each run's report lands in the executions history. The server picks up newly installed skills on restart.
