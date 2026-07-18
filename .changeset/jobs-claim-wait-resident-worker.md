---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

`sm jobs claim` gains `--wait`: on an empty queue it blocks, re-reaping and re-claiming every `--interval` seconds (flag -> `jobs.claimWaitSeconds` config -> default 2) until a job is claimable, instead of exiting 1; `--timeout <seconds>` bounds the wait. The `sm-process-jobs` skill gains a resident watch mode that arms the blocking claim and processes each job as it arrives. Progress stays on stderr, so the `--json` handover is byte-unchanged.

## User-facing

Leave your agent watching the queue: `sm jobs claim --wait` waits for the next job instead of stopping when the queue is empty, so it wakes up only when there is work. Set how often it checks with `--interval` seconds, or the `jobs.claimWaitSeconds` setting.
