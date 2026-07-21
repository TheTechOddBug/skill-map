---
"@skill-map/cli": minor
---

Every disable surface (`sm plugins disable` and the three `PATCH /api/plugins` toggle routes) now cancels the disabled extension's `queued` jobs via the shared `core/jobs/cancel-disabled.ts` helper, inside the same DB open as the contributions purge: one `job.cancelled` push or WS broadcast per affected id and one aggregated `jobs.cancel` operations-log line when any job was cancelled; `running` jobs are untouched.

## User-facing

**Switching a plugin off cancels its pending jobs.** Turning a plugin or extension off now also cancels its queued jobs, so nothing keeps processing work for something you switched off. Jobs already running finish normally, and re-enabling does not bring cancelled jobs back.
