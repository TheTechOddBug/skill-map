---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

The activity contract adds `DELETE /api/activity/node/<pathB64>`: one call clears a node's persistent AI-run history, its runtime stats and pair counters, and its retained spawn conversations, logging `activity.clear` to the operations log. The CLI ships it end to end: the storage port's targeted `history.deleteForNode`, the BFF route (no consent, regenerable machine data), and a Clear all button in the inspector's Activity section. The GET row's documented runs cap is corrected to 15.

## User-facing

**Clear a node's activity in one click.** The inspector's Activity section adds a Clear all button that deletes everything recorded for that node: run history, live counters and captured agent conversations. The section empties right away and refills as new activity arrives.
