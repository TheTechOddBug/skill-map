---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

Suppressed-judgment advisory on finder submits: `sm jobs submit` over a node whose `.sm` sidecar suppresses the finder's judgment (a standing `sm findings dismiss`) now warns on stderr, naming the suppressed types, before the agent pass is spent, and queues anyway (the kernel safety lane is never suppressed, and a finder may emit types the suppression does not cover). Human mode only; the `--json` stdout contract is unchanged (`spec/job-lifecycle.md` §Submit).

## User-facing

Queuing an analysis on a file where you already dismissed that finding now warns you upfront that the result will be dropped, so you can skip the run instead of paying for it.
