---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

`sm tutorial` now materializes the walkthrough skill into the chosen agent's territory instead of always `.claude/skills/`. Providers declare an optional `scaffold` block (`skillDir` plus display-only `aka` names); the verb picks the destination from `--for <provider>`, the agent marker detected in the cwd (`.claude/` or `.agents/`), or Claude by default.

## User-facing

`sm tutorial` can now target other agents, not just Claude. It detects `.claude/` or `.agents/` and pre-selects that agent in a prompt. Pass `--for agent-skills` for the open-standard layout (used by Antigravity and OpenAI Codex) or `--for claude`. Defaults to Claude.
