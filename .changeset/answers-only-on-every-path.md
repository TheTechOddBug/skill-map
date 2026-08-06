---
'@skill-map/cli': patch
'@skill-map/spec': patch
---

Review pass over the answers-not-receipts liveness change, closing the receipt-based signals the first cut missed: the MCP `claim_job` attempt no longer flips `attending` (an agent announcing itself has answered nothing; the hook and its plumbing are removed), the UI submit gate heals on `job.completed` / `job.failed` instead of `job.claimed`, and the nodeless `sm jobs submit <extension>` form is now documented in the CLI contract.

## User-facing

An agent connected over MCP no longer shows as "answering" the moment it asks for work; like everywhere else now, it counts once it actually answers a job.
