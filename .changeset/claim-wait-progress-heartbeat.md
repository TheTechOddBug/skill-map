---
"@skill-map/cli": patch
"@skill-map/spec": minor
---

`claim_job`'s blocking `wait` now emits a `notifications/progress` heartbeat every ~15s while parked, when the request carried a `progressToken`. OpenCode calls every MCP tool with `resetTimeoutOnProgress: true` and a 60s default timeout, so its park died at the first minute; with the heartbeat it parks indefinitely. The skill's claim guidance is per-runtime now: Codex and OpenCode park on the MCP claim, Claude Code keeps the free CLI wait.

## User-facing

An OpenCode agent watching the queue can now wait for jobs on a single parked call, spending no tokens while idle, instead of the wait dying after a minute.
