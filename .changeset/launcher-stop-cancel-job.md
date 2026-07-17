---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

The inspector's AI-actions launcher gains a Stop control for an active job: `POST /api/jobs/:jobId/cancel` moves a queued/running job to `cancelled` through the same transition as `sm jobs cancel`, broadcasts the canonical `job.cancelled` envelope, and answers 204 (409 `job-terminal` on an already-closed job). Each prob-extension entry now carries the active `jobId`. This resolves the zombie case (a killed agent holding a claim) without dropping to the CLI, no global TTL needed.

## User-facing

You can now stop a running or queued analysis from the inspector: a killed or stuck agent's job no longer sits there forever, one click cancels it.
