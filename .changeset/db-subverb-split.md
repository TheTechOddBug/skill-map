---
"@skill-map/cli": patch
---

Split `cli/commands/db.ts` (943 LOC, 7 subverbs in one file) into one file per subverb under `cli/commands/db/`, plus a `shared.ts` for cross-subverb helpers. Same shape as the earlier `cli/commands/plugins/` split.

**Layout.**

```
cli/commands/db.ts          — barrel (42 LOC). Re-exports DB_COMMANDS +
                              every subverb class.
cli/commands/db/
├── shared.ts        30 LOC — SAFE_SQL_IDENTIFIER_RE + assertSafeIdentifier
│                              (consumed by reset and dump).
├── backup.ts        65 LOC — DbBackupCommand
├── restore.ts      125 LOC — DbRestoreCommand + chmodOwnerOnlyBestEffort
│                              (single caller, kept local)
├── reset.ts        184 LOC — DbResetCommand
├── shell.ts         59 LOC — DbShellCommand
├── browser.ts       95 LOC — DbBrowserCommand
├── dump.ts         164 LOC — DbDumpCommand + dumpDatabaseToStream +
│                              listSchemaObjects + writeTableData +
│                              formatSqlNumber + formatSqlValue
└── migrate.ts      322 LOC — DbMigrateCommand + runPluginMigrations +
                              formatKernelName
```

**Compatibility.** The barrel re-exports `DB_COMMANDS` + every subverb class with the same name. The 4 existing importers (`cli/entry.ts`, `test/plugin-migrations.test.ts`, `test/dry-run-invariant.test.ts`, `test/elapsed-invariant.test.ts`) keep working unchanged.

**Eslint disables.** 2 preexisting `eslint-disable complexity` survive (on `DbResetCommand.run` and `DbMigrateCommand.run`) — both legitimate per `context/lint.md` category 1 (CLI orchestrators with multi-flag handling). No new disables introduced.

No behaviour change. 1381/1381 tests pass.
