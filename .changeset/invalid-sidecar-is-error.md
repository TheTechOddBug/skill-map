---
"@skill-map/cli": minor
---

A malformed or schema-invalid `.sm` sidecar now emits its `invalid-sidecar` diagnostic at `error` severity instead of `warn`. The scan still completes (the node is marked present with a null status), but `sm check` now exits non-zero when any sidecar fails to parse or validate, surfacing broken annotations in CI rather than letting them pass as a warning.

## User-facing

`sm check` now **fails** (non-zero exit) when a `.sm` sidecar is malformed or breaks schema validation. These were previously reported as warnings and did not affect the exit code. Fix or remove the offending sidecar to make the check pass.
