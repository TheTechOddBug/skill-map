/**
 * `sm job run [--all] [--max <n>] [--json]`, the full CLI-runner drain
 * loop (Step 10 Phase E): reap -> claim -> run -> record.
 *
 * Loop semantics, per `spec/job-lifecycle.md`:
 *
 *   1. **Reap FIRST** (§Reap procedure): every `running` job whose
 *      `expiresAt` has passed flips to `failed` / `abandoned` before the
 *      first claim; the reaped count is reported.
 *   2. **Sequential drain** (§Concurrency: one job at a time through
 *      v1.0). Per iteration: atomic claim as runner `cli` (§Atomic claim)
 *      -> fetch the rendered content from `state_job_contents` -> resolve
 *      the action + report schema -> `runner.run(content, { timeoutMs })`
 *      -> record the outcome through the SHARED record machinery
 *      (`record-outcome.ts`), so validation, `report-invalid`, the
 *      execution row, the job transition, and the summary-schema ->
 *      `state_summaries` write-through behave exactly like `sm record`.
 *   3. Default drains ONE job; `--all` drains until the queue is empty;
 *      `--max <n>` drains at most n. `--all` and `--max` are mutually
 *      exclusive (exit 2).
 *
 * Per-job outcome mapping (§Record semantics):
 *   - valid report -> `completed` (+ summary write-through when the
 *     Action's report schema extends a `summaries/<kind>` schema).
 *   - schema-invalid / unparseable report -> `failed` / `report-invalid`.
 *   - non-zero subprocess exit OR timeout kill -> `failed` /
 *     `runner-error`, with the runner's output attempt stored as the
 *     failure detail in `report_json` when there is one.
 *   - missing `state_job_contents` row (DB-corruption-only) -> `failed` /
 *     `job-file-missing` (§Atomicity edge cases).
 *   - unresolvable action / report schema -> `failed` / `runner-error`
 *     with the detail as the failure text (the loop IS the runner and it
 *     cannot validate; leaving the claimed job to the reaper would just
 *     delay the same failure by one TTL).
 *   - job terminalised externally mid-run (cancelled / failed / reaped
 *     between the loop's claim and its record; the storage guard throws
 *     the typed `JobNotRunningError` and rolls the record back) -> the
 *     result is DISCARDED: a warn line reports it, the `--json` counts
 *     carry a `discarded` tally, the drain continues, and the operator's
 *     terminal state stands. A pure-discard drain still exits 0 (the
 *     terminalisation was a deliberate operator action, not a failure of
 *     the drain).
 *
 * The runner is the `RunnerPort` reference impl `ClaudeCliRunner`
 * (subprocess `claude -p`); tests inject a `MockRunner` through the
 * module-level `_setRunnerFactoryForTests` seam. A missing `claude` binary
 * (typed `ClaudeCliNotFoundError`) records the claimed job as `failed` /
 * `runner-error` (an unclaim primitive does not exist and a dangling
 * `running` row would only rot until reaped), aborts the drain, and exits
 * 2 with an install advisory, per the ROADMAP Phase E line.
 *
 * The per-run timeout derives from the claimed job's frozen `ttlSeconds`
 * (capped at 24h as a guard against absurd TTLs): the subprocess is killed
 * at the TTL boundary because past it the job is reap-eligible anyway and
 * a late callback would be rejected.
 *
 * Exit codes: 0 full drain with every processed job completed (or queue
 * empty at start, reported with a note); 1 when at least one processed job
 * ended `failed` (the `Issues` bucket: the verb succeeded, the results
 * carry errors); 2 usage errors / missing claude binary; 5 missing DB.
 *
 * Event-stream emission (`spec/job-events.md`) is Phase G; today the loop
 * prints simple per-job progress lines on stderr and a final summary
 * (single `--json` envelope on stdout, not ndjson yet).
 */

import { Command, Option } from 'clipanion';

import type { ExecutionFailureReason, ExecutionRecord, Job } from '../../kernel/types.js';
import type { IRunResult, RunnerPort } from '../../kernel/ports/runner.js';
import type { StoragePort } from '../../kernel/ports/storage.js';
import {
  ClaudeCliNotFoundError,
  ClaudeCliRunner,
} from '../../kernel/adapters/runner/index.js';
import { JobNotRunningError } from '../../kernel/jobs/index.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { tx } from '../../kernel/util/tx.js';
import { requireDbOrExit, resolveDbPath } from '../util/db-path.js';
import { ExitCode, type TExitCode } from '../util/exit-codes.js';
import { JOB_RUN_TEXTS as T } from '../i18n/job-run.texts.js';
import { defaultRuntimeContext } from '../util/runtime-context.js';
import { SmCommand } from '../util/sm-command.js';
import { withSqlite } from '../util/with-sqlite.js';
import { loadActionRuntime, type IActionRuntime } from './action-runtime.js';
import {
  recordCompletedOutcome,
  recordFailedOutcome,
  resolveActionRecord,
  type IRecordMetrics,
} from './record-outcome.js';

/**
 * Ceiling on the per-run subprocess timeout (24 h). `ttlSeconds` is
 * already floored at submit time (`jobs.minimumTtlSeconds`); this guards
 * the other direction so a misconfigured multi-day TTL cannot pin the
 * drain loop on one job.
 */
const TIMEOUT_CAP_MS = 86_400_000;

/** One processed job's terminal outcome (the `--json` `processed` rows). */
export interface IJobRunOutcome {
  jobId: string;
  executionId: string;
  status: 'completed' | 'failed';
  failureReason: ExecutionFailureReason | null;
}

/** Internal per-job result; `abort` carries the fatal advisory when set. */
interface IRunOneResult {
  outcome: IJobRunOutcome;
  abort?: string;
}

/**
 * Test seam: override how the loop obtains its `RunnerPort`. Production
 * always spawns `ClaudeCliRunner`; tests inject `MockRunner`. Pass `null`
 * to restore the default. Follows the module-level `_*ForTests` convention
 * (`_resetExampleCacheForTests` et al.).
 */
let runnerFactoryOverride: (() => RunnerPort) | null = null;

export function _setRunnerFactoryForTests(factory: (() => RunnerPort) | null): void {
  runnerFactoryOverride = factory;
}

export class JobRunCommand extends SmCommand {
  static override paths = [['job', 'run']];
  static override usage = Command.Usage({
    category: 'Jobs',
    description: 'Full CLI-runner loop: reap expired jobs, then claim, run, and record.',
    details: `
      Drains the job queue as runner cli. Expired running jobs are reaped
      first (failed / abandoned), then the loop sequentially claims the
      next queued job (highest priority, oldest first), executes its
      rendered content through the claude -p runner, and records the
      outcome exactly like sm record would: a schema-valid report completes
      the job (writing the summary for summarizer actions), an invalid
      report fails it as report-invalid, a non-zero or timed-out subprocess
      fails it as runner-error.

      Default runs ONE job. --all drains until the queue is empty; --max N
      drains at most N (the two are mutually exclusive). An empty queue is
      a no-op success. Progress prints per job on stderr; --json emits a
      single summary envelope on stdout.

      Exit codes: 0 when every processed job completed (or the queue was
      empty), 1 when at least one processed job failed, 2 on usage errors
      or when the claude binary is not installed, 5 when the DB is missing.
    `,
    examples: [
      ['Run the next queued job', '$0 job run'],
      ['Drain the whole queue', '$0 job run --all'],
      ['Drain at most three jobs', '$0 job run --max 3'],
    ],
  });

  all = Option.Boolean('--all', false);
  max = Option.String('--max', { required: false });

  protected async run(): Promise<number> {
    const ctx = defaultRuntimeContext();
    const dbPath = resolveDbPath({ db: this.db, ...ctx });
    const dbExit = requireDbOrExit(dbPath, this.context.stderr);
    if (dbExit !== null) return dbExit;

    if (this.all && this.max !== undefined) return this.fail(T.errTargetConflict);
    let limit = 1;
    if (this.all) {
      limit = Number.POSITIVE_INFINITY;
    } else if (this.max !== undefined) {
      const trimmed = this.max.trim();
      if (!/^\d+$/.test(trimmed) || Number.parseInt(trimmed, 10) < 1) {
        return this.fail(tx(T.errBadMax, { value: this.max }));
      }
      limit = Number.parseInt(trimmed, 10);
    }

    // Load the composed action catalog once for the whole drain; every
    // claimed job resolves its report schema against this runtime.
    const runtime = await loadActionRuntime(this.printer!);

    return withSqlite({ databasePath: dbPath, autoBackup: false }, (adapter) =>
      this.drain(adapter, runtime, limit),
    );
  }

  // --- drain loop ----------------------------------------------------------

  private async drain(
    adapter: StoragePort,
    runtime: IActionRuntime,
    limit: number,
  ): Promise<TExitCode> {
    // Reap FIRST, before the first claim (spec §Reap procedure).
    const reaped = await adapter.jobs.reapExpired(Date.now());
    if (reaped > 0) {
      this.printer!.info(tx(T.reapedLine, { glyph: this.warnGlyph(), count: reaped }));
    }

    const runner = (runnerFactoryOverride ?? defaultRunnerFactory)();
    const outcomes: IJobRunOutcome[] = [];
    let discarded = 0;
    let abort: string | null = null;

    while (outcomes.length < limit) {
      const claim = await adapter.jobs.claim('cli', Date.now());
      if (!claim) break; // queue empty (sequential drain, spec §Concurrency)
      const job = await adapter.jobs.get(claim.id);
      // Defensive: the claim just flipped this row to running.
      if (!job) break;
      this.printer!.info(
        tx(T.jobStartLine, {
          glyph: this.runGlyph(),
          id: job.id,
          action: job.actionId,
          node: job.nodeId,
        }),
      );
      const result = await this.runOneGuarded(adapter, runtime, runner, job);
      if (result === null) {
        discarded += 1;
        continue;
      }
      outcomes.push(result.outcome);
      this.reportJobLine(result.outcome);
      if (result.abort !== undefined) {
        abort = result.abort;
        break;
      }
    }

    return this.reportDrain(outcomes, reaped, discarded, abort);
  }

  /**
   * `runOne` wrapped in the lost-record-race guard: when the job was
   * cancelled / failed / reaped out from under the loop mid-run, the
   * storage guard throws the typed `JobNotRunningError` and rolls the
   * record back (no execution row). Report the discarded result (`null`)
   * and let the drain continue, the terminal state the operator set
   * stands. Anything else rethrows untouched.
   */
  private async runOneGuarded(
    adapter: StoragePort,
    runtime: IActionRuntime,
    runner: RunnerPort,
    job: Job,
  ): Promise<IRunOneResult | null> {
    try {
      return await this.runOne(adapter, runtime, runner, job);
    } catch (err) {
      if (!(err instanceof JobNotRunningError)) throw err;
      this.printer!.info(tx(T.jobDiscardedLine, { glyph: this.warnGlyph(), id: job.id }));
      return null;
    }
  }

  /**
   * Execute one claimed job end to end and record its terminal outcome.
   * Never throws for per-job failures (the drain continues); a missing
   * claude binary additionally sets `abort` (systemic: no later job can
   * run either).
   */
  private async runOne(
    adapter: StoragePort,
    runtime: IActionRuntime,
    runner: RunnerPort,
    job: Job,
  ): Promise<IRunOneResult> {
    const content = await adapter.jobs.getContent(job.contentHash);
    if (content === null) {
      // DB-corruption-only state (spec §Atomicity edge cases): the content
      // row vanished under a live job row.
      const execution = await recordFailedOutcome({
        adapter,
        job,
        failureReason: 'job-file-missing',
        errorText: T.detailContentMissing,
        metrics: {},
        now: Date.now(),
      });
      return { outcome: toOutcome(execution) };
    }

    // Resolve the schema BEFORE spawning: an unresolvable action fails the
    // job without spending a single token.
    const resolution = resolveActionRecord(runtime, job.actionId);
    if (!resolution.ok) {
      const execution = await recordFailedOutcome({
        adapter,
        job,
        failureReason: 'runner-error',
        errorText: resolution.detail,
        metrics: {},
        now: Date.now(),
      });
      return { outcome: toOutcome(execution) };
    }

    const timeoutMs = Math.min(job.ttlSeconds * 1000, TIMEOUT_CAP_MS);
    let result: IRunResult;
    try {
      result = await runner.run(content, { timeoutMs });
    } catch (err) {
      const execution = await recordFailedOutcome({
        adapter,
        job,
        failureReason: 'runner-error',
        errorText: formatErrorMessage(err),
        metrics: {},
        now: Date.now(),
      });
      return err instanceof ClaudeCliNotFoundError
        ? { outcome: toOutcome(execution), abort: err.message }
        : { outcome: toOutcome(execution) };
    }

    const metrics: IRecordMetrics = {
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      durationMs: result.durationMs,
      exitCode: result.exitCode,
    };
    if (result.exitCode !== 0) {
      // Subprocess failure (includes the timeout kill): failed /
      // runner-error, with the output attempt as the detail when present.
      const attempt = result.reportJson.trim();
      const execution = await recordFailedOutcome({
        adapter,
        job,
        failureReason: 'runner-error',
        errorText: attempt === '' ? null : attempt,
        metrics,
        now: Date.now(),
      });
      return { outcome: toOutcome(execution) };
    }

    const outcome = await recordCompletedOutcome({
      adapter,
      job,
      reportText: result.reportJson,
      resolve: async () => resolution,
      metrics,
      now: Date.now(),
    });
    if (outcome.kind === 'schema-unresolved') {
      // Unreachable (resolution.ok gated above); recorded defensively so a
      // future refactor cannot strand a claimed job in running.
      const execution = await recordFailedOutcome({
        adapter,
        job,
        failureReason: 'runner-error',
        errorText: outcome.detail,
        metrics,
        now: Date.now(),
      });
      return { outcome: toOutcome(execution) };
    }
    return { outcome: toOutcome(outcome.execution) };
  }

  // --- output --------------------------------------------------------------

  private reportJobLine(outcome: IJobRunOutcome): void {
    if (outcome.status === 'completed') {
      this.printer!.info(
        tx(T.jobCompletedLine, {
          glyph: this.okGlyph(),
          id: outcome.jobId,
          execId: outcome.executionId,
        }),
      );
    } else {
      this.printer!.info(
        tx(T.jobFailedLine, {
          glyph: this.warnGlyph(),
          id: outcome.jobId,
          reason: outcome.failureReason ?? '',
        }),
      );
    }
  }

  private reportDrain(
    outcomes: readonly IJobRunOutcome[],
    reaped: number,
    discarded: number,
    abort: string | null,
  ): TExitCode {
    const completed = outcomes.filter((o) => o.status === 'completed').length;
    const failed = outcomes.length - completed;

    if (this.json) {
      this.printer!.data(
        JSON.stringify({
          reaped,
          processed: outcomes,
          counts: { processed: outcomes.length, completed, failed, discarded },
        }) + '\n',
      );
    } else if (outcomes.length === 0 && discarded === 0) {
      this.printer!.info(tx(T.queueEmpty, { glyph: this.warnGlyph() }));
    } else if (outcomes.length > 0) {
      this.printer!.info(
        tx(T.summaryLine, {
          glyph: failed > 0 ? this.warnGlyph() : this.okGlyph(),
          count: outcomes.length,
          completed,
          failed,
        }),
      );
    }

    if (abort !== null) {
      this.printer!.error(
        tx(T.errPrefix, {
          glyph: this.errGlyph(),
          message: tx(T.errClaudeNotFound, { detail: abort }),
        }),
      );
      return ExitCode.Error;
    }
    return failed > 0 ? ExitCode.Issues : ExitCode.Ok;
  }

  // --- small glyph / error helpers ----------------------------------------

  private fail(message: string): TExitCode {
    this.printer!.error(tx(T.errPrefix, { glyph: this.errGlyph(), message }));
    return ExitCode.Error;
  }

  private errGlyph(): string {
    return this.ansiFor('stderr').red('✕');
  }

  private warnGlyph(): string {
    return this.ansiFor('stderr').yellow('•');
  }

  private okGlyph(): string {
    return this.ansiFor('stderr').green('✓');
  }

  private runGlyph(): string {
    return this.ansiFor('stderr').cyan('→');
  }
}

function defaultRunnerFactory(): RunnerPort {
  return new ClaudeCliRunner();
}

/** Project an execution row into the outcome shape the loop reports. */
function toOutcome(execution: ExecutionRecord): IJobRunOutcome {
  return {
    jobId: execution.jobId ?? '',
    executionId: execution.id,
    status: execution.status === 'completed' ? 'completed' : 'failed',
    failureReason: execution.failureReason ?? null,
  };
}
