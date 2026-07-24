---
"@skill-map/cli": patch
"@skill-map/spec": patch
---

Kernel safety-lane findings of type `content-suspicious` (the passive self-report a probabilistic run emits when it judges a node's content suspicious) are now recorded at severity `warn` instead of `info`, matching their siblings `injection-detected` and `content-malformed`. They surface as warnings across `sm findings` and the UI instead of info-level notes.

## User-facing

Content flagged as suspicious now surfaces as a warning instead of an info note, so it stands out in scans and the findings list.
