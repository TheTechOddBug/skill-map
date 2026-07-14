---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

Jobs never expire by default (Decision #139): an interactive drain can hold a claim while its user deliberates. `state_jobs.ttl_seconds` is nullable; expiry arms only from explicit operator sources (`--ttl`, with `0` disarming, `jobs.perExtensionTtl`, or the global opt-in `jobs.ttlSeconds`), the estimate-driven grace formula and its `graceMultiplier` / `minimumTtlSeconds` config keys are retired, and the new `jobs-overdue` doctor check advises on long-running TTL-less jobs.

## User-facing

Queued jobs no longer time out on their own, so an agent can pause mid-job and ask you how to proceed without losing the work. Set `--ttl` (or the `jobs.ttlSeconds` setting) if you want expiring jobs back; `sm doctor` now flags jobs running far longer than expected.
