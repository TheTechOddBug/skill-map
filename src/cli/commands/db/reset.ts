/**
 * `sm db reset`, drop `scan_*` (default), optionally `state_*`, or
 * delete the DB entirely (`--hard`). Destructive variants confirm
 * interactively unless `--yes` / `--force` is passed; `--dry-run`
 * previews without touching anything.
 */

import { rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

import { Command, Option } from 'clipanion';

import { relativeIfBelow } from '../../util/path-display.js';
import { confirm } from '../../util/confirm.js';
import { tx } from '../../../kernel/util/tx.js';
import { DB_TEXTS } from '../../i18n/db.texts.js';
import { requireDbOrExit, resolveDbPath } from '../../util/db-path.js';
import { defaultRuntimeContext } from '../../util/runtime-context.js';
import { ExitCode } from '../../util/exit-codes.js';
import { pathExists, statOrNull } from '../../util/fs.js';
import { SmCommand } from '../../util/sm-command.js';
import { assertSafeIdentifier } from './shared.js';

export class DbResetCommand extends SmCommand {
  static override paths = [['db', 'reset']];
  static override usage = Command.Usage({
    category: 'Database',
    description: 'Drop scan_* (default), optionally state_*, or delete the DB entirely.',
    details: `
      Without flags: drops scan_* tables only. Non-destructive, no prompt.
      With --state: also drops state_* tables. Destructive, requires
      confirmation unless --yes / --force.
      With --hard: deletes the DB file entirely. Destructive, requires
      confirmation unless --yes / --force.
      With --dry-run: previews what would be cleared / deleted without
      touching the DB. Bypasses the confirmation prompt entirely (the
      preview itself is non-destructive).
    `,
  });

  state = Option.Boolean('--state', false);
  hard = Option.Boolean('--hard', false);
  yes = Option.Boolean('--yes,--force', false);
  dryRun = Option.Boolean('-n,--dry-run', false, {
    description: 'Preview the reset without dropping any tables or unlinking any files.',
  });

  // CLI orchestrator: --state vs --hard flag combo + --dry-run + --yes
  // confirm + per-mode actions. The early-return chain is the clearest
  // expression of the flag semantics; splitting per branch would
  // distance the validations from their guards.
  // eslint-disable-next-line complexity
  protected async run(): Promise<number> {
    const stderrAnsiReset = this.ansiFor('stderr');
    if (this.state && this.hard) {
      this.printer!.error(
        tx(DB_TEXTS.resetStateAndHardMutex, { glyph: stderrAnsiReset.red('✕') }),
      );
      return ExitCode.Error;
    }

    const path = resolveDbPath({ global: this.global, db: this.db, ...defaultRuntimeContext() });

    if (this.hard) {
      if (this.dryRun) {
        this.printer!.data(DB_TEXTS.dryRunHeader);
        const dbStat = await statOrNull(path);
        const sizeBytes = dbStat ? dbStat.size : null;
        this.printer!.data(
          sizeBytes === null
            ? tx(DB_TEXTS.dryRunResetHardWouldDeleteMissing, { path })
            : tx(DB_TEXTS.dryRunResetHardWouldDelete, { path, sizeBytes }),
        );
        return ExitCode.Ok;
      }
      if (!this.yes) {
        const ok = await confirm(tx(DB_TEXTS.resetHardConfirm, { path }), {
          stdin: this.context.stdin,
          stderr: this.context.stderr,
        });
        if (!ok) {
          this.printer!.info(DB_TEXTS.aborted);
          return ExitCode.Error;
        }
      }
      for (const suffix of ['', '-wal', '-shm']) {
        const p = `${path}${suffix}`;
        if (await pathExists(p)) await rm(p);
      }
      const ansiHard = this.ansiFor('stdout');
      this.printer!.data(
        tx(DB_TEXTS.resetHardDeleted, {
          glyph: ansiHard.green('✓'),
          path: relativeIfBelow(path, defaultRuntimeContext().cwd),
        }),
      );
      return ExitCode.Ok;
    }

    const exit = requireDbOrExit(path, this.context.stderr);
    if (exit !== null) return exit;

    if (this.state && !this.yes && !this.dryRun) {
      const ok = await confirm(tx(DB_TEXTS.resetStateConfirm, { path }), {
        stdin: this.context.stdin,
        stderr: this.context.stderr,
      });
      if (!ok) {
        this.printer!.info(DB_TEXTS.aborted);
        return ExitCode.Error;
      }
    }

    const db = new DatabaseSync(path);
    try {
      const rows = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'scan\\_%' ESCAPE '\\'"
            + (this.state ? " OR name LIKE 'state\\_%' ESCAPE '\\'" : '')
            + ')',
        )
        .all() as Array<{ name: string }>;

      // Defence in depth, the LIKE filter above already restricts
      // results to `scan_*` (and optionally `state_*`) catalog rows, but
      // the per-plugin migration validator approves DML in plugin-owned
      // tables. A future bug there could yield a row with an unsafe
      // name reaching this loop. Whitelist + double-quote before
      // interpolating into a statement that is exec'd as-is.
      for (const r of rows) assertSafeIdentifier(r.name);

      if (this.dryRun) {
        this.printer!.data(DB_TEXTS.dryRunHeader);
        if (rows.length === 0) {
          this.printer!.data(DB_TEXTS.dryRunResetWouldClearNone);
          return ExitCode.Ok;
        }
        // Probe row counts so the user sees the destructive scope. Read-
        // only queries, safe in dry-run.
        const withCounts = rows.map((r) => {
          const count = db.prepare(`SELECT COUNT(*) AS c FROM "${r.name}"`).get() as { c: number };
          return { name: r.name, rowCount: Number(count.c) };
        });
        const totalRows = withCounts.reduce((acc, r) => acc + r.rowCount, 0);
        const lines = withCounts.map((r) => `  - ${r.name}: ${r.rowCount} row(s)`).join('\n');
        this.printer!.data(
          tx(DB_TEXTS.dryRunResetWouldClearWithRowCounts, {
            tableCount: rows.length,
            totalRows,
            lines,
          }),
        );
        return ExitCode.Ok;
      }

      db.exec('BEGIN');
      for (const { name } of rows) {
        db.exec(`DELETE FROM "${name}"`);
      }
      db.exec('COMMIT');

      const ansiReset = this.ansiFor('stdout');
      this.printer!.data(
        rows.length === 0
          ? tx(DB_TEXTS.resetClearedNone, { glyph: ansiReset.green('✓') })
          : tx(DB_TEXTS.resetCleared, {
              glyph: ansiReset.green('✓'),
              tableCount: rows.length,
              tableNames: rows.map((r) => r.name).join(', '),
            }),
      );
    } finally {
      db.close();
    }
    return ExitCode.Ok;
  }
}
