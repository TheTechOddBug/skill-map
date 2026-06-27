---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Lens auto-detection now gives a vendor marker precedence over the open-standard `agent-skills` fallback. The `agent-skills` provider declares `detect.fallback`, so its `.agents/` marker resolves a lens only when no vendor marker is present. A project carrying `.codex/` (or `.agent/workflows/`) alongside the shared `.agents/skills/` home now resolves to that vendor outright instead of prompting `codex` vs `agent-skills`. Several vendor markers together still surface an ambiguous prompt.

## User-facing

Codex and Antigravity projects no longer hit a spurious "which lens?" prompt on first scan: a `.codex/` (or `.agent/workflows/`) project is detected as that lens even though it also uses the shared `.agents/skills/` folder. `/` is left to the vendor's own behavior.
