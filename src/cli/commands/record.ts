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
 *      schema. On validation failure -> transition to `failed` /
 *      `report-invalid` (never left `running`) and exit 2. On success ->
 *      `completed`, report stored inline, exit 0.
 *   5. `--status failed`: transition to `failed` / `runner-error`. Exit 0.
 *
 * The record ORCHESTRATION (the nonce / state gate, the completed / failed
 * transition, the auto-fix chain, and the tagger tags proposal) lives in the
 * SHARED `core/jobs/record-engine.ts` module (also consumed by the MCP
 * `record_job` tool); this file owns the CLI-flag surface, the `--report`
 * reading, the exit-code mapping, the `pushJobEvent`-backed live push, and
 * the `--json` synthetic run envelope (`spec/job-events.md`):
 * `run.started(mode=external)` -> `job.claimed` replay ->
 * `job.callback.received` -> `job.completed` | `job.failed` ->
 * `run.summary`, one ndjson line each, no other JSON output.
 *
 * Exit codes (`spec/cli-contract.md` §Record): 0 success, 4 nonce
 * mismatch, 5 missing job / DB, 2 otherwise (bad flags, not-running,
 * unreadable report, report-invalid).
 *
 * Schema constraints called out: `state_executions` carries no free-text
 * `error` column. `--error` is stored verbatim in `report_json` on the
 * failed path per `spec/cli-contract.md` §Record. `--model` persists on
 * `state_executions.model` and is denormalized onto the findings /
 * summary rows the same record writes; it also travels on the synthetic
 * envelope (`job.callback.received.data.model`).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Command, Option } from 'clipanion';

import type { ExecutionRecord, Job } from '../../kernel/types.js';
import type { StoragePort } from '../../kernel/ports/storage.js';
import { createNdjsonProgressEmitter } from '../../core/runtime/progress-emitter.js';
import { generateRunId } from '../../kernel/jobs/index.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tx } from '../../kernel/util/tx.js';
import { requireDbOrExit, resolveDbPath } from '../util/db-path.js';
import { assertNoDriftForWrite } from '../../core/sqlite/db-version-runner.js';
import { ExitCode, type TExitCode } from '../util/exit-codes.js';
import { pushJobEvent } from '../util/job-event-push.js';
import { RECORD_TEXTS as T } from '../i18n/record.texts.js';

import { defaultRuntimeContext } from '../../core/runtime/runtime-context.js';
import { SmCommand } from '../util/sm-command.js';
import { withSqlite } from '../../core/sqlite/with-sqlite.js';
import type { IActionRuntime } from '../../core/jobs/action-runtime.js';
import {
  buildCompletedEventData,
  buildFailedEventData,
  recordJob,
  type TRecordOutcome,
} from '../../core/jobs/record-engine.js';
import { loadActionRuntime } from './action-runtime.js';
import type { IRecordMetrics } from '../../core/jobs/record-outcome.js';

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
  static override exitCodes = [ExitCode.Ok, ExitCode.Error, ExitCode.NonceMismatch, ExitCode.NotFound];
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
    const dbExit = requireDbOrExit(dbPath, this.context.stderr, this.noColor);
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

  /**
   * Read the report (completed path only), run the shared record engine,
   * and map its structured outcome to this command's exit codes + output.
   * The job row is fetched once (running state) so the `--json` synthetic
   * envelope + the schema-unresolved / not-found messages have its frozen
   * fields, exactly as before the engine extraction.
   */
  private async dispatch(
    adapter: StoragePort,
    status: 'completed' | 'failed',
    metrics: IMetrics,
    cwd: string,
  ): Promise<TExitCode> {
    const job = await adapter.jobs.get(this.id);
    if (!job) return this.fail(tx(T.errJobNotFound, { id: this.id }), ExitCode.NotFound);

    let reportText: string | undefined;
    if (status === 'completed') {
      const read = this.readReport(cwd);
      if (typeof read === 'number') return read; // IO error -> exit 2, no mutation
      reportText = read;
    }

    // One ext-mode runId identifies this record invocation everywhere it
    // surfaces: the live push (spec/job-events.md §Transport), the fixer
    // submits the auto-fix hook queues inside this run, and the `--json`
    // synthetic envelope.
    const runId = generateRunId('ext');
    // Load the composed runtime at most once, lazily: the engine triggers
    // it only after the report parses (preserving the
    // report-invalid-before-resolution ordering), and the auto-fix + tags
    // legs reuse the same instance.
    let runtimeMemo: IActionRuntime | undefined;
    const getRuntime = async (): Promise<IActionRuntime> =>
      (runtimeMemo ??= await loadActionRuntime(this.printer!));

    const outcome = await recordJob({
      adapter,
      getRuntime,
      id: this.id,
      nonce: this.nonce,
      status,
      ...(reportText !== undefined ? { reportText } : {}),
      errorText: this.error ?? null,
      metrics: this.toRecordMetrics(metrics),
      now: Date.now(),
      runId,
      cwd,
      channel: 'cli',
      // The CLI live-transition leg (spec/job-events.md §Transport): push
      // every engine event to the project's running server, best-effort.
      onEvent: (event) => pushJobEvent(cwd, event),
      // Human-mode only (`info` is silenced under `--json`): the tagger
      // WRITES nothing, so the one line the recorder owes the operator is
      // what the model proposed and where to act on it.
      onTagsProposed: (tags, node) => this.printer!.info(this.tagsProposedLine(tags, node)),
    });

    return this.mapOutcome(outcome, job, runId);
  }

  /** Map the engine outcome to output + exit code. */
  private mapOutcome(outcome: TRecordOutcome, job: Job, runId: string): TExitCode {
    switch (outcome.kind) {
      case 'not-found':
        return this.fail(tx(T.errJobNotFound, { id: this.id }), ExitCode.NotFound);
      case 'nonce-mismatch':
        return this.fail(tx(T.errNonceMismatch, { id: this.id }), ExitCode.NonceMismatch);
      case 'not-running':
        return this.fail(
          tx(T.errNotRunning, { id: this.id, status: sanitizeForTerminal(outcome.status) }),
          ExitCode.Error,
        );
      case 'schema-unresolved':
        return this.fail(
          tx(T.errReportSchemaUnresolved, {
            extension: sanitizeForTerminal(job.extensionId),
            detail: sanitizeForTerminal(outcome.detail),
          }),
          ExitCode.Error,
        );
      case 'report-invalid':
        this.printer!.error(
          tx(T.errPrefix, {
            glyph: this.errGlyph(),
            message: tx(T.reportInvalid, { errors: sanitizeForTerminal(outcome.detail) }),
          }),
        );
        return ExitCode.Error;
      case 'completed':
        return this.reportSuccess(outcome.execution, job, runId);
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

  /**
   * The tagger advisory (`spec/job-lifecycle.md` §Tags proposal): the record
   * path writes no curation, so this line names the proposed tags and points
   * at the tags editor where the human saves them under their own hand.
   */
  private tagsProposedLine(tags: readonly string[], node: string): string {
    // Tags are AI-proposed strings straight out of the agent's report,
    // the highest-risk provenance for terminal output; the node path is
    // a DB round-trip. Sanitize both.
    return tx(T.tagsProposed, {
      glyph: this.ansiFor('stderr').cyan('ℹ'),
      count: tags.length,
      noun: tags.length === 1 ? T.tagsNounSingular : T.tagsNounPlural,
      node: sanitizeForTerminal(node),
      tags: sanitizeForTerminal(tags.join(', ')),
    });
  }

  /** Emit the success outcome (exit 0): synthetic envelope or a human line. */
  private reportSuccess(execution: ExecutionRecord, job: Job, runId: string): TExitCode {
    if (this.json) {
      this.emitSyntheticEnvelope(execution, job, runId);
      return ExitCode.Ok;
    }
    if (execution.status === 'completed') {
      this.printer!.info(
        tx(T.completedLine, {
          glyph: this.okGlyph(),
          execId: sanitizeForTerminal(execution.id),
          id: sanitizeForTerminal(execution.jobId ?? ''),
        }),
      );
    } else {
      this.printer!.info(
        tx(T.failedLine, {
          glyph: this.warnGlyph(),
          execId: sanitizeForTerminal(execution.id),
          id: sanitizeForTerminal(execution.jobId ?? ''),
          reason: sanitizeForTerminal(execution.failureReason ?? ''),
        }),
      );
    }
    return ExitCode.Ok;
  }

  /**
   * `--json`: stream the synthetic run envelope as ndjson on stdout, the
   * canonical job-event emission (`spec/job-events.md`). One envelope
   * wraps exactly one job: `run.started` -> `job.claimed` (replayed from
   * the job row) -> `job.callback.received` -> `job.completed` |
   * `job.failed` -> `run.summary`. Run-level events carry `jobId: null`;
   * the new execution id rides on `job.callback.received.data.executionId`.
   * `runId` is the invocation's shared ext-mode id, the same one the live
   * push leg stamped.
   */
  private emitSyntheticEnvelope(execution: ExecutionRecord, job: Job, runId: string): void {
    const emitter = createNdjsonProgressEmitter(this.context.stdout as NodeJS.WritableStream);
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
      stamp('job.completed', job.id, buildCompletedEventData(execution, job, this.model ?? null));
    } else {
      stamp('job.failed', job.id, buildFailedEventData(execution, this.error ?? null));
    }
    stamp('run.summary', null, summaryEventData(execution, completed));
  }

  // --- small glyph / error helpers ---------------------------------------

  private fail(message: string, code: TExitCode): TExitCode {
    // Funnel sanitization: outcome messages can embed DB statuses and
    // engine details composed upstream.
    this.printer!.error(
      tx(T.errPrefix, { glyph: this.errGlyph(), message: sanitizeForTerminal(message) }),
    );
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
