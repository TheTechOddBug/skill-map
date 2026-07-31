/**
 * `sm db reset`, drop `scan_*` (default), optionally `state_*`, or
 * delete the DB entirely (`--hard`). Destructive variants confirm
 * interactively unless `--yes` / `--force` is passed; `--dry-run`
 * previews without touching anything.
 */

import { DatabaseSync } from 'node:sqlite';

import { Command, Option } from 'clipanion';

import { relativeIfBelow } from '../../util/path-display.js';
import { confirm } from '../../util/confirm.js';
import { tx } from '../../../kernel/util/tx.js';
import { pluralSuffix } from '../../../kernel/util/text.js';
import { DB_TEXTS } from '../../i18n/db.texts.js';
import { requireDbOrExit, resolveDbPath } from '../../util/db-path.js';
import { defaultRuntimeContext } from '../../../core/runtime/runtime-context.js';
import { ExitCode } from '../../util/exit-codes.js';
import { appendOperation } from '../../../core/operations-log.js';
import { removeDbFiles } from '../../../core/sqlite/db-files.js';
import { statOrNull } from '../../util/fs.js';
import { SmCommand } from '../../util/sm-command.js';
import { assertSafeIdentifier } from './shared.js';

export class DbResetCommand extends SmCommand {
  static override paths = [['db', 'reset']];
  static override exitCodes = [ExitCode.Ok, ExitCode.Error, ExitCode.NotFound];
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
      --json emits { ok, kind: 'db-reset', scope, dryRun, tables[],
      elapsedMs }.
    `,
  });

  state = Option.Boolean('--state', false);
  hard = Option.Boolean('--hard', false);
  yes = Option.Boolean('--yes,--force', false);
  dryRun = Option.Boolean('-n,--dry-run', false, {
    description: 'Preview the reset without dropping any tables or unlinking any files.',
  });

  /**
   * Flag-combo gate, then hand off to the mode that owns the work.
   * `--hard` unlinks the file (and never probes existence, deleting an
   * absent DB is an idempotent no-op); everything else clears tables in
   * place and therefore needs the DB to be there.
   */
  protected async run(): Promise<number> {
    const stderrAnsiReset = this.ansiFor('stderr');
    if (this.state && this.hard) {
      this.printer!.error(
        tx(DB_TEXTS.resetStateAndHardMutex, {
          glyph: stderrAnsiReset.red('✕'),
          hint: stderrAnsiReset.dim(DB_TEXTS.resetStateAndHardMutexHint),
        }),
      );
      return ExitCode.Error;
    }

    const path = resolveDbPath({ db: this.db, ...defaultRuntimeContext() });
    if (this.hard) return this.#runHard(path);

    const exit = requireDbOrExit(path, this.context.stderr, this.noColor);
    if (exit !== null) return exit;
    return this.#runTables(path);
  }

  /** `--hard`: preview, confirm, then unlink the DB file and its siblings. */
  async #runHard(path: string): Promise<number> {
    if (this.dryRun) return this.#previewHard(path);
    if (!this.yes) {
      const ok = await confirm(tx(DB_TEXTS.resetHardConfirm, { path }), {
        stdin: this.context.stdin,
        stderr: this.context.stderr,
      });
      if (!ok) {
        this.printer!.info(
          tx(DB_TEXTS.resetAborted, { glyph: this.ansiFor('stderr').cyan('ℹ') }),
        );
        return ExitCode.Ok;
      }
    }
    await removeDbFiles(path);
    // §Operations log: the delete leaves `.skill-map/` in place, so
    // the log line survives its own subject's destruction.
    appendOperation(defaultRuntimeContext().cwd, {
      op: 'db.reset',
      target: '*',
      channel: 'cli',
      outcome: 'ok',
      detail: 'mode=hard',
    });
    if (this.json) {
      this.#emitJson([]);
      return ExitCode.Ok;
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

  /**
   * `--hard --dry-run`: report the file that would go, never unlink it.
   * `--hard` deletes a FILE, not tables, so the envelope's `tables` list
   * is legitimately empty here.
   */
  async #previewHard(path: string): Promise<number> {
    if (this.json) {
      this.#emitJson([]);
      return ExitCode.Ok;
    }
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

  /** Default / `--state`: confirm when destructive, then clear the tables. */
  async #runTables(path: string): Promise<number> {
    if (this.state && !this.yes && !this.dryRun) {
      const ok = await confirm(tx(DB_TEXTS.resetStateConfirm, { path }), {
        stdin: this.context.stdin,
        stderr: this.context.stderr,
      });
      if (!ok) {
        this.printer!.info(
          tx(DB_TEXTS.resetAborted, { glyph: this.ansiFor('stderr').cyan('ℹ') }),
        );
        return ExitCode.Ok;
      }
    }

    const db = new DatabaseSync(path);
    try {
      const rows = listResettableTables(db, this.state);
      // Defence in depth, the LIKE filter already restricts results to
      // `scan_*` (and optionally `state_*`) catalog rows, so nothing
      // outside the kernel's own naming should reach this loop.
      // Whitelist + double-quote anyway before interpolating into a
      // statement that is exec'd as-is.
      for (const r of rows) assertSafeIdentifier(r.name);

      if (this.dryRun) return this.#previewTables(db, rows);
      this.#clearTables(db, rows);
    } finally {
      db.close();
    }
    return ExitCode.Ok;
  }

  /** `--dry-run`: report the tables and the rows at stake, delete nothing. */
  #previewTables(db: DatabaseSync, rows: ReadonlyArray<{ name: string }>): number {
    if (this.json) {
      this.#emitJson(rows.map((r) => ({ name: r.name, rows: countRows(db, r.name) })));
      return ExitCode.Ok;
    }
    this.printer!.data(DB_TEXTS.dryRunHeader);
    if (rows.length === 0) {
      this.printer!.data(DB_TEXTS.dryRunResetWouldClearNone);
      return ExitCode.Ok;
    }
    // Probe row counts so the user sees the destructive scope. Read-
    // only queries, safe in dry-run.
    const withCounts = rows.map((r) => ({ name: r.name, rowCount: countRows(db, r.name) }));
    const totalRows = withCounts.reduce((acc, r) => acc + r.rowCount, 0);
    const lines = withCounts
      .map((r) =>
        tx(DB_TEXTS.dryRunResetTableLine, {
          name: r.name,
          rowCount: r.rowCount,
          plural: pluralSuffix(r.rowCount),
        }),
      )
      .join('\n');
    this.printer!.data(
      tx(DB_TEXTS.dryRunResetWouldClearWithRowCounts, {
        tableCount: rows.length,
        tablePlural: pluralSuffix(rows.length),
        totalRows,
        rowPlural: pluralSuffix(totalRows),
        lines,
      }),
    );
    return ExitCode.Ok;
  }

  /**
   * Clear every matched table inside one transaction, log the operation,
   * and report. The DELETE runs through a prepared statement so the
   * deleted-row count comes back with the write itself; the envelope's
   * `rows` therefore means the same thing in both modes (the rows the
   * reset is accountable for) with no extra probe query.
   */
  #clearTables(db: DatabaseSync, rows: ReadonlyArray<{ name: string }>): void {
    db.exec('BEGIN');
    const cleared = rows.map((r) => ({
      name: r.name,
      rows: Number(db.prepare(`DELETE FROM "${r.name}"`).run().changes),
    }));
    db.exec('COMMIT');

    appendOperation(defaultRuntimeContext().cwd, {
      op: 'db.reset',
      target: '*',
      channel: 'cli',
      outcome: 'ok',
      detail: `mode=${this.state ? 'state' : 'scan'} tables=${rows.length}`,
    });

    if (this.json) {
      this.#emitJson(cleared);
      return;
    }
    const ansiReset = this.ansiFor('stdout');
    this.printer!.data(
      rows.length === 0
        ? tx(DB_TEXTS.resetClearedNone, { glyph: ansiReset.green('✓') })
        : tx(DB_TEXTS.resetCleared, {
            glyph: ansiReset.green('✓'),
            tableCount: rows.length,
            plural: pluralSuffix(rows.length),
            tableNames: rows.map((r) => r.name).join(', '),
          }),
    );
  }

  /** One JSON document on stdout, shared by every completion path. */
  #emitJson(tables: ReadonlyArray<{ name: string; rows: number }>): void {
    this.printer!.data(
      JSON.stringify({
        ok: true,
        kind: 'db-reset',
        scope: this.hard ? 'hard' : this.state ? 'state' : 'scan',
        dryRun: this.dryRun,
        tables,
        elapsedMs: this.elapsed!.ms(),
      }) + '\n',
    );
  }
}

/** The `scan_*` (and, with `--state`, `state_*`) tables this reset owns. */
function listResettableTables(db: DatabaseSync, includeState: boolean): Array<{ name: string }> {
  return db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'scan\\_%' ESCAPE '\\'"
        + (includeState ? " OR name LIKE 'state\\_%' ESCAPE '\\'" : '')
        + ')',
    )
    .all() as Array<{ name: string }>;
}

/** Row count of one already-whitelisted table. */
function countRows(db: DatabaseSync, name: string): number {
  const count = db.prepare(`SELECT COUNT(*) AS c FROM "${name}"`).get() as { c: number };
  return Number(count.c);
}
