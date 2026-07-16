---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

A fixer submit now SUPERSEDES a stale queued sibling: when a queued job exists for the same fixer and node but with a different rendered content (the findings or body changed), the old job is cancelled and the new one enqueued in one transaction, instead of both sitting in the queue and wasting an agent pass on findings already resolved. An identical submit keeps the duplicate refusal, and a running job is never superseded.

## User-facing

Re-queueing a fix for a file no longer piles up outdated fix jobs: the newer one replaces the stale queued one automatically. Jobs an agent is already working on are left alone.
