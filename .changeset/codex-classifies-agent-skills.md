---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

The Codex lens now classifies open-standard Agent Skills (`.agents/skills/<name>/SKILL.md`, the layout OpenAI Codex actually reads) as `codex`/`skill`, by composing the `agent-skills` open-standard pieces over a new multi-rule `read`. A provider's `read` may now be an array of rules so one provider reads several file families with different parsers (Codex reads `.toml` agents and `.md` skills), and a `/skill-name` invocation in an agent prompt resolves to its skill.

## User-facing

OpenAI Codex projects now show their Agent Skills (`.agents/skills/<name>/SKILL.md`) on the map as skill nodes next to the Codex agents, and a slash invocation from an agent to a skill is drawn as a link.
