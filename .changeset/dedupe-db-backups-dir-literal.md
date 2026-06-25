---
"@skill-map/cli": patch
---

Centralize the `backups` directory segment behind a single kernel primitive (`kernelBackupsDir(dbPath)` plus the `BACKUPS_DIRNAME` literal in `skill-map-paths.ts`, re-exported through `core/paths` and the CLI `db-path` helper). The migrations runner's pre-migrate snapshot path and `sm db backup` now both derive `<dbDir>/backups` from that one source instead of composing the literal by hand. Behaviour is unchanged.
