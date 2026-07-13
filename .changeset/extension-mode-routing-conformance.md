---
"@skill-map/spec": minor
---

Two conformance cases lock the dual-mode dispatch contract: `extension-mode-routing` (a probabilistic Action submitted via `sm job submit` lands as a queued `state_jobs` row, asserted through `sm job list --json`) and `extension-mode-routing-deterministic` (a deterministic Action is refused with exit 2 and the in-process advisory). Coverage row for `job.schema.json` moves to partial.
