---
"@skill-map/cli": patch
---

`sm-process-jobs` skill: harden the resident watch loop. It now explicitly warns against passing `--timeout` on the resident `sm jobs claim --wait` (a timeout would make it exit and end the loop) and states that a wait returning without a job is not a stop signal, re-arm it. Fixes agents that added `--timeout` and stopped on an empty queue.

## User-facing

The process-agent skill now keeps watching the queue instead of stopping when it goes idle: it no longer bounds the resident wait with a timeout.
