/**
 * `sm record`, the nonce-authenticated job callback (Step 10 Phase D). A
 * runner that claimed a job (`sm job claim`) closes it here: `sm record`
 * verifies the nonce, validates the model's JSON report against the
 * action's report schema, writes the terminal `state_executions` row, and
 * transitions the job to `completed` / `failed`, atomically.
 *
 * `sm record --id <id> --nonce <n> --status completed|failed [--report
 * <path|->] [--tokens-in N] [--tokens-out N] [--duration-ms N] [--model
 * <s>] [--error <s>] [--json]`. Per `spec/job-lifecycle.md` §Record:
 *
 *   1. Resolve the DB (missing -> exit 5). Load the job by `--id`; not
 *      found -> exit 5.
 *   2. Compare `--nonce` to `state_jobs.nonce`; mismatch -> exit 4, NO
 *      mutation. The nonce is the sole credential.
 *   3. `state_jobs.status != 'running'` -> exit 2 ("job not in running
 *      state"), which catches a late callback after a reap / cancel.
 *   4. `--status completed`: read the report (`--report <path>` or `-` for
 *      stdin), parse JSON, and validate it against the action's report
 *      schema (the built-in's inlined `reportSchema`, or the plugin's
 *      on-disk `report.schema.json`). On validation failure -> transition
 *      to `failed` / `report-invalid` (never left `running`) and exit 2.
 *      On success -> `completed`, report stored inline in
 *      `state_executions.report_json`, exit 0.
 *   5. `--status failed`: transition to `failed` / `runner-error` (the
 *      callback-reported failure reason; `user-failed` belongs to the
 *      operator verb `sm job fail`). Exit 0.
 *
 * The record core (parse + validate + execution row + job transition +
 * summary write-through for summary-schema Actions) lives in the SHARED
 * `record-outcome.ts` module, consumed identically by this verb and the
 * `sm job run` drain loop (Step 10 Phase E); this file owns only the
 * CLI-flag surface, the nonce/state gates, and the exit-code mapping.
 *
 * Exit codes (`spec/cli-contract.md` §Record): 0 success, 4 nonce
 * mismatch, 5 missing job / DB, 2 otherwise (bad flags, not-running,
 * unreadable report, report-invalid).
 *
 * Schema constraints called out: `state_executions` (and
 * `execution-record.schema.json`, `additionalProperties: false`) carry no
 * free-text `error` or `model` column. `--error` is stored verbatim in
 * `report_json` on the failed path (the only nullable text slot, empty of a
 * report for a failed execution) per `spec/cli-contract.md` §Record;
 * `--model` is accepted for CLI-surface stability but not persisted (no
 * field to hold it, and adding one is a spec change outside this phase).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Command, Option } from 'clipanion';

import type { ExecutionRecord, Job } from '../../kernel/types.js';
import type { StoragePort } from '../../kernel/ports/storage.js';
import { JobNotRunningError } from '../../kernel/jobs/index.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { tx } from '../../kernel/util/tx.js';
import { requireDbOrExit, resolveDbPath } from '../util/db-path.js';
import { ExitCode, type TExitCode } from '../util/exit-codes.js';
import { RECORD_TEXTS as T } from '../i18n/record.texts.js';
import { defaultRuntimeContext } from '../util/runtime-context.js';
import { SmCommand } from '../util/sm-command.js';
import { withSqlite } from '../util/with-sqlite.js';
import { loadActionRuntime } from './action-runtime.js';
import {
  recordCompletedOutcome,
  recordFailedOutcome,
  resolveActionRecord,
  type IRecordMetrics,
} from './record-outcome.js';

/** Numeric metric flags, already parsed / validated (absent -> undefined). */
interface IMetrics {
  tokensIn: number | undefined;
  tokensOut: number | undefined;
  durationMs: number | undefined;
}

/**
 * Parse a non-negative integer flag (`--tokens-in` / `--tokens-out` /
 * `--duration-ms`; all `minimum: 0` in `execution-record.schema.json`).
 * Absent -> `undefined`; a non-digit or negative value throws with the
 * catalog message the caller surfaces as exit 2.
 */
function parseNonNegIntFlag(flag: string, raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(tx(T.errBadNumber, { flag, value: raw }));
  }
  return Number.parseInt(trimmed, 10);
}

export class RecordCommand extends SmCommand {
  static override paths = [['record']];
  static override usage = Command.Usage({
    category: 'Jobs',
    description: 'Close a running job with success or failure. Nonce is the sole credential.',
    details: `
      The job callback. A runner that claimed a job (sm job claim) closes it
      here. sm record verifies --nonce against the job, validates the
      --status completed report against the action's report schema, writes
      the state_executions row (report inline in report_json), and
      transitions the job to completed / failed, atomically.

      --report accepts a file path or - (stdin) and is required for --status
      completed. On a report that fails schema validation the job is moved
      to failed / report-invalid (never left running). --status failed
      records a runner-reported failure (reason runner-error); --error is
      stored verbatim.

      Exit codes: 0 on success, 4 on nonce mismatch, 5 when the job (or DB)
      is missing, 2 otherwise (bad flags, job not running, unreadable
      report, report-invalid).
    `,
    examples: [
      [
        'Close a job with a validated report',
        '$0 record --id d-20260101-000000-0001 --nonce <n> --status completed --report ./report.json',
      ],
      [
        'Close a job as failed',
        '$0 record --id d-20260101-000000-0001 --nonce <n> --status failed --error "model timed out"',
      ],
    ],
  });

  id = Option.String('--id', { required: true });
  nonce = Option.String('--nonce', { required: true });
  status = Option.String('--status', { required: true });
  report = Option.String('--report', { required: false });
  tokensIn = Option.String('--tokens-in', { required: false });
  tokensOut = Option.String('--tokens-out', { required: false });
  durationMs = Option.String('--duration-ms', { required: false });
  // Accepted for CLI-surface stability; NOT persisted (no model column in
  // state_executions / execution-record.schema.json). See the file header.
  model = Option.String('--model', { required: false });
  error = Option.String('--error', { required: false });

  protected async run(): Promise<number> {
    const ctx = defaultRuntimeContext();
    const dbPath = resolveDbPath({ db: this.db, ...ctx });
    const dbExit = requireDbOrExit(dbPath, this.context.stderr);
    if (dbExit !== null) return dbExit;

    const status = this.status;
    if (status !== 'completed' && status !== 'failed') {
      return this.fail(tx(T.errBadStatus, { status }), ExitCode.Error);
    }
    if (status === 'completed' && this.report === undefined) {
      return this.fail(T.errNeedReport, ExitCode.Error);
    }

    // Numeric metrics parse first so a bad value fails fast (exit 2) with no
    // DB open and no mutation.
    let metrics: IMetrics;
    try {
      metrics = {
        tokensIn: parseNonNegIntFlag('--tokens-in', this.tokensIn),
        tokensOut: parseNonNegIntFlag('--tokens-out', this.tokensOut),
        durationMs: parseNonNegIntFlag('--duration-ms', this.durationMs),
      };
    } catch (err) {
      return this.fail((err as Error).message, ExitCode.Error);
    }

    return withSqlite({ databasePath: dbPath, autoBackup: false }, (adapter) =>
      this.dispatch(adapter, status, metrics, ctx.cwd),
    );
  }

  /** Load + authenticate the job, then route to the success / failure path. */
  private async dispatch(
    adapter: StoragePort,
    status: 'completed' | 'failed',
    metrics: IMetrics,
    cwd: string,
  ): Promise<TExitCode> {
    const job = await adapter.jobs.get(this.id);
    if (!job) return this.fail(tx(T.errJobNotFound, { id: this.id }), ExitCode.NotFound);
    // Nonce is the sole credential: a mismatch never mutates.
    if (job.nonce !== this.nonce) {
      return this.fail(tx(T.errNonceMismatch, { id: this.id }), ExitCode.NonceMismatch);
    }
    // A late callback after a reap / cancel finds a terminal job; reject
    // without mutating (spec §Record step 3 / §Atomicity edge cases).
    if (job.status !== 'running') {
      return this.fail(tx(T.errNotRunning, { id: this.id, status: job.status }), ExitCode.Error);
    }
    const now = Date.now();
    try {
      return status === 'completed'
        ? await this.recordCompleted(adapter, job, metrics, now, cwd)
        : await this.recordFailed(adapter, job, metrics, now);
    } catch (err) {
      return this.failLostRecordRace(adapter, err);
    }
  }

  /**
   * Lost record race: the job left `running` between the pre-check in
   * `dispatch` and the record transaction (reaped / cancelled / recorded
   * elsewhere). The storage guard rolled everything back (no execution
   * row); map it to the same "job not in running state" exit 2 as the
   * pre-check. Anything else rethrows untouched.
   */
  private async failLostRecordRace(adapter: StoragePort, err: unknown): Promise<TExitCode> {
    if (!(err instanceof JobNotRunningError)) throw err;
    const fresh = await adapter.jobs.get(this.id);
    return this.fail(
      tx(T.errNotRunning, { id: this.id, status: fresh?.status ?? 'unknown' }),
      ExitCode.Error,
    );
  }

  // --- completed ----------------------------------------------------------

  private async recordCompleted(
    adapter: StoragePort,
    job: Job,
    metrics: IMetrics,
    now: number,
    cwd: string,
  ): Promise<TExitCode> {
    const reportText = this.readReport(cwd);
    if (typeof reportText === 'number') return reportText; // IO error -> exit 2, no mutation

    const outcome = await recordCompletedOutcome({
      adapter,
      job,
      reportText,
      // Lazy: the runtime loads only when the report parsed (preserving the
      // report-invalid-before-resolution ordering, see record-outcome.ts).
      resolve: async () =>
        resolveActionRecord(await loadActionRuntime(this.printer!), job.actionId),
      metrics: this.toRecordMetrics(metrics),
      now,
    });

    if (outcome.kind === 'schema-unresolved') {
      // Unresolvable action / schema -> exit 2, no mutation.
      return this.fail(
        tx(T.errReportSchemaUnresolved, { action: job.actionId, detail: outcome.detail }),
        ExitCode.Error,
      );
    }
    if (outcome.kind === 'report-invalid') {
      // The failed / report-invalid transition already landed (spec §Record
      // step 4); surface the reason and exit 2 (the "otherwise" bucket).
      this.printer!.error(
        tx(T.errPrefix, {
          glyph: this.errGlyph(),
          message: tx(T.reportInvalid, { errors: outcome.detail }),
        }),
      );
      if (this.json) this.emitJsonEnvelope(outcome.execution);
      return ExitCode.Error;
    }
    return this.reportSuccess(outcome.execution);
  }

  /**
   * Read the report payload from `--report` (a file path, or `-` for
   * stdin). Returns the raw text, or exit 2 when the source is unreadable
   * (the runner can retry; the reap safety net closes a stranded job).
   */
  private readReport(cwd: string): string | TExitCode {
    const source = this.report!;
    try {
      if (source === '-') return readFileSync(0, 'utf8'); // stdin (fd 0)
      return readFileSync(resolve(cwd, source), 'utf8');
    } catch (err) {
      return this.fail(
        tx(T.errReportRead, { source: source === '-' ? 'stdin' : source, detail: formatErrorMessage(err) }),
        ExitCode.Error,
      );
    }
  }

  // --- failed -------------------------------------------------------------

  private async recordFailed(
    adapter: StoragePort,
    job: Job,
    metrics: IMetrics,
    now: number,
  ): Promise<TExitCode> {
    // A callback-reported failure is `runner-error` (the runner hit an
    // error and reported it). `user-failed` is the operator verb
    // `sm job fail`, not this path. `--error` is stored verbatim in
    // report_json (spec/cli-contract.md §Record).
    const execution = await recordFailedOutcome({
      adapter,
      job,
      failureReason: 'runner-error',
      errorText: this.error ?? null,
      metrics: this.toRecordMetrics(metrics),
      now,
    });
    return this.reportSuccess(execution);
  }

  // --- output --------------------------------------------------------------

  /** Bridge the flag-parsed metrics into the shared record-metrics shape. */
  private toRecordMetrics(metrics: IMetrics): IRecordMetrics {
    return {
      tokensIn: metrics.tokensIn,
      tokensOut: metrics.tokensOut,
      durationMs: metrics.durationMs,
      // No --exit-code flag on this surface; the sm job run loop fills it.
    };
  }

  /** Emit the success outcome (exit 0): JSON envelope or a human line. */
  private reportSuccess(execution: ExecutionRecord): TExitCode {
    if (this.json) {
      this.emitJsonEnvelope(execution);
      return ExitCode.Ok;
    }
    if (execution.status === 'completed') {
      this.printer!.info(
        tx(T.completedLine, { glyph: this.okGlyph(), execId: execution.id, id: execution.jobId ?? '' }),
      );
    } else {
      this.printer!.info(
        tx(T.failedLine, {
          glyph: this.warnGlyph(),
          execId: execution.id,
          id: execution.jobId ?? '',
          reason: execution.failureReason ?? '',
        }),
      );
    }
    return ExitCode.Ok;
  }

  /**
   * Documented `--json` envelope: the new execution id, the closed job id,
   * its final terminal status, and the failure reason (null on completed).
   */
  private emitJsonEnvelope(execution: ExecutionRecord): void {
    this.printer!.data(
      JSON.stringify({
        executionId: execution.id,
        jobId: execution.jobId,
        status: execution.status,
        failureReason: execution.failureReason ?? null,
      }) + '\n',
    );
  }

  // --- small glyph / error helpers ---------------------------------------

  private fail(message: string, code: TExitCode): TExitCode {
    this.printer!.error(tx(T.errPrefix, { glyph: this.errGlyph(), message }));
    return code;
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
}
