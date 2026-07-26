---
"@skill-map/cli": patch
"@skill-map/spec": minor
---

Agent presence now flips on an MCP `claim_job` ATTEMPT, not only on a won claim: an agent parked on `claim_job { wait }` against an empty queue claims nothing for hours, yet it is attending by definition, so the inspector's "no agent has picked up work yet" warning outlived the moment the agent arrived. The inspector also re-probes presence the moment the MCP client connects, the same flip that re-enables the launch buttons, so both surfaces update together. `lastClaimAt` stays claim-only.

## User-facing

The "no agent has picked up work yet" notice now clears as soon as your agent parks on the queue, together with the action buttons enabling, instead of lingering until a job happens to run.
