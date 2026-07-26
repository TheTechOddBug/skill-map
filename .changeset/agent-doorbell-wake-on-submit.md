---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

New agent doorbell (`jobs.wakeOnSubmit`, off by default, project-local): instead of an agent parked on a blocking claim, the server wakes a registered runtime when a submit survives a short settle window unclaimed, starting a fresh session that drains the queue in `once` mode and stops. OpenCode's activity plugin registers its local API as the wake endpoint (`POST /api/agent/doorbell`, refreshed per activity event); the wake is loopback-only, cooldown-bounded, and never fires for the boot ping.

## User-facing

Turn on "Wake an agent when jobs are queued" (Settings, Project) and OpenCode starts a session by itself when work arrives, processes the queue, and stops. Nothing sits parked, idle costs zero.
