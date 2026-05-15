/**
 * `sm db browser`, launch DB Browser for SQLite (sqlitebrowser) against
 * the resolved DB. Read-only by default so a concurrent `sm scan` writer
 * is safe; `--rw` enables writes.
 */

import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { Command, Option } from 'clipanion';

import { tx } from '../../../kernel/util/tx.js';
import { DB_TEXTS } from '../../i18n/db.texts.js';
import { assertDbExists, resolveDbPath } from '../../util/db-path.js';
import { defaultRuntimeContext } from '../../util/runtime-context.js';
import { ExitCode } from '../../util/exit-codes.js';
import { SmCommand } from '../../util/sm-command.js';

export class DbBrowserCommand extends SmCommand {
  static override paths = [['db', 'browser']];
  static override usage = Command.Usage({
    category: 'Database',
    description: 'Open the DB in DB Browser for SQLite (sqlitebrowser GUI).',
    details: `
      Default: read-only (-R), so a concurrent \`sm scan\` writer is safe.
      Pass --rw to enable writes.

      Resolution order for the DB path: positional arg > --db <path>
      > project default (cwd/.skill-map/skill-map.db).

      Spawns sqlitebrowser detached so the terminal stays usable. If
      sqlitebrowser is not on PATH, a clear error points at the install
      hint (Debian/Ubuntu: sudo apt install -y sqlitebrowser).
    `,
    examples: [
      ['Open the project DB read-only', 'sm db browser'],
      ['Open the project DB read-write', 'sm db browser --rw'],
      ['Open an arbitrary DB file', 'sm db browser path/to/other.db'],
    ],
  });

  // GUI launch: the spawned process is detached and unref'd; we exit
  // immediately. No `done in <…>` line, the user expects to see the
  // GUI window, not a follow-up trailer in the terminal.
  protected override emitElapsed = false;

  rw = Option.Boolean('--rw', false, {
    description:
      'Open in read-write mode. Default is read-only so a concurrent `sm scan` writer is safe.',
  });
  positional = Option.String({ required: false });

  protected async run(): Promise<number> {
    // Positional wins over `--db`; mirrors the legacy
    // `scripts/open-sqlite-browser.js` precedence so the cutover is a
    // pure rewire (no behaviour change for users).
    const path = this.positional
      ? resolve(this.positional)
      : resolveDbPath({ db: this.db, ...defaultRuntimeContext() });

    if (!assertDbExists(path, this.context.stderr)) {
      this.printer!.error(DB_TEXTS.browserRunScanFirstHint);
      return ExitCode.NotFound;
    }

    // Probe the binary via `--version` instead of `which`: portable to
    // Windows (where `which` is not on PATH) and mirrors the ENOENT
    // detection used by `sm db shell`. Any probe failure (ENOENT for a
    // missing binary, non-zero exit for a broken install) is treated as
    // "not usable", better to emit the install hint than to spawn a
    // broken GUI launcher detached.
    const probe = spawnSync('sqlitebrowser', ['--version'], { stdio: 'ignore' });
    if (probe.error || probe.status !== 0) {
      const ansiBrowser = this.ansiFor('stderr');
      this.printer!.error(tx(DB_TEXTS.browserNotFound, { glyph: ansiBrowser.red('✕') }));
      return ExitCode.Error;
    }

    const readOnly = !this.rw;
    const args = readOnly ? ['-R', path] : [path];

    this.printer!.data(
      tx(readOnly ? DB_TEXTS.browserOpeningReadOnly : DB_TEXTS.browserOpeningReadWrite, { path }),
    );

    const child = spawn('sqlitebrowser', args, { detached: true, stdio: 'ignore' });
    child.unref();
    return ExitCode.Ok;
  }
}
