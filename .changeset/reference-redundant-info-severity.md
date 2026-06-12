---
"@skill-map/cli": patch
---

Downgrades the `core/reference-redundant` analyzer severity from `warn` to `info`: a multi-form reference to the same target is a consolidation hint, not a defect, so it no longer shares the visual bucket of actionable warnings like `reference-broken`.

## User-facing

Referencing the same file twice in different forms (a markdown link plus a backtick path, for example) now shows as an info note instead of a warning, so the warning chips on cards only count things worth fixing.
