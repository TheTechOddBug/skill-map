---
"@skill-map/cli": patch
"@skill-map/spec": patch
---

Detect database schema drift by fingerprint. A sha256 of the migration DDL is stored in `scan_meta.schema_fingerprint` per scan and checked at open, so a DB whose columns fell behind an inline schema edit is caught instead of failing later as a cryptic `no such column` error. Write paths (`sm scan`, `sm serve`) prompt to rebuild (or `--yes`); read verbs warn and point at `sm scan` / `sm db reset`.

## User-facing

skill-map now notices when your local DB schema is out of date (not just an older version): `sm scan` and `sm serve` offer to rebuild the cache, and read commands warn instead of failing with a confusing database error.
