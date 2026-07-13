---
"@skill-map/cli": minor
---

Removes `sm job run`, `RunnerPort`, `ClaudeCliRunner` and the submit `--run` flag: skill-map never spawns an agent. External agents drain the queue instead: `sm job claim` now reaps expired jobs first and stamps `runner=agent`, and `sm record --json` streams the synthetic run envelope as ndjson (`run.started` through `run.summary`, per `spec/job-events.md`).

## User-facing

**Your agent runs the jobs, not skill-map.** `sm job run` is gone: point any agent (Claude Code, Codex, whatever you use) at the queue and it drains it with `sm job claim` and `sm record`. Nothing gets executed behind your back.
