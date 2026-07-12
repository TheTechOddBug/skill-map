---
"@skill-map/cli": minor
---

Adds `sm job preview <job.id>`: prints a queued job's rendered content (canonical preamble plus the `<user-content>` block) read from the DB-only `state_job_contents` store by `content_hash`, with no on-disk artifact and no execution. The display-only close-tag escaping is reversed before printing so the stored blob's `content_hash` stays stable. Exits 5 when the job or its content row is missing. Backed by a new `jobs.getContent(contentHash)` storage-port method.
