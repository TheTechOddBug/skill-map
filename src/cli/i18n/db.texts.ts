/**
 * CLI strings emitted by `sm db *` — `cli/commands/db.ts`.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 *
 * Includes the `--dry-run` previews for `sm db reset` (default /
 * --state / --hard) and `sm db restore`, per `cli-contract.md`
 * §Dry-run.
 */

export const DB_TEXTS = {
  // --- reset -----------------------------------------------------------
  resetStateAndHardMutex: '{{glyph}}  --state and --hard are mutually exclusive.\n',

  resetCleared: '{{glyph}}  Cleared {{tableCount}} table(s): {{tableNames}}\n',
  resetClearedNone: '{{glyph}}  Cleared 0 table(s): (none)\n',

  resetHardConfirm: 'Delete DB file {{path}}?',
  resetHardDeleted: '{{glyph}}  Deleted {{path}}\n',

  resetStateConfirm: 'Drop scan_* AND state_* in {{path}}?',

  // --- restore ---------------------------------------------------------
  restoreSourceNotFound: '{{glyph}}  Backup not found: {{sourcePath}}\n',
  restoreConfirm: 'Restore {{sourcePath}} over {{target}}? This overwrites the current DB.',
  restoreDone: '{{glyph}}  Restored {{sourcePath}} → {{target}}\n',

  // --- shared ----------------------------------------------------------
  aborted: 'Aborted.\n',
  backupWritten: '{{glyph}}  Backup written: {{outPath}}\n',

  // --- migrate (sm db migrate) -----------------------------------------
  migrateKernelOnlyAndPluginMutex:
    '{{glyph}}  --kernel-only and --plugin are mutually exclusive.\n',
  migratePluginNotFound:
    '{{glyph}}  --plugin {{pluginId}}: no loaded plugin with that id and `storage.mode = "dedicated"`.\n',
  migrateStatusKernelHeader: 'kernel · Applied: {{applied}} · Pending: {{pending}}\n',
  migrateStatusPluginHeader:
    '\nplugin {{pluginId}} · Applied: {{applied}} · Pending: {{pending}}\n',
  migrateStatusPending: '  pending  {{name}}\n',
  migrateStatusApplied: '  applied  {{name}}\n',
  migrateInvalidTo: '{{glyph}}  --to expects an integer, got {{to}}\n',

  // --- migrate kernel apply / dry-run output ---------------------------
  migrateKernelDryNothing: '{{glyph}}  kernel · Nothing to apply.\n',
  migrateKernelDryHeader: 'kernel · Would apply {{count}} migration(s):\n{{lines}}\n',
  migrateKernelUpToDate: '{{glyph}}  kernel · Already up to date.\n',
  migrateKernelApplied: '{{glyph}}  kernel · Applied {{count}} migration(s)\n',
  migrateKernelAppliedWithBackup:
    '{{glyph}}  kernel · Applied {{count}} migration(s) · backup: {{backupPath}}\n',

  // --- shell (system sqlite3 binary required for the interactive REPL) ---
  shellSqlite3NotFound:
    '{{glyph}}  sqlite3 binary not found on PATH.\n' +
    '   {{hint}}\n',
  shellSqlite3NotFoundHint:
    'Install it (macOS: brew install sqlite; Debian/Ubuntu: apt install sqlite3) or use `sm db dump` for read-only inspection.',
  // --- browser (system sqlitebrowser GUI required) ---------------------
  browserRunScanFirstHint: 'Run `sm scan` first (or `sm init`) to create the project DB.\n',
  browserNotFound:
    '{{glyph}}  sqlitebrowser is not installed (or not on PATH).\n' +
    '\n' +
    'If you want a GUI to inspect the DB, install it:\n' +
    '  Debian/Ubuntu: sudo apt install -y sqlitebrowser\n' +
    '  macOS:         brew install --cask db-browser-for-sqlite\n' +
    '  Windows:       https://sqlitebrowser.org/dl/\n',
  browserOpeningReadOnly: 'Opening {{path}} (read-only)\n',
  browserOpeningReadWrite: 'Opening {{path}} (read-write)\n',
  // --- dump (pure node:sqlite, no external binary) ----------------------
  dumpInvalidTable:
    '{{glyph}}  --tables: refusing non-identifier name {{table}}.\n' +
    '   {{hint}}\n',
  dumpInvalidTableHint: 'Table names must match [a-zA-Z_][a-zA-Z0-9_]*.',
  dumpFailure: '{{glyph}}  sm db dump: {{message}}\n',

  // --- plugin migration runner -----------------------------------------
  pluginMigrateFailure: '{{glyph}}  plugin {{pluginId}} · {{reason}}\n',
  pluginMigrateDryNothing: '{{glyph}}  plugin {{pluginId}} · Nothing to apply.\n',
  pluginMigrateDryHeader:
    'plugin {{pluginId}} · Would apply {{count}} migration(s):\n{{lines}}\n',
  pluginMigrateUpToDate: '{{glyph}}  plugin {{pluginId}} · Already up to date.\n',
  pluginMigrateApplied: '{{glyph}}  plugin {{pluginId}} · Applied {{count}} migration(s)\n',
  pluginMigrateIntrusion:
    'plugin {{pluginId}} · catalog intrusion detected: {{intrusions}}\n',

  // --- dry-run previews ------------------------------------------------
  dryRunHeader: '(dry-run — no DB writes, no file unlinks)\n',

  dryRunResetWouldClearNone:
    'would clear   0 table(s): (none — DB schema is empty)\n',

  // The `lines` arg is a pre-built multi-line block, one "  - name: N row(s)"
  // per table, joined with `\n`.
  dryRunResetWouldClearWithRowCounts:
    'would clear   {{tableCount}} table(s) ({{totalRows}} total row(s)):\n{{lines}}\n',

  dryRunResetHardWouldDelete: 'would delete  {{path}} ({{sizeBytes}} bytes)\n',
  dryRunResetHardWouldDeleteMissing:
    'would delete  {{path}} (file does not exist — no-op)\n',

  // The `targetClause` arg is one of two pre-built strings:
  //   "(exists, would be overwritten)"  /  "(does not exist, would be created)".
  dryRunRestoreWouldOverwrite:
    'would copy    {{sourcePath}} ({{sourceBytes}} bytes) → {{target}} {{targetClause}}\n' +
    'would delete  {{target}}-wal and {{target}}-shm sidecars if present\n',

  dryRunRestoreTargetExistsClause: '(exists, would be overwritten)',
  dryRunRestoreTargetMissingClause: '(does not exist, would be created)',
} as const;
