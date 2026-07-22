---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Fixer jobs can target a finding subset: `sm jobs submit --finding <id>` (BFF `findingIds`) freezes the ids on the job, the injection narrows to them, and the supersede/duplicate/running gates become overlap-scoped; `fixerBusy` joins the prob-extensions wire. Finding resolution adds a row-grain `dismissed` state via `sm findings dismiss` (`--class` keeps the sidecar suppression) and a new `sm findings reopen` verb plus BFF routes; five optimization finder/fixer pairs ship experimental.

## User-facing

**Finer-grained finding control.** Fixing or dismissing one finding now affects only that finding (dismissing a whole kind stays available in the CLI), fix buttons no longer flicker while a fix starts, and `sm findings reopen` undoes a dismissal.
