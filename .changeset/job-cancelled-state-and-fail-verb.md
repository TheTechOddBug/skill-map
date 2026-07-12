---
"@skill-map/spec": minor
---

Add a distinct `cancelled` terminal job state and a symmetric `sm job fail` verb. `sm job cancel` now moves a queued/running job to `cancelled` (no `failureReason`) instead of `failed`, while `sm job fail` forces `failed` with reason `user-failed`, which replaces the removed `user-cancelled` value across the job, execution-record, history-stats, and db-schema enums. Adds `jobs.retention.cancelled` (default 30d) and documents the three write-side schema-drift response modes in `db-schema.md`.
