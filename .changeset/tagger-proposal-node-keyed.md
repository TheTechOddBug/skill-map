---
'@skill-map/spec': minor
'@skill-map/cli': patch
---

The `job.completed` event now carries the job's frozen `nodeId` (spec `job-events.md`), and the UI keys the tagger's tag proposal on it: the pre-filled editor offer no longer evaporates when you navigate while the agent works, cannot open over the wrong node's tags, and re-offers itself when you return to the judged node until it is saved or superseded.

## User-facing

Auto-tag suggestions now wait for you: if you browse other files while your agent infers tags, the pre-filled tag editor opens when you come back to the file it judged instead of getting lost.
