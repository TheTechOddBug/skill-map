---
"@skill-map/cli": minor
"@skill-map/spec": patch
---

Add an `opencode` built-in provider lens for the OpenCode CLI. Under the opencode lens, skill-map classifies OpenCode agents (`.opencode/agent/*.md`) and commands (`.opencode/commands/*.md`), and discovers skills from the three homes OpenCode reads (`.opencode/skills/`, `.claude/skills/`, `.agents/skills/`). Claude compatibility is asymmetric: OpenCode reads Claude skills but not Claude agents or commands, so those fall through to markdown. A `.opencode/` folder auto-detects the lens (beta).

## User-facing

skill-map now recognizes OpenCode projects. Open a repo with a `.opencode/` folder and the map shows your OpenCode agents, commands, and skills (including the Claude-compatible skills OpenCode reads). Pick the OpenCode lens from the lens dropdown.
