---
'@skill-map/cli': minor
---

The conformance runner implements `parallel` and `sleepAfterMs`. Parallel children are spawned asynchronously in a plain loop with no await between them, so every process exists before any is collected, which is what makes the race real. Mixing per-result assertions with `parallel` (or a `parallel-*` assertion without it) fails at the top of the run with zero side effects, before any scope is provisioned or child spawned.
