---
"@skill-map/cli": patch
---

The inspector's two no-agent notices (nobody has picked up work yet; the processing skill is missing) now name the exact invocation for the active lens, `sm-process-jobs` joined with the lens's invocation sigil, instead of a generic instruction and a hardcoded `/sm-process-jobs` that was wrong on Codex. The attending notice also points at Quick Start's "Agent waiting for jobs" Check to confirm the agent picked the queue up.

## User-facing

When no agent is processing jobs, the inspector now tells you exactly what to type in your agent (`/sm-process-jobs`, or `$sm-process-jobs` on Codex) and where to confirm it (Quick Start's Check), instead of a generic "start the processing skill".
