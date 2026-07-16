---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

A fixer's outcome now rides the finding it addressed. `state_findings` gains four `resolution*` columns; injected findings carry their `id`, the fixer echoes it back per `resolved[]` entry, and `sm record` stamps the claim onto the matching row in the record transaction, scoped to the job's node and the fixer's `analyzerIds`. `sm findings` and `sm show` render it: `applied` as an unverified claim, `declined` with its note, and the stale excluded-count line names hidden declined rows.

## User-facing

A fixer's outcome now travels with the finding: see which ones it says it fixed, and, crucially, which it refused and why. Its "you need to decide this" note is no longer lost, `sm findings` names those rows even when they are hidden.
