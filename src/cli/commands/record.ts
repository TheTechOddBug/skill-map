/**
 * `sm record`, the nonce-authenticated job callback. An external agent
 * that claimed a job (`sm jobs claim`) closes it here: `sm record`
 * verifies the nonce, validates the agent's JSON report against the
 * extension's report schema (probabilistic Action or finder Analyzer,
 * the queue is kind-agnostic), writes the terminal `state_executions`
 * row, and transitions the job to `completed` / `failed`, atomically.
 * This is the ONLY execution path: skill-map never invokes an agent or
 * LLM itself (`spec/architecture.md` §Execution handover).
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
 *      operator verb `sm jobs fail`). Exit 0.
 *
 * The record core (parse + validate + execution row + job transition +
 * summary write-through for summary-schema Actions) lives in the SHARED
 * `record-outcome.ts` module (also consumed by the claim-side corruption
 * path in `job-queue.ts`); this file owns the CLI-flag surface, the
 * nonce/state gates, the exit-code mapping, and the `--json` synthetic
 * run envelope, the canonical job-event emission (`spec/job-events.md`):
 * `run.started(mode=external)` -> `job.claimed` replay ->
 * `job.callback.received` -> `job.completed` | `job.failed` ->
 * `run.summary`, one ndjson line each, no other JSON output.
 *
 * Exit codes (`spec/cli-contract.md` §Record): 0 success, 4 nonce
 * mismatch, 5 missing job / DB, 2 otherwise (bad flags, not-running,
 * unreadable report, report-invalid).
 *
 * Schema constraints called out: `state_executions` (and
 * `execution-record.schema.json`, `additionalProperties: false`) carry no
 * free-text `error` column. `--error` is stored verbatim in
 * `report_json` on the failed path (the only nullable text slot, empty of a
 * report for a failed execution) per `spec/cli-contract.md` §Record.
 * `--model` (the agent's self-declared model id, unverifiable like the
 * token counts) persists on `state_executions.model` and is denormalized
 * onto the `state_findings.model` / `state_summaries.model` rows the
 * same record writes; it also travels on the synthetic envelope
 * (`job.callback.received.data.model`).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Command, Option } from 'clipanion';

import type { ExecutionRecord, Job } from '../../kernel/types.js';
import type { IAction, IHookActionInfo } from '../../kernel/extensions/index.js';
import type { StoragePort } from '../../kernel/ports/storage.js';
import type { ProgressEmitterPort } from '../../kernel/ports/progress-emitter.js';
import { createNdjsonProgressEmitter } from '../../core/runtime/progress-emitter.js';
import { makeHookDispatcher } from '../../kernel/extensions/hook-dispatcher.js';
import { generateRunId, JobNotRunningError } from '../../kernel/jobs/index.js';
import { loadConfig } from '../../kernel/config/loader.js';
import { qualifiedExtensionId } from '../../kernel/registry.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { tx } from '../../kernel/util/tx.js';
import { requireDbOrExit, resolveDbPath } from '../util/db-path.js';
import { assertNoDriftForWrite } from '../../core/sqlite/db-version-runner.js';
import { ExitCode, type TExitCode } from '../util/exit-codes.js';
import { RECORD_TEXTS as T } from '../i18n/record.texts.js';
import { defaultRuntimeContext } from '../util/runtime-context.js';
import { SmCommand } from '../util/sm-command.js';
import { withSqlite } from '../util/with-sqlite.js';
import { loadActionRuntime, type IActionRuntime } from './action-runtime.js';
import { submitFixerJob } from './job-queue.js';
import {
  recordCompletedOutcome,
  recordFailedOutcome,
  resolveExtensionRecord,
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
      The job callback. An external agent that claimed a job (sm jobs claim)
      closes it here. sm record verifies --nonce against the job, validates
      the --status completed report against the action's report schema,
      writes the state_executions row (report inline in report_json), and
      transitions the job to completed / failed, atomically.

      --report accepts a file path or - (stdin) and is required for --status
      completed. On a report that fails schema validation the job is moved
      to failed / report-invalid (never left running). --status failed
      records an agent-reported failure (reason runner-error); --error is
      stored verbatim.

      --json streams the synthetic run envelope as ndjson on stdout, the
      canonical job-event emission (spec/job-events.md): run.started ->
      job.claimed replay -> job.callback.received -> job.completed |
      job.failed -> run.summary. There is no other JSON output; the
      envelope IS the machine-readable result (the new execution id rides
      on job.callback.received.data.executionId).

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
  // Persisted on `state_executions.model` + denormalized onto the
  // findings / summary rows of the same record; also surfaced on the
  // synthetic envelope (`job.callback.received.data.model`). See the
  // file header.
  model = Option.String('--model', { required: false });
  error = Option.String('--error', { required: false });

  protected async run(): Promise<number> {
    const ctx = defaultRuntimeContext();
    const dbPath = resolveDbPath({ db: this.db, ...ctx });
    const dbExit = requireDbOrExit(dbPath, this.context.stderr);
    if (dbExit !== null) return dbExit;
    // Write verb: refuse a drifted DB before the nonce lookup, the
    // plugin-runtime load, and the record transaction
    // (spec/cli-contract.md §Schema-drift rebuild).
    assertNoDriftForWrite(dbPath);

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

    // Load the composed runtime at most once, lazily: the `resolve` callback
    // triggers it only after the report parses (preserving the
    // report-invalid-before-resolution ordering), and the post-record hook
    // dispatch reuses the same instance instead of re-discovering plugins.
    let runtimeMemo: IActionRuntime | undefined;
    const getRuntime = async (): Promise<IActionRuntime> =>
      (runtimeMemo ??= await loadActionRuntime(this.printer!));

    const outcome = await recordCompletedOutcome({
      adapter,
      job,
      reportText,
      // Kind-strict: the job row carries the extension kind FROZEN at
      // submit (spec/db-schema.md §state_jobs), so resolution routes on
      // it instead of re-resolving the id across the registries.
      resolve: async () =>
        resolveExtensionRecord(await getRuntime(), job.extensionId, job.extensionKind),
      metrics: this.toRecordMetrics(metrics),
      now,
      // Threaded so the finder lane can read the node's LIVE `.sm`
      // sidecar suppressions and drop dismissed findings (spec §state_findings).
      cwd,
    });

    if (outcome.kind === 'schema-unresolved') {
      // Unresolvable extension / schema -> exit 2, no mutation.
      return this.fail(
        tx(T.errReportSchemaUnresolved, { extension: job.extensionId, detail: outcome.detail }),
        ExitCode.Error,
      );
    }
    if (outcome.kind === 'report-invalid') {
      // The failed / report-invalid transition already landed (spec §Record
      // step 4); surface the reason and exit 2 (the "otherwise" bucket).
      // The synthetic envelope is emitted on the exit-0 paths only.
      this.printer!.error(
        tx(T.errPrefix, {
          glyph: this.errGlyph(),
          message: tx(T.reportInvalid, { errors: outcome.detail }),
        }),
      );
      return ExitCode.Error;
    }
    // The record committed. Now dispatch job.completed to enabled hooks:
    // the opt-in `core/auto-fix` hook chains a finder to its matching
    // fixer(s). Best-effort and AFTER the transaction, so it never alters
    // the record's success (spec §Hook: hooks react, never block).
    await this.dispatchJobCompletedHooks(adapter, job, cwd, getRuntime);
    return this.reportSuccess(outcome.execution, job);
  }

  /**
   * Dispatch `job.completed` to the composed (enabled) hooks and drain any
   * fixer jobs they queued, all while the record's DB handle is still open.
   * The opt-in `core/auto-fix` hook is the concrete consumer: on a finder's
   * completion it resolves the inverse of Modelo B and `ctx.queue`s each
   * matching fixer for the node (`spec/architecture.md` §Modelo B ·
   * Auto-fix). Entirely best-effort, wrapped so ANY failure here (plugin
   * load, config read, a fixer submit) leaves the recorded job completed and
   * never changes the exit code, hooks react, they do not steer the pipeline.
   */
  private async dispatchJobCompletedHooks(
    adapter: StoragePort,
    job: Job,
    cwd: string,
    getRuntime: () => Promise<IActionRuntime>,
  ): Promise<void> {
    try {
      const runtime = await getRuntime();
      // Nothing subscribes to job.completed -> nothing to do (the default:
      // core/auto-fix ships disabled, and core/update-check is a boot hook).
      if (!runtime.hooks.some((hook) => hook.triggers.includes('job.completed'))) return;

      const bundle = await adapter.scans.findNode(job.nodeId);
      const queued: Array<{ actionId: string; nodeId: string }> = [];
      const dispatcher = makeHookDispatcher(runtime.hooks, silentEmitter(), {
        // The hook's ctx.queue records the request synchronously; the actual
        // submit is drained below while `adapter` is still open (a hook is
        // fire-and-forget void, so the driver owns the async lifecycle).
        queue: (actionId, payload) => {
          const nodeId = (payload as { nodeId?: unknown } | undefined)?.nodeId;
          if (typeof nodeId === 'string' && nodeId.length > 0) queued.push({ actionId, nodeId });
        },
        actions: projectHookActions(runtime.actions),
      });
      await dispatcher.dispatch('job.completed', {
        type: 'job.completed',
        timestamp: Date.now(),
        jobId: job.id,
        // node rides the INTERNAL dispatch event (buildHookContext lifts it
        // to ctx.node); it is NOT added to the spec ndjson job.completed shape.
        data: {
          extensionId: job.extensionId,
          extensionKind: job.extensionKind,
          ...(bundle ? { node: bundle.node } : {}),
        },
      });
      if (queued.length === 0) return;
      const jobsConfig = loadConfig({ cwd }).effective.jobs;
      for (const request of queued) {
        // A no-findings / drift / duplicate refusal is swallowed by contract
        // (nothing to fix is not an error); a hard throw is caught too.
        try {
          await submitFixerJob(adapter, runtime, jobsConfig, {
            extensionId: request.actionId,
            nodeId: request.nodeId,
            cwd,
          });
        } catch {
          // best-effort: a fixer submit failure never fails the record.
        }
      }
    } catch {
      // Hooks never block the pipeline (spec §Hook). A failure here leaves
      // the recorded job completed; the auto-fix chain just did not run.
    }
  }

  /**
   * Read the report payload from `--report` (a file path, or `-` for
   * stdin). Returns the raw text, or exit 2 when the source is unreadable
   * (the agent can retry; the reap safety net closes a stranded job).
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
    // A callback-reported failure is `runner-error` (the agent hit an
    // error and reported it). `user-failed` is the operator verb
    // `sm jobs fail`, not this path. `--error` is stored verbatim in
    // report_json (spec/cli-contract.md §Record).
    const execution = await recordFailedOutcome({
      adapter,
      job,
      failureReason: 'runner-error',
      errorText: this.error ?? null,
      metrics: this.toRecordMetrics(metrics),
      now,
    });
    return this.reportSuccess(execution, job);
  }

  // --- output --------------------------------------------------------------

  /** Bridge the flag-parsed metrics into the shared record-metrics shape. */
  private toRecordMetrics(metrics: IMetrics): IRecordMetrics {
    return {
      tokensIn: metrics.tokensIn,
      tokensOut: metrics.tokensOut,
      durationMs: metrics.durationMs,
      model: this.model ?? null,
    };
  }

  /** Emit the success outcome (exit 0): synthetic envelope or a human line. */
  private reportSuccess(execution: ExecutionRecord, job: Job): TExitCode {
    if (this.json) {
      this.emitSyntheticEnvelope(execution, job);
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
   * `--json`: stream the synthetic run envelope as ndjson on stdout, the
   * canonical job-event emission (`spec/job-events.md`). One envelope
   * wraps exactly one job: `run.started` -> `job.claimed` (replayed from
   * the job row, the claim verb's own stdout is the handover contract) ->
   * `job.callback.received` -> `job.completed` | `job.failed` ->
   * `run.summary`. Run-level events carry `jobId: null`; the new
   * execution id rides on `job.callback.received.data.executionId`.
   */
  private emitSyntheticEnvelope(execution: ExecutionRecord, job: Job): void {
    const emitter = createNdjsonProgressEmitter(this.context.stdout as NodeJS.WritableStream);
    const runId = generateRunId('ext');
    const completed = execution.status === 'completed';
    const stamp = (type: string, jobId: string | null, data: unknown): void =>
      emitter.emit({ type, timestamp: Date.now(), runId, jobId, data });
    stamp('run.started', null, { mode: 'external' });
    stamp('job.claimed', job.id, {
      extensionId: job.extensionId,
      extensionVersion: job.extensionVersion,
      // Not pinned by spec/job-events.md but consistent with
      // job.schema.json: the replayed claim carries the frozen kind so
      // envelope consumers can route without a second lookup.
      extensionKind: job.extensionKind,
      nodeId: job.nodeId,
      ttlSeconds: job.ttlSeconds,
      priority: job.priority,
    });
    stamp('job.callback.received', job.id, {
      status: execution.status,
      model: this.model ?? null,
      executionId: execution.id,
    });
    if (completed) {
      stamp('job.completed', job.id, this.completedEventData(execution, job));
    } else {
      stamp('job.failed', job.id, this.failedEventData(execution));
    }
    stamp('run.summary', null, summaryEventData(execution, completed));
  }

  /**
   * `job.completed` event data (`spec/job-events.md`). Carries the job's
   * frozen `extensionId` / `extensionKind` so a hook can filter to a kind
   * (`kind: 'analyzer'`) or a specific extension, this is what the opt-in
   * `core/auto-fix` hook keys on to chain finder -> fixer (Decision #144).
   */
  private completedEventData(execution: ExecutionRecord, job: Job): Record<string, unknown> {
    return {
      extensionId: job.extensionId,
      extensionKind: job.extensionKind,
      durationMs: execution.durationMs ?? null,
      tokensIn: execution.tokensIn ?? null,
      tokensOut: execution.tokensOut ?? null,
      model: this.model ?? null,
      executionId: execution.id,
    };
  }

  /** `job.failed` event data (`spec/job-events.md`). */
  private failedEventData(execution: ExecutionRecord): Record<string, unknown> {
    return {
      reason: execution.failureReason ?? null,
      message: this.error ?? null,
      exitCode: execution.exitCode ?? null,
      durationMs: execution.durationMs ?? null,
    };
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

/**
 * `run.summary` event data: 0/1-valued counts (a synthetic run wraps
 * exactly one job) with the aggregate-ready shape of `spec/job-events.md`.
 */
function summaryEventData(execution: ExecutionRecord, completed: boolean): Record<string, unknown> {
  return {
    jobsAttempted: 1,
    jobsCompleted: completed ? 1 : 0,
    jobsFailed: completed ? 0 : 1,
    totalDurationMs: execution.durationMs ?? 0,
    totalTokensIn: execution.tokensIn ?? 0,
    totalTokensOut: execution.tokensOut ?? 0,
  };
}

/**
 * Project the composed Actions to the minimal `IHookActionInfo[]` a hook
 * resolves the inverse of Modelo B against (qualified id + declared
 * `precondition.analyzerIds`). Handed to the dispatcher as `ctx.actions`.
 */
function projectHookActions(actions: readonly IAction[]): IHookActionInfo[] {
  return actions.map((action) => ({
    id: qualifiedExtensionId(action.pluginId, action.id),
    analyzerIds: action.precondition?.analyzerIds ?? [],
  }));
}

/**
 * A no-op `ProgressEmitterPort` for the record-path hook dispatch: the
 * dispatcher only uses the emitter to surface a hook's own error, and the
 * record path must NOT write anything to stdout (it carries the ndjson
 * envelope under `--json`), so those hook errors are dropped.
 */
function silentEmitter(): ProgressEmitterPort {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  return { emit: () => {} } as unknown as ProgressEmitterPort;
}
