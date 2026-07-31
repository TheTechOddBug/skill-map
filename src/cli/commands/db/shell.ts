/**
 * `sm db shell`, spawn an interactive `sqlite3` shell on the DB file.
 * Emits a directed install / fallback hint when the system binary is
 * missing instead of failing with a raw ENOENT.
 */

import { spawnSync } from 'node:child_process';

import { Command } from 'clipanion';

import { tx } from '../../../kernel/util/tx.js';
import { DB_TEXTS } from '../../i18n/db.texts.js';
import { requireDbOrExit, resolveDbPath } from '../../util/db-path.js';
import { defaultRuntimeContext } from '../../../core/runtime/runtime-context.js';
import { ExitCode } from '../../util/exit-codes.js';
import { SmCommand } from '../../util/sm-command.js';

export class DbShellCommand extends SmCommand {
  static override paths = [['db', 'shell']];
  // The verb's own codes. It ALSO passes through `sqlite3`'s exit status
  // verbatim (`result.status`), so a caller scripting around it can see
  // any code the shell itself returns; only skill-map's own outcomes are
  // published, since the passthrough set is the system binary's contract,
  // not this CLI's.
  static override exitCodes = [ExitCode.Ok, ExitCode.Error, ExitCode.NotFound];
  static override usage = Command.Usage({
    category: 'Database',
    description: 'Open an interactive sqlite3 shell on the DB file.',
    details: `
      Spawns the system sqlite3 binary. If sqlite3 is not on PATH, a
      clear error points at the two workarounds: install sqlite3, or use
      sm db dump for a read-only inspection.
    `,
  });

  // Interactive shell: the spawned `sqlite3` owns the terminal. No
  // `done in <…>` line, the user expects to see the shell's own
  // prompt + farewell, not a follow-up trailer once they exit.
  protected override emitElapsed = false;

  protected async run(): Promise<number> {
    const path = resolveDbPath({ db: this.db, ...defaultRuntimeContext() });
    const exit = requireDbOrExit(path, this.context.stderr, this.noColor);
    if (exit !== null) return exit;

    const result = spawnSync('sqlite3', [path], { stdio: 'inherit' });
    if (result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT') {
      const ansi = this.ansiFor('stderr');
      this.printer!.error(
        tx(DB_TEXTS.shellSqlite3NotFound, {
          glyph: ansi.red('✕'),
          hint: ansi.dim(DB_TEXTS.shellSqlite3NotFoundHint),
        }),
      );
      return ExitCode.Error;
    }
    // Signal-killed shells (Ctrl-\, SIGSEGV, …) report `signal != null`
    // and `status == null`; collapsing both to 0 would hide a crash from
    // any caller piping `sm db shell` into a script. Treat as error.
    if (result.signal) return ExitCode.Error;
    return result.status ?? ExitCode.Error;
  }
}
