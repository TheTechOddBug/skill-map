---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

`sm version` no longer prints the `kernel` row, and `sm version --json` drops the `kernel` field: the matrix is now `{ sm, spec, dbSchema }`. The CLI and kernel ship in one package and always carried the identical number, so the second row was redundant noise rather than information; the row returns the day the kernel publishes as its own package. Pre-1.0 breaking change shipped as a minor per the versioning policy.

## User-facing

`sm version` no longer shows a separate `kernel` line, it always matched `sm` exactly. The matrix now lists sm, spec, runtime, and db-schema.
