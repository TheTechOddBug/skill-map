---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

Fixer selection is now open-findings-only: `selectFixerFindings` filters to `resolution IS NULL`, so a `fixed` or `human-decision` row no longer feeds a fixer submit, its injection, or the inspector's `findingCount` / launcher visibility (a resolved judgment is decided, not "to resolve"). Stale-but-open rows still ride flagged as before. Fixes the launcher showing a `(1)` count on a node the operator already corrected (`spec/job-lifecycle.md` §Findings injection, Selection).

## User-facing

A fix action no longer counts findings you already resolved: the number beside a fixer button now reflects only what still needs fixing.
