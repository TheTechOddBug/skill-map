---
'@skill-map/cli': patch
'@skill-map/spec': patch
---

The shell capture rung is available on codex: codex 0.147 reports its shell tool as `Bash` with the claude payload shape, so the shared shell mapper applies and `sm activity install codex --shell` renders the same opt-in `^Bash$` hook behind the same double opt-in. The claude shell mapper moved to the shared adapter util so the two runtimes cannot drift.

## User-facing

Shell capture now works on Codex too: opt in with `sm activity install codex --shell`, pick the Shell level, and .md files named in shell commands light the map, which also catches docs Codex reads via cat or sed.
