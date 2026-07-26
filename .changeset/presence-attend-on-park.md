---
"@skill-map/cli": patch
"@skill-map/spec": minor
---

Agent presence now flips on an MCP `claim_job` ATTEMPT, not only on a won claim (a parked agent is attending by definition), and gains explicit negative evidence: a liveness ping cancelled while still unclaimed flips `attending` back to false until a later claim or attempt, so a manual Check moves the connected state both ways. The inspector re-probes presence the moment the MCP client connects, so warnings and buttons update together. `lastClaimAt` stays claim-only.

## User-facing

The "no agent has picked up work yet" notice clears as soon as your agent parks on the queue, and a Check nobody answers flips the state back to disconnected, so what you see always matches reality.
