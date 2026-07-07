---
"@skill-map/spec": patch
"@skill-map/cli": patch
---

`sm init` now also adds `.skill-map/backups/` to the project `.gitignore`, alongside `settings.local.json`, `skill-map.db`, and `serve.json`. The backups directory (pre-migrate DB snapshots and `sm db backup` output) is a per-machine runtime artifact and must never travel via the shared repo.

## User-facing

`sm init` now keeps the `.skill-map/backups/` folder out of git, so your local database backups never get committed to the shared repo.
