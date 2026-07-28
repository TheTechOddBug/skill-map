/**
 * `sm doctor`, the project diagnostic report (`spec/cli-contract.md`
 * §sm doctor). Eight read-only checks over the project DB and the
 * plugin runtime:
 *
 *   1. DB file integrity (`PRAGMA quick_check` via
 *      `port.migrations.quickCheck`).
 *   2. Pending kernel migrations (`port.migrations.plan`).
 *   3. Orphan history rows (active `orphan` issues, same source
 *      `sm orphans` lists).
 *   4. `state_jobs` rows whose content row is missing (corruption).
 *   5. `state_job_contents` GC stragglers (`sm jobs prune` collects).
 *   6. Running jobs past their extension's ADVISORY
 *      `probExpectedDurationSeconds` (the operator escape hatch for
 *      TTL-less zombies, Decision #139; never mutates state).
 *   7. Plugins in error state (any status besides enabled / disabled).
 *   8. Detected Providers that matched nothing (marker on disk, zero
 *      scanned nodes; non-blocking warning).
 *
 * Exit: 0 all green, 1 warnings, 2 any error-level problem. Checks 1
 * and 4 are the error-level ones (real corruption); everything else
 * warns with the actionable verb in the message.
 */

import { loadTrust } from '../../kernel/config/plugin-trust-store.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { Command } from 'clipanion';

import type { IAction, IAnalyzer, IProvider } from '../../kernel/extensions/index.js';
import type { Job } from '../../kernel/types.js';
import type { StoragePort } from '../../kernel/ports/storage.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tx } from '../../kernel/util/tx.js';
import { DOCTOR_TEXTS as T } from '../i18n/doctor.texts.js';
import type { IAnsi } from '../util/ansi.js';
import { buildReadVersionCheck } from '../util/db-version-check.js';
import { requireDbOrExit, resolveDbPath } from '../util/db-path.js';
import { ExitCode, type TExitCode } from '../util/exit-codes.js';
import { readConformanceKillSwitches } from '../util/conformance-env.js';
import { composeScanExtensions, loadPluginRuntime } from '../../core/runtime/plugin-runtime.js';
import { defaultRuntimeContext } from '../../core/runtime/runtime-context.js';
import { SmCommand } from '../util/sm-command.js';
import { withSqlite } from '../../core/sqlite/with-sqlite.js';

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
      'Diagnostic report: DB integrity, pending migrations, orphan rows, job-content consistency, plugin status, provider detection.',
    details: `
      Runs eight read-only checks and reports one glyph row per check.
      Exit 0 when all green, 1 when any check warns, 2 when an
      error-level problem exists (DB corruption, jobs whose rendered
      content row is missing). --json emits
      { ok, kind: 'doctor', checks[] } with one entry per check.
    `,
  });

  protected async run(): Promise<number> {
    const ctx = defaultRuntimeContext();
    const dbPath = resolveDbPath({ db: this.db, ...ctx });
    const dbExit = requireDbOrExit(dbPath, this.context.stderr, this.noColor);
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
      ...(await checkJobsOverdue(
        adapter,
        composed?.actions ?? [],
        composed?.analyzers ?? [],
        Date.now(),
      )),
      checkPlugins(runtime.discovered.map((p) => ({ id: p.id, status: p.status }))),
      checkTrustScope(cwd),
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
    'jobs-overdue': T.labelJobsOverdue,
    plugins: T.labelPlugins,
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

/**
 * `jobs-overdue` (`spec/cli-contract.md` §sm doctor): one warn per
 * `running` job whose elapsed time exceeds its extension's ADVISORY
 * `probExpectedDurationSeconds`, the operator escape hatch for TTL-less
 * zombies (Decision #139: jobs never expire by default). The extension
 * resolves from the loaded registry by the job row's frozen
 * `(extensionId, extensionKind)`; jobs whose extension is no longer
 * loadable are skipped. Purely advisory, never mutates state.
 */
async function checkJobsOverdue(
  adapter: StoragePort,
  actions: readonly IAction[],
  analyzers: readonly IAnalyzer[],
  nowMs: number,
): Promise<ICheckRow[]> {
  const running = await adapter.jobs.list({ status: 'running' });
  const rows: ICheckRow[] = [];
  for (const job of running) {
    const estimate = advisoryEstimateFor(job, actions, analyzers);
    if (estimate === undefined) continue; // extension not loadable: skip
    if (job.claimedAt === null || job.claimedAt === undefined) continue;
    const elapsedMs = nowMs - job.claimedAt;
    if (elapsedMs <= estimate * 1000) continue;
    rows.push({
      id: 'jobs-overdue',
      status: 'warn',
      message: tx(T.jobsOverdueWarn, {
        id: sanitizeForTerminal(job.id),
        elapsedSeconds: Math.round(elapsedMs / 1000),
        estimateSeconds: estimate,
      }),
    });
  }
  if (rows.length === 0) {
    return [{ id: 'jobs-overdue', status: 'ok', message: T.jobsOverdueOk }];
  }
  return rows;
}

/**
 * Resolve the job's extension from the composed registry by its frozen
 * kind (qualified id first, then bare suffix, the queue-wide matching
 * rule) and return its advisory `probExpectedDurationSeconds`.
 * `undefined` = the extension is no longer loadable (or carries no
 * estimate), which skips the check for that job.
 */
function advisoryEstimateFor(
  job: Job,
  actions: readonly IAction[],
  analyzers: readonly IAnalyzer[],
): number | undefined {
  const catalog: ReadonlyArray<IAction | IAnalyzer> =
    job.extensionKind === 'action' ? actions : analyzers;
  const match =
    catalog.find((e) => `${e.pluginId}/${e.id}` === job.extensionId) ??
    catalog.find((e) => e.id === job.extensionId);
  return match?.probExpectedDurationSeconds;
}

/**
 * Report scope-lock grants that exist but are not honoured.
 *
 * The diagnostic home for the two situations the runtime keeps quiet
 * about after its one-line advisory, plus the one it never mentions at
 * all (an unusable anchor with nothing recorded yet). The verdicts stay
 * separate because the remedies differ: a foreign grant is re-granted
 * per plugin, while a filesystem with no creation time cannot anchor one
 * at all and re-granting there is futile.
 *
 * Deliberately does NOT print the anchor or any grant value: a disclosed
 * grant is replayable against that checkout.
 */
function checkTrustScope(cwd: string): ICheckRow {
  const { skipped, anchor } = loadTrust(cwd);
  if (anchor.kind !== 'value') {
    return { id: 'trust-scope', status: 'warn', message: T.trustScopeAnchorUnusable };
  }
  if (skipped.length === 0) return { id: 'trust-scope', status: 'ok', message: T.trustScopeOk };
  return {
    id: 'trust-scope',
    status: 'warn',
    message: tx(T.trustScopeForeign, {
      list: skipped.map((s) => sanitizeForTerminal(s.pluginId)).join(', '),
    }),
  };
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
