---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Removed seven project-config keys that had no runtime consumer: `i18n.locale`, `providers` (the enabled-list; `activeProvider` stays), `history.share`, the `autoMigrate` config key (the `sm db migrate` / `backup` adapter option is untouched), `plugins.<id>.config`, `plugins.<id>.extensions`, and `scan.followSymlinks` (the walker always hard-skips symlinks). Dropping `plugins.<id>.config` closed the last open subtree, so project-config is now fully `additionalProperties: false`.

## User-facing

**Config cleanup.** Several settings.json keys that never did anything (`i18n`, `providers`, `history`, `autoMigrate`, `scan.followSymlinks`, per-plugin `config` / `extensions`) were removed. If still present they are now ignored and reported with a warning on load.
