---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

`sm tutorial` now materializes the walkthrough skill into the chosen agent's territory instead of always `.claude/skills/`. Providers declare an optional `scaffold` block (`skillDir` plus display-only `aka` names); the destination comes from `--for <provider>` or a prompt defaulting to Claude. It now also requires an empty cwd, seeding a self-contained scenario the tester can later delete wholesale, so a non-empty directory is refused (exit 2) unless `--force` is passed.

## User-facing

`sm tutorial` can now target other agents: `--for agent-skills` (open-standard layout, used by Antigravity and OpenAI Codex) or `--for claude` (default). It now requires an empty directory: run it in a fresh folder, or pass `--force` to seed into the current one.
