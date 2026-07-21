---
"@skill-map/spec": minor
---

The job lifecycle gains a normative disable cascade (`job-lifecycle.md` §Cancellation): disabling an extension also cancels its `queued` jobs through the same primitive as `sm jobs cancel`, one `job.cancelled` event per affected id plus one aggregated operations-log line; `running` jobs stay untouched and re-enabling resurrects nothing. `cli-contract.md` documents the cascade on `sm plugins disable` and the three `PATCH /api/plugins` toggle routes.
