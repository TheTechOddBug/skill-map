/**
 * `sm db migrate`, apply pending kernel + plugin migrations, or print
 * the plan. Triple-protected plugin namespace guards are enforced by
 * the storage adapter; this verb orchestrates the kernel pass + the
 * per-plugin fan-out, threading dry-run / status / `--plugin <id>` /
 * `--kernel-only` flag combos.
 */

import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import { Command, Option } from 'clipanion';

import type { IAnsi } from '../../util/ansi.js';
import { relativeIfBelow } from '../../util/path-display.js';
import { tx } from '../../../kernel/util/tx.js';
import { DB_TEXTS } from '../../i18n/db.texts.js';

import { createSqliteStorage } from '../../../kernel/adapters/sqlite/index.js';
import type { StoragePort } from '../../../kernel/ports/storage.js';
import type { IPluginApplyResult } from '../../../kernel/adapters/sqlite/plugin-migrations.js';
import type { IDiscoveredPlugin } from '../../../kernel/types/plugin.js';
import { appendOperation } from '../../../core/operations-log.js';
import { resolveDbPath } from '../../util/db-path.js';
import { defaultRuntimeContext } from '../../../core/runtime/runtime-context.js';
import { ExitCode } from '../../util/exit-codes.js';
import { formatErrorMessage } from '../../../kernel/util/format-error.js';
import { pluralSuffix } from '../../../kernel/util/text.js';
import { tryParseNonNegativeInt } from '../../util/option-validators.js';
import {
  emptyPluginRuntime,
  loadPluginRuntime,
} from '../../../core/runtime/plugin-runtime.js';
import { SmCommand } from '../../util/sm-command.js';

export class DbMigrateCommand extends SmCommand {
  static override paths = [['db', 'migrate']];
  static override usage = Command.Usage({
    category: 'Database',
    description: 'Apply pending kernel + plugin migrations (default) or inspect plan.',
    details: `
      --dry-run       show pending migrations without applying.
      --status        print applied vs pending summary and exit.
      --to <n>        apply up to (and including) version N (kernel only).
      --no-backup     skip the pre-apply backup.
      --kernel-only   skip plugin migrations entirely.
      --plugin <id>   run only that plugin's migrations (skips kernel migrations).

      Plugin migrations live under <plugin-dir>/migrations/ and follow
      the same NNN_snake_case.sql convention as kernel migrations. Each
      migration is gated by a triple-protection rule: every object it
      creates / alters / drops MUST live in the namespace
      \`plugin_<normalizedId>_*\`. Layer 1 validates every pending file
      before anything runs; Layer 2 re-validates immediately before
      apply; Layer 3 sweeps sqlite_master after apply and reports any
      object outside the prefix.
    `,
  });

  dryRun = Option.Boolean('-n,--dry-run', false);
  status = Option.Boolean('--status', false);
  to = Option.String('--to', { required: false });
  noBackup = Option.Boolean('--no-backup', false);
  kernelOnly = Option.Boolean('--kernel-only', false);
  pluginId = Option.String('--plugin', { required: false });

  // Multi-flag CLI orchestrator: validates flag combos, optionally
  // discovers plugins, fans out into status / apply branches against
  // both the kernel ledger and per-plugin ledgers. Splitting per branch
  // would scatter the close-to-call-site flag handling without making
  // the verb easier to follow.
  // eslint-disable-next-line complexity
  protected async run(): Promise<number> {
    const stderrAnsiMig = this.ansiFor('stderr');
    const errGlyphMig = stderrAnsiMig.red('✕');
    if (this.kernelOnly && this.pluginId !== undefined) {
      this.printer!.error(
        tx(DB_TEXTS.migrateKernelOnlyAndPluginMutex, {
          glyph: errGlyphMig,
          hint: stderrAnsiMig.dim(DB_TEXTS.migrateKernelOnlyAndPluginMutexHint),
        }),
      );
      return ExitCode.Error;
    }

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

      // --- discover plugins for everything but --kernel-only -----------
      // We always need the plugin set for `--status` and the apply path
      // when plugin migrations are in play. Skip discovery only when the
      // user explicitly asked for kernel-only mode.
      const pluginRuntime = this.kernelOnly
        ? emptyPluginRuntime()
        : await loadPluginRuntime();
      pluginRuntime.emitWarnings(this.printer!);
      const dedicated = pluginRuntime.discovered.filter(
        (p) => p.status === 'enabled' && p.manifest?.storage?.mode === 'dedicated',
      );
      const targetedPlugins = this.pluginId !== undefined
        ? dedicated.filter((p) => p.id === this.pluginId)
        : dedicated;

      if (this.pluginId !== undefined && targetedPlugins.length === 0) {
        this.printer!.error(
          tx(DB_TEXTS.migratePluginNotFound, {
            glyph: errGlyphMig,
            pluginId: this.pluginId,
            hint: stderrAnsiMig.dim(DB_TEXTS.migratePluginNotFoundHint),
          }),
        );
        return ExitCode.NotFound;
      }

      // --- status branch (read-only summary) ---------------------------
      if (this.status) {
        if (!this.pluginId) {
          const plan = adapter.migrations.plan(files);
          this.printer!.data(
            tx(DB_TEXTS.migrateStatusKernelHeader, {
              applied: plan.applied.length, pending: plan.pending.length,
            }),
          );
          for (const f of plan.pending) {
            this.printer!.data(
              tx(DB_TEXTS.migrateStatusPending, { name: formatKernelName(f.version, f.description) }),
            );
          }
          for (const r of plan.applied) {
            this.printer!.data(
              tx(DB_TEXTS.migrateStatusApplied, { name: formatKernelName(r.version, r.description) }),
            );
          }
        }
        if (!this.kernelOnly) {
          for (const plugin of targetedPlugins) {
            const plan = adapter.pluginMigrations.plan(plugin);
            this.printer!.data(
              tx(DB_TEXTS.migrateStatusPluginHeader, {
                pluginId: plugin.id,
                applied: plan.applied.length,
                pending: plan.pending.length,
              }),
            );
            for (const f of plan.pending) {
              this.printer!.data(
                tx(DB_TEXTS.migrateStatusPending, { name: formatKernelName(f.version, f.description) }),
              );
            }
            for (const r of plan.applied) {
              this.printer!.data(
                tx(DB_TEXTS.migrateStatusApplied, { name: formatKernelName(r.version, r.description) }),
              );
            }
          }
        }
        return ExitCode.Ok;
      }

      // `tryParseNonNegativeInt` rejects negatives, floats, NaN and
      // `'123abc'`-style trailing garbage so a typo doesn't silently
      // roll the migration ledger to an unexpected target.
      let toValue: number | undefined;
      if (this.to !== undefined) {
        const parsed = tryParseNonNegativeInt(this.to);
        if (parsed === null) {
          this.printer!.error(
            tx(DB_TEXTS.migrateInvalidTo, {
              glyph: errGlyphMig,
              to: this.to,
              hint: stderrAnsiMig.dim(DB_TEXTS.migrateInvalidToHint),
            }),
          );
          return ExitCode.Error;
        }
        toValue = parsed;
      }

      // --- kernel pass --------------------------------------------------
      // Skipped under `--plugin <id>`: that mode targets a single plugin
      // and is not meant to advance the kernel ledger.
      const ansiMig = this.ansiFor('stdout');
      const okGlyph = ansiMig.green('✓');
      const cwdMig = defaultRuntimeContext().cwd;
      let kernelApplied: number | undefined;
      let backupPath: string | null = null;
      if (this.pluginId === undefined) {
        const options: { backup: boolean; dryRun: boolean; to?: number } = {
          backup: !this.noBackup,
          dryRun: this.dryRun,
        };
        if (toValue !== undefined) options.to = toValue;

        const result = adapter.migrations.apply(options, files);
        kernelApplied = result.applied.length;
        backupPath = result.backupPath;

        if (this.dryRun) {
          this.printer!.data(
            kernelApplied === 0
              ? tx(DB_TEXTS.migrateKernelDryNothing, { glyph: okGlyph })
              : tx(DB_TEXTS.migrateKernelDryHeader, {
                  count: kernelApplied,
                  plural: pluralSuffix(kernelApplied),
                  lines: result.applied
                    .map((m) => `  ${formatKernelName(m.version, m.description)}`)
                    .join('\n'),
                }),
          );
        } else if (kernelApplied === 0) {
          this.printer!.data(tx(DB_TEXTS.migrateKernelUpToDate, { glyph: okGlyph }));
        } else {
          this.printer!.data(
            backupPath
              ? tx(DB_TEXTS.migrateKernelAppliedWithBackup, {
                  glyph: okGlyph,
                  count: kernelApplied,
                  plural: pluralSuffix(kernelApplied),
                  backupPath: relativeIfBelow(backupPath, cwdMig),
                })
              : tx(DB_TEXTS.migrateKernelApplied, {
                  glyph: okGlyph,
                  count: kernelApplied,
                  plural: pluralSuffix(kernelApplied),
                }),
          );
        }
      }

      // --- plugin pass --------------------------------------------------
      if (!this.kernelOnly) {
        const exitCode = await runPluginMigrations({
          adapter,
          plugins: targetedPlugins,
          dryRun: this.dryRun,
          stdout: this.context.stdout,
          stderr: this.context.stderr,
          ansi: ansiMig,
        });
        if (exitCode !== 0) return exitCode;
      }

      if (!this.dryRun) {
        appendOperation(cwdMig, {
          op: 'db.migrate',
          target: '*',
          channel: 'cli',
          outcome: 'ok',
          detail:
            kernelApplied === undefined ? 'plugin-only' : `kernelApplied=${kernelApplied}`,
        });
      }

      return ExitCode.Ok;
    } finally {
      await adapter.close();
    }
  }
}

interface IRunPluginMigrationsOpts {
  adapter: StoragePort;
  plugins: IDiscoveredPlugin[];
  dryRun: boolean;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  ansi: IAnsi;
}

/**
 * Drive every targeted plugin's migration batch in sequence. Layer-3
 * intrusions are reported on stderr and flip the exit code to 2, the
 * ledger row is still written for whatever applied cleanly, but the
 * caller knows something deeper is off (a plugin slipped a non-prefixed
 * object past the regex check). This is the intentional contract: don't
 * silently revert, surface the breach loud and clear.
 */
async function runPluginMigrations(opts: IRunPluginMigrationsOpts): Promise<number> {
  const { adapter, plugins, dryRun, stdout, stderr, ansi } = opts;
  const okGlyph = ansi.green('✓');
  const errGlyph = ansi.red('✕');
  let exit = 0;
  for (const plugin of plugins) {
    let result: IPluginApplyResult;
    try {
      result = adapter.pluginMigrations.apply(plugin, { dryRun });
    } catch (err) {
      const reason = formatErrorMessage(err);
      stderr.write(tx(DB_TEXTS.pluginMigrateFailure, { glyph: errGlyph, pluginId: plugin.id, reason }));
      exit = ExitCode.Error;
      continue;
    }
    if (dryRun) {
      stdout.write(
        result.applied.length === 0
          ? tx(DB_TEXTS.pluginMigrateDryNothing, { glyph: okGlyph, pluginId: plugin.id })
          : tx(DB_TEXTS.pluginMigrateDryHeader, {
              pluginId: plugin.id,
              count: result.applied.length,
              plural: pluralSuffix(result.applied.length),
              lines: result.applied
                .map((m) => `  ${formatKernelName(m.version, m.description)}`)
                .join('\n'),
            }),
      );
    } else {
      stdout.write(
        result.applied.length === 0
          ? tx(DB_TEXTS.pluginMigrateUpToDate, { glyph: okGlyph, pluginId: plugin.id })
          : tx(DB_TEXTS.pluginMigrateApplied, {
              glyph: okGlyph,
              pluginId: plugin.id,
              count: result.applied.length,
              plural: pluralSuffix(result.applied.length),
            }),
      );
    }
    if (result.intrusions.length > 0) {
      stderr.write(
        tx(DB_TEXTS.pluginMigrateIntrusion, {
          pluginId: plugin.id,
          intrusions: result.intrusions.join(', '),
        }),
      );
      exit = ExitCode.Error;
    }
  }
  return exit;
}


function formatKernelName(version: number, description: string): string {
  return `${String(version).padStart(3, '0')}_${description}`;
}
