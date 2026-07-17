---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

Live job-transition push: every job-transitioning CLI verb (`sm jobs submit` / `claim` / `cancel` / `fail`, `sm record`) now pushes its event envelope to the running server (`POST /api/job-events`, discovered and token-authenticated via `serve.json`, best-effort fire-and-forget), which rebroadcasts it verbatim over `/ws`. The catalog gains `job.submitted` / `job.cancelled` and the `queue` runId mode; the BFF submit route's broadcast uses the same canonical envelope.

## User-facing

The inspector now updates the moment your agent picks up or finishes a job: state changes made from the terminal show up live in the browser without reloading.
