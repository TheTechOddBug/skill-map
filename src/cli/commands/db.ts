/**
 * `sm db`, database lifecycle verbs. Backup, restore, reset, shell,
 * browser, dump, migrate. Destructive verbs (`restore`, `reset --state`,
 * `reset --hard`) require interactive confirmation unless `--yes` /
 * `--force` is passed, per spec/cli-contract.md §Database.
 *
 * Exit codes follow spec/cli-contract.md:
 *   0  ok (including a declined destructive confirm, §Destructive
 *      confirmation: the operator cancelling their own request is a
 *      voluntary no-op, not an error)
 *   2  error (unhandled / config)
 *   5  not-found
 *
 * This file is a barrel, each subcommand lives in its own file under
 * `cli/commands/db/`. Shared helpers (SQL identifier guard) live in
 * `cli/commands/db/shared.ts`.
 */

export { DbBackupCommand } from './db/backup.js';
export { DbRestoreCommand } from './db/restore.js';
export { DbResetCommand } from './db/reset.js';
export { DbShellCommand } from './db/shell.js';
export { DbBrowserCommand } from './db/browser.js';
export { DbDumpCommand } from './db/dump.js';
export { DbMigrateCommand } from './db/migrate.js';

import { DbBackupCommand } from './db/backup.js';
import { DbRestoreCommand } from './db/restore.js';
import { DbResetCommand } from './db/reset.js';
import { DbShellCommand } from './db/shell.js';
import { DbBrowserCommand } from './db/browser.js';
import { DbDumpCommand } from './db/dump.js';
import { DbMigrateCommand } from './db/migrate.js';

/** Aggregate export so CLI entry can register every db verb in one line. */
export const DB_COMMANDS = [
  DbBackupCommand,
  DbRestoreCommand,
  DbResetCommand,
  DbShellCommand,
  DbBrowserCommand,
  DbDumpCommand,
  DbMigrateCommand,
];
