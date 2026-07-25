---
"@skill-map/cli": patch
"@skill-map/spec": patch
---

Provider manifests gain `detect.subsumes`, the candidate ids a Provider absorbs during lens auto-detection because it reads that runtime's territory itself. `opencode` declares `['claude']`: it reads `.claude/skills/` and `CLAUDE.md` by design while Claude Code never reads `.opencode/`, so that pair was never a real tie, yet detection prompted over it. One-way (a mutual pair keeps the ambiguity) and applied after the `fallback` rule, so it only ever collapses a would-be prompt.

## User-facing

A project with both `.claude/` and `.opencode/` now picks OpenCode on its own instead of asking, since OpenCode reads Claude's skills too. Two unrelated runtimes still ask.
