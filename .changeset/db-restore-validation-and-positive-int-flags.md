---
"@skill-map/cli": patch
---

`sm db restore` now validates the source before previewing or swapping: it refuses a non-SQLite file, or a backup written by a newer minor or different major than the running CLI (same version rules `sm scan` applies on open). `--dry-run` and the live swap share one read-only check, so a dry run no longer green-lights a source the restore would reject. Separately, `--max-scan` / `--max-nodes` on `scan` / `serve` / `watch` now reject exponent notation like `1e3`, matching `--port`.

## User-facing

**Safer restores, stricter limits.** `sm db restore` now refuses a backup that isn't a real database, or one written by a newer `sm`, before touching your data. And `--max-scan` / `--max-nodes` reject values like `1e3` instead of silently treating them as 1000.
