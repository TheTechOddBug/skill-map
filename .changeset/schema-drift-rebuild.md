---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Pre-1.0 schema-drift rebuild: `sm scan`, `sm watch`, and the BFF watcher compare `scan_meta.scanned_by_version` against the running CLI and, on any `major.minor` difference, delete and recreate the project DB from `001_initial.sql` instead of failing on the stale schema. The DB is a derived cache (`.sm` sidecars hold the authored data) so no backup is taken; patch differences stay compatible and read verbs keep the version-skew advisory.

## User-facing

After updating skill-map, the next `sm scan` rebuilds the local database when it was created by an older version (your `.sm` sidecar files are never touched). On a terminal it asks first; pass `--yes` to skip the prompt.
