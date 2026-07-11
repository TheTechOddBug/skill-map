---
"@skill-map/cli": minor
---

Retire the on-disk job-files model: rendered job content is now stored DB-only in a new `state_job_contents` table (content-addressed by hash) and execution reports are stored inline as JSON on `state_executions`, so there is no `.skill-map/jobs/` directory to manage. `sm job prune` drops its `--orphan-files` flag and no longer walks the filesystem; its retention pass now also collects orphaned content rows in the same transaction that prunes terminal jobs.
