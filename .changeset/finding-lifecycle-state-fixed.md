---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

Findings gain a lifecycle state (Decision #142): a fixer puts a finding into `fixed` or `declined` (the report's `resolved[]` declares `state`, not an `applied` boolean). A `fixed` finding hides from the default `sm findings` view, marked with the fixer that handled it, and stays re-checkable (re-running the finder verifies and closes it); `declined` stays visible as the author's decision. The exclusion line reports `fixed` and `stale` counts separately, and `--fixed` reveals the fixed rows.

## User-facing

Once a fix runs, that finding moves to a `fixed` state and drops out of your default `sm findings` list (see it with `--fixed`), instead of lingering as if still open. Re-run the finder to confirm it is really gone.
