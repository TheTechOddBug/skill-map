---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

The inspector's Activity section interleaves two provenances: live runtime activity and skill-map's own AI-run history from `state_executions` (persistent). `GET /api/activity/node/:pathB64` gains a lean `runs` array (newest-first, capped 20; no report/nonce). The two are distinguished behind a three-way filter (all / runtime / AI runs) persisted at inspector level; the old Executions/Last-start/Contexts/Totals stat grid was dropped.

## User-facing

The inspector's Activity panel now shows a combined timeline of live agent activity and skill-map's own analysis runs, with a filter to focus on either.
