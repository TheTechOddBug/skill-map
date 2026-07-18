---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

The per-node Activity section tightens retention: the runtime recent-executions ring and the AI-run history each cap at 15 (was 20), and the conversation view renders at most 10 threads per node. `spec/provider-activity.md` lowers the normative `runs` cap to 15. AI-run rows now show the full qualified extension id and surface a run status only when it deviates from `completed` (failed and cancelled runs show their state).

## User-facing

**Leaner Activity timeline.** Each node keeps its 15 most recent runs and up to 10 conversations. AI-run rows now show each run's full name and only flag its status when it failed or was cancelled.
