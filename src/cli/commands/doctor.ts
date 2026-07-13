/**
 * `sm doctor`, the project diagnostic report (`spec/cli-contract.md`
 * §sm doctor). Eight read-only checks over the project DB, the plugin
 * runtime, and the LLM runner:
 *
 *   1. DB file integrity (`PRAGMA quick_check` via
 *      `port.migrations.quickCheck`).
 *   2. Pending kernel migrations (`port.migrations.plan`).
 *   3. Orphan history rows (active `orphan` issues, same source
 *      `sm orphans` lists).
 *   4. `state_jobs` rows whose content row is missing (corruption).
 *   5. `state_job_contents` GC stragglers (`sm job prune` collects).
 *   6. Plugins in error state (any status besides enabled / disabled).
 *   7. LLM runner availability (`claude` binary on PATH, version).
 *   8. Detected Providers that matched nothing (marker on disk, zero
 *      scanned nodes; non-blocking warning).
 *
 * Exit: 0 all green, 1 warnings, 2 any error-level problem. Checks 1
 * and 4 are the error-level ones (real corruption); everything else
 * warns with the actionable verb in the message.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { Command } from 'clipanion';

import type { IProvider } from '../../kernel/extensions/index.js';
import type { StoragePort } from '../../kernel/ports/storage.js';
import { probeClaudeCli, type IClaudeCliProbe } from '../../kernel/index.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tx } from '../../kernel/util/tx.js';
import { DOCTOR_TEXTS as T } from '../i18n/doctor.texts.js';
import type { IAnsi } from '../util/ansi.js';
import { buildReadVersionCheck } from '../util/db-version-check.js';
import { requireDbOrExit, resolveDbPath } from '../util/db-path.js';
import { ExitCode, type TExitCode } from '../util/exit-codes.js';
import { readConformanceKillSwitches } from '../util/conformance-env.js';
import { composeScanExtensions, loadPluginRuntime } from '../util/plugin-runtime.js';
import { defaultRuntimeContext } from '../util/runtime-context.js';
import { SmCommand } from '../util/sm-command.js';
import { withSqlite } from '../util/with-sqlite.js';

type TCheckStatus = 'ok' | 'warn' | 'error';

interface ICheckRow {
  id: string;
  status: TCheckStatus;
  message: string;
}

export class DoctorCommand extends SmCommand {
  static override paths = [['doctor']];
  static override usage = Command.Usage({
    category: 'Setup',
    description:
      'Diagnostic report: DB integrity, pending migrations, orphan rows, job-content consistency, plugin status, runner availability, provider detection.',
    details: `
      Runs eight read-only checks and reports one glyph row per check.
      Exit 0 when all green, 1 when any check warns, 2 when an
      error-level problem exists (DB corruption, jobs whose rendered
      content row is missing). --json emits
      { ok, kind: 'doctor', checks[] } with one entry per check.
    `,
  });

  /** Runner probe seam; tests override to avoid spawning a real binary. */
  probeRunner: () => IClaudeCliProbe = () => probeClaudeCli();

  protected async run(): Promise<number> {
    const ctx = defaultRuntimeContext();
    const dbPath = resolveDbPath({ db: this.db, ...ctx });
    const dbExit = requireDbOrExit(dbPath, this.context.stderr);
    if (dbExit !== null) return dbExit;

    return withSqlite(
      {
        databasePath: dbPath,
        autoBackup: false,
        // Read verb: advise on drift, never refuse.
        versionCheck: buildReadVersionCheck(this.printer!, this.ansiFor('stderr')),
      },
      async (adapter) => {
        const checks = await this.runChecks(adapter, ctx.cwd);
        return this.render(checks);
      },
    );
  }

  /** Execute the eight checks in contract order. */
  private async runChecks(adapter: StoragePort, cwd: string): Promise<ICheckRow[]> {
    const runtime = await loadPluginRuntime();
    runtime.emitWarnings(this.printer!);
    const composed = composeScanExtensions({
      noBuiltIns: false,
      pluginRuntime: runtime,
      killSwitches: readConformanceKillSwitches(),
    });
    return [
      checkDbIntegrity(adapter),
      checkMigrations(adapter),
      await checkOrphanHistory(adapter),
      ...(await checkJobs(adapter)),
      checkPlugins(runtime.discovered.map((p) => ({ id: p.id, status: p.status }))),
      checkRunner(this.probeRunner()),
      ...(await checkProviders(adapter, composed?.providers ?? [], cwd)),
    ];
  }

  /** Render (human or json) and map the worst status to the exit code. */
  private render(checks: ICheckRow[]): TExitCode {
    const errors = checks.filter((c) => c.status === 'error').length;
    const warnings = checks.filter((c) => c.status === 'warn').length;
    const exit = errors > 0 ? ExitCode.Error : warnings > 0 ? ExitCode.Issues : ExitCode.Ok;

    if (this.json) {
      this.printer!.data(
        JSON.stringify({ ok: exit === ExitCode.Ok, kind: 'doctor', checks }) + '\n',
      );
      return exit;
    }

    const ansi = this.ansiFor('stdout');
    const labelWidth = Math.max(...checks.map((c) => labelFor(c.id).length));
    for (const check of checks) {
      this.printer!.data(
        tx(T.checkRow, {
          glyph: glyphFor(ansi, check.status),
          label: ansi.dim(labelFor(check.id).padEnd(labelWidth)),
          message: check.message,
        }),
      );
    }
    this.printer!.data('\n');
    this.printer!.data(this.summaryLine(ansi, errors, warnings));
    return exit;
  }

  private summaryLine(ansi: IAnsi, errors: number, warnings: number): string {
    if (errors > 0) {
      return tx(T.summaryError, {
        glyph: ansi.red('✕'),
        errors,
        errorNoun: errors === 1 ? T.errorNounSingular : T.errorNounPlural,
        warnings,
        warnNoun: warnings === 1 ? T.warningNounSingular : T.warningNounPlural,
      });
    }
    if (warnings > 0) {
      return tx(T.summaryWarn, {
        glyph: ansi.yellow('⚠'),
        warnings,
        noun: warnings === 1 ? T.warningNounSingular : T.warningNounPlural,
      });
    }
    return tx(T.summaryOk, { glyph: ansi.green('✓') });
  }
}

// ---------------------------------------------------------------------------
// Checks (pure builders; each returns its ICheckRow)
// ---------------------------------------------------------------------------

function glyphFor(ansi: IAnsi, status: TCheckStatus): string {
  if (status === 'error') return ansi.red('✕');
  if (status === 'warn') return ansi.yellow('⚠');
  return ansi.green('✓');
}

function labelFor(id: string): string {
  const labels: Record<string, string> = {
    'db-integrity': T.labelDb,
    migrations: T.labelMigrations,
    'orphan-history': T.labelHistory,
    'job-contents': T.labelJobContents,
    'job-gc': T.labelJobGc,
    plugins: T.labelPlugins,
    runner: T.labelRunner,
    providers: T.labelProviders,
  };
  return labels[id] ?? id;
}

function checkDbIntegrity(adapter: StoragePort): ICheckRow {
  const result = adapter.migrations.quickCheck();
  if (result.ok) return { id: 'db-integrity', status: 'ok', message: T.dbOk };
  return {
    id: 'db-integrity',
    status: 'error',
    message: tx(T.dbCorrupt, { detail: sanitizeForTerminal(result.detail ?? '') }),
  };
}

function checkMigrations(adapter: StoragePort): ICheckRow {
  const plan = adapter.migrations.plan();
  if (plan.pending.length === 0) {
    return {
      id: 'migrations',
      status: 'ok',
      message: tx(T.migrationsOk, { version: adapter.migrations.currentSchemaVersion() ?? 0 }),
    };
  }
  return {
    id: 'migrations',
    status: 'warn',
    message: tx(T.migrationsPending, {
      count: plan.pending.length,
      names: plan.pending.map((m) => m.description).join(', '),
    }),
  };
}

async function checkOrphanHistory(adapter: StoragePort): Promise<ICheckRow> {
  const orphans = await adapter.issues.findActive((i) => i.analyzerId === 'orphan');
  if (orphans.length === 0) {
    return { id: 'orphan-history', status: 'ok', message: T.historyOk };
  }
  return {
    id: 'orphan-history',
    status: 'warn',
    message: tx(T.historyOrphans, {
      count: orphans.length,
      noun: orphans.length === 1 ? T.historyNounSingular : T.historyNounPlural,
    }),
  };
}

async function checkJobs(adapter: StoragePort): Promise<ICheckRow[]> {
  const counts = await adapter.jobs.integrityCounts();
  const contents: ICheckRow =
    counts.missingContent === 0
      ? { id: 'job-contents', status: 'ok', message: T.jobContentsOk }
      : {
          id: 'job-contents',
          status: 'error',
          message: tx(T.jobContentsMissing, {
            count: counts.missingContent,
            noun: counts.missingContent === 1 ? T.jobNounSingular : T.jobNounPlural,
          }),
        };
  const gc: ICheckRow =
    counts.contentStragglers === 0
      ? { id: 'job-gc', status: 'ok', message: T.jobGcOk }
      : {
          id: 'job-gc',
          status: 'warn',
          message: tx(T.jobGcStragglers, {
            count: counts.contentStragglers,
            noun: counts.contentStragglers === 1 ? T.contentNounSingular : T.contentNounPlural,
          }),
        };
  return [contents, gc];
}

/** Any discovery status besides the two healthy ones is "error state". */
function checkPlugins(discovered: ReadonlyArray<{ id: string; status: string }>): ICheckRow {
  const errored = discovered.filter((p) => p.status !== 'enabled' && p.status !== 'disabled');
  if (errored.length === 0) return { id: 'plugins', status: 'ok', message: T.pluginsOk };
  return {
    id: 'plugins',
    status: 'warn',
    message: tx(T.pluginsErrored, {
      list: errored
        .map((p) => sanitizeForTerminal(`${p.id} (${p.status})`))
        .join(', '),
    }),
  };
}

function checkRunner(probe: IClaudeCliProbe): ICheckRow {
  if (probe.available) {
    return {
      id: 'runner',
      status: 'ok',
      message: probe.version
        ? tx(T.runnerOk, { version: sanitizeForTerminal(probe.version) })
        : T.runnerOkNoVersion,
    };
  }
  return { id: 'runner', status: 'warn', message: T.runnerMissing };
}

/**
 * One warn row per Provider whose `detect.markers` exist on disk while
 * `scan_nodes` carries zero rows for its id. A DB with no scanned nodes
 * at all skips the check (nothing has matched anything yet).
 */
async function checkProviders(
  adapter: StoragePort,
  providers: readonly IProvider[],
  cwd: string,
): Promise<ICheckRow[]> {
  const present = new Set(await adapter.scans.distinctNodeProviders());
  if (present.size === 0) {
    return [{ id: 'providers', status: 'ok', message: T.providersNoScan }];
  }
  const rows: ICheckRow[] = [];
  for (const provider of providers) {
    const markers = provider.detect?.markers ?? [];
    if (present.has(provider.id)) continue;
    const found = markers.find((m) => existsSync(join(cwd, m)));
    if (found === undefined) continue;
    rows.push({
      id: 'providers',
      status: 'warn',
      message: tx(T.providersEmpty, {
        id: sanitizeForTerminal(provider.id),
        marker: sanitizeForTerminal(found),
      }),
    });
  }
  if (rows.length === 0) {
    return [{ id: 'providers', status: 'ok', message: T.providersOk }];
  }
  return rows;
}
