/**
 * `sm db migrate`, apply pending kernel migrations, or print the plan.
 * Threads the dry-run / status / `--to` / `--no-backup` flag combos onto
 * the kernel migration ledger.
 */

import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import { Command, Option } from 'clipanion';

import { relativeIfBelow } from '../../util/path-display.js';
import { tx } from '../../../kernel/util/tx.js';
import { DB_TEXTS } from '../../i18n/db.texts.js';

import { createSqliteStorage } from '../../../kernel/adapters/sqlite/index.js';
import type { IApplyResult, IMigrationPlan } from '../../../kernel/types/storage.js';
import type { IPrinter } from '../../../core/runtime/printer.js';
import { appendOperation } from '../../../core/operations-log.js';
import { resolveDbPath } from '../../util/db-path.js';
import { defaultRuntimeContext } from '../../../core/runtime/runtime-context.js';
import { ExitCode } from '../../util/exit-codes.js';
import { sanitizeForTerminal } from '../../../kernel/util/safe-text.js';
import { pluralSuffix } from '../../../kernel/util/text.js';
import { tryParseNonNegativeInt } from '../../util/option-validators.js';
import { SmCommand } from '../../util/sm-command.js';

export class DbMigrateCommand extends SmCommand {
  static override paths = [['db', 'migrate']];
  static override usage = Command.Usage({
    category: 'Database',
    description: 'Apply pending kernel migrations (default) or inspect plan.',
    details: `
      --dry-run       show pending migrations without applying.
      --status        print applied vs pending summary and exit.
      --to <n>        apply up to (and including) version N.
      --no-backup     skip the pre-apply backup.
    `,
  });

  dryRun = Option.Boolean('-n,--dry-run', false);
  status = Option.Boolean('--status', false);
  to = Option.String('--to', { required: false });
  noBackup = Option.Boolean('--no-backup', false);

  protected async run(): Promise<number> {
    const path = resolveDbPath({ db: this.db, ...defaultRuntimeContext() });

    if (path !== ':memory:') await mkdir(dirname(path), { recursive: true });

    // `autoMigrate: false` keeps the adapter from running migrations
    // on init(), the verb itself orchestrates the apply (or skips it
    // for `--status` / `--dry-run`). The migrations namespace's
    // methods open their own short-lived raw `DatabaseSync` handles
    // internally; the adapter's Kysely connection is unused by this
    // verb.
    const adapter = createSqliteStorage({
      databasePath: path,
      autoMigrate: false,
    });
    await adapter.init();
    try {
      const files = adapter.migrations.discover();

      // --- status branch (read-only summary) ---------------------------
      if (this.status) {
        printStatus(this.printer!, adapter.migrations.plan(files));
        return ExitCode.Ok;
      }

      const toValue = this.resolveTo();
      if (toValue === 'invalid') return ExitCode.Error;

      // --- apply branch --------------------------------------------------
      const options: { backup: boolean; dryRun: boolean; to?: number } = {
        backup: !this.noBackup,
        dryRun: this.dryRun,
      };
      if (toValue !== undefined) options.to = toValue;

      const result = adapter.migrations.apply(options, files);
      const cwdMig = defaultRuntimeContext().cwd;
      printApplyOutcome({
        printer: this.printer!,
        okGlyph: this.ansiFor('stdout').green('✓'),
        dryRun: this.dryRun,
        result,
        cwd: cwdMig,
      });

      if (!this.dryRun) {
        appendOperation(cwdMig, {
          op: 'db.migrate',
          target: '*',
          channel: 'cli',
          outcome: 'ok',
          detail: `kernelApplied=${result.applied.length}`,
        });
      }

      return ExitCode.Ok;
    } finally {
      await adapter.close();
    }
  }

  /**
   * Parse `--to`. `undefined` = the flag was absent (apply everything
   * pending); `'invalid'` = the value was rejected AND the §3.1b block
   * has already been printed, so the caller only has to bail.
   *
   * `tryParseNonNegativeInt` rejects negatives, floats, NaN and
   * `'123abc'`-style trailing garbage so a typo doesn't silently roll
   * the migration ledger to an unexpected target.
   */
  private resolveTo(): number | undefined | 'invalid' {
    if (this.to === undefined) return undefined;
    const parsed = tryParseNonNegativeInt(this.to);
    if (parsed !== null) return parsed;
    const stderrAnsiMig = this.ansiFor('stderr');
    this.printer!.error(
      tx(DB_TEXTS.migrateInvalidTo, {
        glyph: stderrAnsiMig.red('✕'),
        to: this.to,
        hint: stderrAnsiMig.dim(DB_TEXTS.migrateInvalidToHint),
      }),
    );
    return 'invalid';
  }
}

/** `--status`: the applied / pending ledger summary, newest section last. */
function printStatus(printer: IPrinter, plan: IMigrationPlan): void {
  printer.data(
    tx(DB_TEXTS.migrateStatusKernelHeader, {
      applied: plan.applied.length,
      pending: plan.pending.length,
    }),
  );
  for (const f of plan.pending) {
    printer.data(
      tx(DB_TEXTS.migrateStatusPending, { name: formatKernelName(f.version, f.description) }),
    );
  }
  for (const r of plan.applied) {
    printer.data(
      tx(DB_TEXTS.migrateStatusApplied, { name: formatKernelName(r.version, r.description) }),
    );
  }
}

interface IPrintApplyOutcomeOpts {
  printer: IPrinter;
  okGlyph: string;
  dryRun: boolean;
  result: IApplyResult;
  cwd: string;
}

/**
 * Render the apply result: the dry-run preview (nothing / the list that
 * would run) or the live outcome (up to date / applied, naming the
 * pre-apply backup when one was written).
 */
function printApplyOutcome(opts: IPrintApplyOutcomeOpts): void {
  const { printer, okGlyph, dryRun, result, cwd } = opts;
  const count = result.applied.length;

  if (dryRun) {
    printer.data(
      count === 0
        ? tx(DB_TEXTS.migrateKernelDryNothing, { glyph: okGlyph })
        : tx(DB_TEXTS.migrateKernelDryHeader, {
            count,
            plural: pluralSuffix(count),
            lines: result.applied
              .map((m) => `  ${formatKernelName(m.version, m.description)}`)
              .join('\n'),
          }),
    );
    return;
  }

  if (count === 0) {
    printer.data(tx(DB_TEXTS.migrateKernelUpToDate, { glyph: okGlyph }));
    return;
  }

  printer.data(
    result.backupPath
      ? tx(DB_TEXTS.migrateKernelAppliedWithBackup, {
          glyph: okGlyph,
          count,
          plural: pluralSuffix(count),
          backupPath: relativeIfBelow(result.backupPath, cwd),
        })
      : tx(DB_TEXTS.migrateKernelApplied, {
          glyph: okGlyph,
          count,
          plural: pluralSuffix(count),
        }),
  );
}

function formatKernelName(version: number, description: string): string {
  // Applied rows read back from the DB ledger and pending filenames from
  // disk are both untrusted for terminal output (tampered-DB / hostile
  // clone threat model); sanitize at this shared label boundary.
  return sanitizeForTerminal(`${String(version).padStart(3, '0')}_${description}`);
}
