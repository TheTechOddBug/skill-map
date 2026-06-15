---
"@skill-map/cli": minor
---

Remove the `core/job-file-orphan` analyzer, which flagged `*.md` files under `.skill-map/jobs/` that no job row referenced. The scan-time plumbing that fed it (`IAnalyzerContext.orphanJobFiles`, `RunScanOptions.orphanJobFiles`, scan-runner computation) is removed too, so no dead context survives. The `findOrphanJobFiles` helper and the `sm job prune --orphan-files` verb stay. The analyzer returns later under a probabilistic evaluation model.

## User-facing

The orphan-job-file check is gone from scans for now; it will come back with a smarter, probabilistic model. You can still remove leftover job files with `sm job prune --orphan-files`.
