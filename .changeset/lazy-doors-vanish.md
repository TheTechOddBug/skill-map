---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Removed the agent doorbell (wake-on-submit): the `jobs.wakeOnSubmit` key, the `POST /api/agent/doorbell` route, the Settings toggle, and the registration in the generated OpenCode activity plugin. It served one runtime with no path to the others; parking (`sm jobs claim --wait` or the MCP `claim_job` wait) covers the same need at zero idle cost. The activity ingest tolerates and ignores the `agentEndpoint` field plugins generated before the removal still send.

## User-facing

The "Wake an agent when jobs are queued" switch is gone from Settings, Project. To process the queue, keep an agent watching it (ask it to run the processing skill) or process on demand; nothing else changes.
