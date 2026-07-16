---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

The finding state `declined` is renamed `human-decision` (Decision #143): it is a fixer's proposal awaiting the author's choice, not a dead-end. A `fixed` finding now records who decided it via `resolution_actor` (`human` / `fixer`): any user interaction is `human`, only a zero-interaction autonomous fix is `fixer`. The fixer report's `resolved[]` entry declares `state` plus `by` when fixed, and a new `sm findings resolve <id>` verb lets the operator mark a finding fixed-by-human directly.

## User-facing

Findings a fix could not settle now read `human-decision` (your call), not "declined". Fixed findings show whether you or the agent decided them, and `sm findings resolve <id>` lets you mark one handled yourself.
