---
'@skill-map/spec': major
---

Mode B (dedicated storage) is narrowed to what v1 actually provides: declared tables get created and namespace-enforced, and `ctx.store` stays `undefined`. The `DedicatedStore.db` wrapper, its per-query validator, `ScopedDbViolationError` and `db.transaction(...)` were specified but never implemented and have no consumer, so freezing them would have committed every implementation to a SQL-parsing query validator designed against nothing. The accessor stays available as a post-v1 minor.
