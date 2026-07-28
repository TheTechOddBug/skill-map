/**
 * CLI strings emitted by `sm db *`, `cli/commands/db.ts`.
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
  /**
   * §3.1b two-line block. The two flags imply incompatible scopes
   * (state-only zone drop vs. full DB file delete). Hint names the two
   * valid invocations so the operator picks one explicitly.
   */
  resetStateAndHardMutex:
    '{{glyph}}  --state and --hard are mutually exclusive.\n' +
    '   {{hint}}\n',
  resetStateAndHardMutexHint:
    'Pick one: `sm db reset --state` (drops scan_* and state_*) or `sm db reset --hard` (deletes the DB file).',

  resetCleared: '{{glyph}}  Cleared {{tableCount}} table{{plural}}: {{tableNames}}\n',
  resetClearedNone: '{{glyph}}  Cleared 0 tables: (none)\n',

  resetHardConfirm: 'Delete DB file {{path}}?',
  resetHardDeleted: '{{glyph}}  Deleted {{path}}\n',

  resetStateConfirm: 'Drop scan_* AND state_* in {{path}}?',

  // --- restore ---------------------------------------------------------
  /**
   * §3.1b two-line block. The user named a backup path that does not
   * exist; hint nudges toward `sm db backup` and the default backups
   * directory.
   */
  restoreSourceNotFound:
    '{{glyph}}  Backup not found: {{sourcePath}}\n' +
    '   {{hint}}\n',
  restoreSourceNotFoundHint:
    'Run `sm db backup` first, or pick an existing file (the default backups directory is `.skill-map/backups/`).',
  /**
   * Source exists but is not a SQLite database (missing the header).
   * Restoring it would swap a non-DB into place; refuse with exit 2.
   */
  restoreSourceNotSqlite:
    '{{glyph}}  Not a SQLite database: {{sourcePath}}\n' +
    '   {{hint}}\n',
  restoreSourceNotSqliteHint:
    'The file is missing the SQLite header. Pick a real backup (created by `sm db backup`).',
  /**
   * Source is a valid DB but was written by a CLI this binary cannot
   * read forward (newer minor or different major). Refuse with exit 2.
   */
  restoreSourceVersionSkew:
    '{{glyph}}  Refusing to restore {{sourcePath}}\n' +
    '   {{detail}}\n' +
    '   {{hint}}\n',
  restoreSourceVersionNewerDetail:
    'It was written by skill-map {{dbVersion}}, newer than this CLI ({{currentVersion}}).',
  restoreSourceVersionMajorDetail:
    'It was written by skill-map {{dbVersion}}, a different major than this CLI ({{currentVersion}}).',
  restoreSourceVersionSkewHint:
    'Upgrade `sm` to a matching version before restoring this backup.',
  restoreConfirm: 'Restore {{sourcePath}} over {{target}}? This overwrites the current DB.',
  restoreDone: '{{glyph}}  Restored {{sourcePath}} → {{target}}\n',

  // --- shared ----------------------------------------------------------
  // Confirm-decline info lines (spec/cli-contract.md §Destructive
  // confirmation: declining is a voluntary no-op, exit 0, `ℹ` glyph).
  resetAborted: '{{glyph}}  sm db reset: aborted by user. Nothing deleted.\n',
  restoreAborted: '{{glyph}}  sm db restore: aborted by user. DB unchanged.\n',
  backupWritten: '{{glyph}}  Backup written: {{outPath}}\n',

  // --- migrate (sm db migrate) -----------------------------------------
  /**
   * §3.1b two-line block. Hint names the two valid scopes.
   */
  migrateKernelOnlyAndPluginMutex:
    '{{glyph}}  --kernel-only and --plugin are mutually exclusive.\n' +
    '   {{hint}}\n',
  migrateKernelOnlyAndPluginMutexHint:
    'Pick one scope: `--kernel-only` (kernel migrations only) or `--plugin <id>` (a single plugin store).',
  /**
   * §3.1b two-line block. The plugin id resolves to nothing the migrator
   * can touch (unknown or shares the kernel store); hint nudges toward
   * the discovery verbs.
   */
  migratePluginNotFound:
    '{{glyph}}  --plugin {{pluginId}}: no loaded plugin with that id and `storage.mode = "dedicated"`.\n' +
    '   {{hint}}\n',
  migratePluginNotFoundHint:
    'Run `sm plugins list` for discovered ids. Only plugins with a dedicated SQLite store carry migrations.',
  migrateStatusKernelHeader: 'kernel · Applied: {{applied}} · Pending: {{pending}}\n',
  migrateStatusPluginHeader:
    '\nplugin {{pluginId}} · Applied: {{applied}} · Pending: {{pending}}\n',
  migrateStatusPending: '  pending  {{name}}\n',
  migrateStatusApplied: '  applied  {{name}}\n',
  /**
   * §3.1b two-line block. Hint names the accepted shape so the operator
   * does not need to inspect the migrations folder by hand.
   */
  migrateInvalidTo:
    '{{glyph}}  --to expects an integer, got {{to}}\n' +
    '   {{hint}}\n',
  migrateInvalidToHint:
    'Pass the integer target version (run `sm db migrate` without `--to` to see the current and pending versions).',

  // --- migrate kernel apply / dry-run output ---------------------------
  migrateKernelDryNothing: '{{glyph}}  kernel · Nothing to apply.\n',
  migrateKernelDryHeader: 'kernel · Would apply {{count}} migration{{plural}}:\n{{lines}}\n',
  migrateKernelUpToDate: '{{glyph}}  kernel · Already up to date.\n',
  migrateKernelApplied: '{{glyph}}  kernel · Applied {{count}} migration{{plural}}\n',
  migrateKernelAppliedWithBackup:
    '{{glyph}}  kernel · Applied {{count}} migration{{plural}} · backup: {{backupPath}}\n',

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
    'plugin {{pluginId}} · Would apply {{count}} migration{{plural}}:\n{{lines}}\n',
  pluginMigrateUpToDate: '{{glyph}}  plugin {{pluginId}} · Already up to date.\n',
  pluginMigrateApplied: '{{glyph}}  plugin {{pluginId}} · Applied {{count}} migration{{plural}}\n',
  pluginMigrateIntrusion:
    'plugin {{pluginId}} · catalog intrusion detected: {{intrusions}}\n',

  // --- dry-run previews ------------------------------------------------
  dryRunHeader: '(dry-run, no DB writes, no file unlinks)\n',

  dryRunResetWouldClearNone:
    'would clear   0 tables: (none, DB schema is empty)\n',

  // The `lines` arg is a pre-built multi-line block, one
  // `dryRunResetTableLine` row per table, joined with `\n`.
  dryRunResetWouldClearWithRowCounts:
    'would clear   {{tableCount}} table{{tablePlural}} ({{totalRows}} total row{{rowPlural}}):\n{{lines}}\n',
  dryRunResetTableLine: '  - {{name}}: {{rowCount}} row{{plural}}',

  dryRunResetHardWouldDelete: 'would delete  {{path}} ({{sizeBytes}} bytes)\n',
  dryRunResetHardWouldDeleteMissing:
    'would delete  {{path}} (file does not exist, no-op)\n',

  // The `targetClause` arg is one of two pre-built strings:
  //   "(exists, would be overwritten)"  /  "(does not exist, would be created)".
  dryRunRestoreWouldOverwrite:
    'would copy    {{sourcePath}} ({{sourceBytes}} bytes) → {{target}} {{targetClause}}\n' +
    'would delete  {{target}}-wal and {{target}}-shm sidecars if present\n',

  dryRunRestoreTargetExistsClause: '(exists, would be overwritten)',
  dryRunRestoreTargetMissingClause: '(does not exist, would be created)',
} as const;
