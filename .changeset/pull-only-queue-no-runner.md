---
"@skill-map/spec": minor
---

The queue is pull-only: skill-map never invokes an agent. `RunnerPort` leaves the architecture (§Execution handover: external agents drain via `sm job claim` + `sm record`), the `sm job run` verbs leave the contract, the `runner` enum becomes `agent | in-process`, reap moves to the start of every claim, and the job-events catalog prunes the spawn-path events, with `sm record --json`'s synthetic `r-ext-` envelope as the canonical emission.
