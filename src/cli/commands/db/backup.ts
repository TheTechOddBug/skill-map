/**
 * `sm db backup`, WAL checkpoint + raw file copy of the active DB to a
 * timestamped path (or `--out <path>`). Routed through the storage
 * port's `writeBackup`, which does the checkpoint, parent-dir creation,
 * and atomic copy in one call.
 */

import { join, resolve } from 'node:path';

import { Command, Option } from 'clipanion';

import { relativeIfBelow } from '../../util/path-display.js';
import { withSqlite } from '../../../core/sqlite/with-sqlite.js';
import { tx } from '../../../kernel/util/tx.js';
import { DB_TEXTS } from '../../i18n/db.texts.js';
import { backupsDirForDb, requireDbOrExit, resolveDbPath } from '../../util/db-path.js';
import { defaultRuntimeContext } from '../../../core/runtime/runtime-context.js';
import { ExitCode } from '../../util/exit-codes.js';
import { SmCommand } from '../../util/sm-command.js';

export class DbBackupCommand extends SmCommand {
  static override paths = [['db', 'backup']];
  static override usage = Command.Usage({
    category: 'Database',
    description: 'WAL checkpoint + copy the DB file to a backup.',
    details: `
      Default output: <db-dir>/backups/<timestamp>.db. Use --out to override.
      scan_* is regenerated on demand and is NOT excluded from the raw file
      copy, but restoring a backup over a live DB is the expected use;
      running sm scan afterwards refreshes scan_*.
    `,
  });

  out = Option.String('--out', { required: false });

  protected async run(): Promise<number> {
    const path = resolveDbPath({ db: this.db, ...defaultRuntimeContext() });
    const exit = requireDbOrExit(path, this.context.stderr, this.noColor);
    if (exit !== null) return exit;

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const outPath = this.out ? resolve(this.out) : join(backupsDirForDb(path), `${ts}.db`);

    // Route through the storage port, the port's `writeBackup` does
    // the WAL checkpoint, parent-directory creation, and atomic file
    // copy in one call. `autoMigrate: false` keeps the open from
    // touching schema; `autoBackup: false` is implied because no
    // migrations run. `skipDriftCheck: true` because a backup is a raw
    // file copy that must succeed even on a drifted DB (you may want a
    // copy BEFORE `sm db reset --hard`); it never queries the drifted
    // columns, so the write-side refusal would only get in the way. The
    // verb composes `outPath` (timestamp default or `--out` override)
    // and hands it to the port.
    await withSqlite(
      { databasePath: path, autoMigrate: false, skipDriftCheck: true },
      async (storage) => {
        storage.migrations.writeBackup(outPath);
      },
    );

    const ansi = this.ansiFor('stdout');
    this.printer!.data(
      tx(DB_TEXTS.backupWritten, {
        glyph: ansi.green('✓'),
        outPath: relativeIfBelow(outPath, defaultRuntimeContext().cwd),
      }),
    );
    return ExitCode.Ok;
  }
}
