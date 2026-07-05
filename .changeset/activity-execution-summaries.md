---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Live activity: sync spawn completions now carry an execution summary (durationMs, tokens, toolUses, extracted from the runtime's live-verified completion totals) on the spawn relation. The stats accumulator folds them into per-node aggregates (toolUses, tokens, summarizedRuns on the stats shape), retained conversation records keep the per-run summary, and the inspector Activity section plus the conversation dialog turn heads display them.

## User-facing

Agent runs now show how long they took, how many tools they used, and how many tokens they consumed, both per conversation turn in the chat dialog and aggregated in the node's Activity panel.
