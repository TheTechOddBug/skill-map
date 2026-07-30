---
'@skill-map/cli': minor
---

`sm conformance run` gained `--case <id>`, narrowing a run to a single case searched across the selected scopes. An id matching nothing exits 2 rather than reporting a clean sweep of zero cases, so a typo in CI cannot go green forever. The summary now counts the scopes that actually ran instead of the ones selected, which keeps `totals.scopes` in agreement with the `scopes` array beside it.

## User-facing

`sm conformance run --case <id>` runs a single case instead of the whole suite, so you can iterate on one without waiting for the rest.
