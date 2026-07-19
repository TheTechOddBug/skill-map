---
"@skill-map/cli": minor
---

Queue inspector write affordances (Step 17, slice 2): a failed row gets a Retry button that re-submits the same extension + node via the existing node-jobs route, Cancel moves inline into the status cell, and a bulk toolbar behind a confirm dialog cancels all active jobs or clears failed / finished ones via the new cancel-all + prune endpoints. Rows now sort strictly by age, cancelled rows render struck-through, and the running-job Cancel tooltip warns the stop is best-effort.

## User-facing

**Manage jobs from the queue panel.** Retry a failed job, cancel a running one inline, or use the bulk buttons to cancel every active job or clear out failed / finished ones at once. Cancelled jobs show struck-through, and cancelling a running job is best-effort.
