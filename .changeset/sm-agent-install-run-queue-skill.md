---
"@skill-map/cli": minor
---

New `sm agent install / uninstall / status` verb family: materialises the bundled `sm-run-queue` skill into the active lens's skill territory (`.claude/skills`, `.agents/skills`, ...; `--for <provider>` overrides), so any agent runtime learns the queue drain protocol. Install is three-state (installed / updated / already up to date, byte-compared against the bundled template); status reports `stale` when the materialised copy predates the current CLI.

## User-facing

**Teach your agent to drain the queue.** Run `sm agent install` once and your agent (Claude Code, Codex, or any runtime reading the skill folder) picks up the `sm-run-queue` skill: ask it to "drain the queue" and it claims, executes, and records your jobs.
