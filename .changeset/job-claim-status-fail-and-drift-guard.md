---
"@skill-map/cli": minor
---

Add the Phase C queue primitives `sm job claim` (atomic claim; `--json` returns `{id, nonce, content}`) and `sm job status`, plus the `cancelled` terminal state and a new `sm job fail` verb (`sm job cancel` now moves a job to `cancelled`, not `failed`). Adds a write-side schema-drift guard: a mutating open against an outdated DB refuses with a clean advisory (CLI + BFF `db-drift`) instead of a `CHECK constraint failed` crash. Also routes `RETURNING` DML through `.all()` in `NodeSqliteDialect`.

## User-facing

**Clearer message when your project database is out of date.** After upgrading `sm`, a command that writes to an outdated `.skill-map` database now prints a short "run `sm db reset --hard`, then `sm scan`" advisory instead of crashing with a cryptic error.
