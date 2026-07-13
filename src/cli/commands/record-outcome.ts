/**
 * Shared record machinery (Step 10 Phase E): the single implementation of
 * `spec/job-lifecycle.md` §Record steps 4-6 consumed by BOTH driving
 * surfaces that close a running job:
 *
 *   - `sm record` (`record.ts`), the nonce-authenticated callback fed by
 *     CLI flags (`--report <path|->`, `--tokens-in`, ...).
 *   - the `sm job run` drain loop (`job-run.ts`), fed by a `RunnerPort`
 *     result (`IRunResult`).
 *
 * Both paths MUST behave identically on report validation, the
 * `report-invalid` transition, the `state_executions` row, the job
 * transition, and the `writesSummary` -> `state_summaries` write-through;
 * extracting the core here is what guarantees that (no duplicated logic to
 * drift).
 *
 * Exposed pieces:
 *   - `resolveActionRecord`, resolve a job's Action + report schema against
 *     a preloaded runtime (plugin `report.schema.json` from the source dir,
 *     or the built-in's inlined `reportSchema`).
 *   - `recordCompletedOutcome`, the `--status completed` path: parse the
 *     report text, validate against the schema, and either land the
 *     `completed` execution (+ summary write-through when the Action
 *     declares `writesSummary`) or transition to `failed`/`report-invalid`
 *     (never left `running`). Action resolution is LAZY (a callback) so an
 *     unparseable report short-circuits to `report-invalid` without ever
 *     loading the runtime, preserving `sm record`'s historical ordering.
 *   - `recordFailedOutcome`, the failure path shared by `sm record
 *     --status failed` (reason `runner-error`, `--error` verbatim) and the
 *     drain loop (`runner-error` on a non-zero / timed-out subprocess,
 *     `job-file-missing` on a missing content row).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ExecutionFailureReason, ExecutionRecord, Job } from '../../kernel/types.js';
import type { IAction } from '../../kernel/extensions/index.js';
import type { StoragePort } from '../../kernel/ports/storage.js';
import { generateExecutionId } from '../../kernel/jobs/index.js';
import { loadSchemaValidators } from '../../kernel/adapters/schema-validators.js';
import { qualifiedExtensionId } from '../../kernel/registry.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { resolveAction, type IActionRuntime } from './action-runtime.js';

/**
 * Runner-side metrics stamped onto the execution row. Every field is
 * optional: `sm record` fills them from flags (never `exitCode`, that
 * surface has no flag), the drain loop from the `IRunResult`.
 */
export interface IRecordMetrics {
  tokensIn?: number | undefined;
  tokensOut?: number | undefined;
  durationMs?: number | undefined;
  exitCode?: number | undefined;
}

export interface IResolvedActionRecord {
  action: IAction;
  schema: Record<string, unknown>;
}

export type TActionRecordResolution =
  | { ok: true; record: IResolvedActionRecord }
  | { ok: false; detail: string };

/**
 * Resolve the recorded job's Action against a preloaded runtime PLUS its
 * report schema: the plugin's on-disk `report.schema.json` (from the
 * action's source dir) or the built-in's inlined `reportSchema`. Returns
 * both so the completed path can validate the report AND read the Action's
 * `writesSummary` flag. Failure details (`action not found`, a read error,
 * `no report schema`) are caller-rendered; no mutation happens here.
 */
export function resolveActionRecord(
  runtime: IActionRuntime,
  actionId: string,
): TActionRecordResolution {
  const action = resolveAction(runtime.actions, actionId);
  if (!action) return { ok: false, detail: 'action not found' };
  const dir = runtime.dirByAction.get(qualifiedExtensionId(action.pluginId, action.id));
  if (dir !== undefined) {
    try {
      const schema = JSON.parse(
        readFileSync(join(dir, 'report.schema.json'), 'utf8'),
      ) as Record<string, unknown>;
      return { ok: true, record: { action, schema } };
    } catch (err) {
      return { ok: false, detail: formatErrorMessage(err) };
    }
  }
  if (action.reportSchema && typeof action.reportSchema === 'object') {
    return { ok: true, record: { action, schema: action.reportSchema } };
  }
  return { ok: false, detail: 'no report schema' };
}

export type TRecordCompletedOutcome =
  | { kind: 'completed'; execution: ExecutionRecord }
  | { kind: 'report-invalid'; execution: ExecutionRecord; detail: string }
  /** Action / schema unresolvable: NO mutation happened (caller decides). */
  | { kind: 'schema-unresolved'; detail: string };

/**
 * The `completed` record path (`spec/job-lifecycle.md` §Record steps 4-6).
 * Parse `reportText` as JSON and validate it against the action's report
 * schema; on success write the `completed` execution row (report stored
 * inline as canonical JSON) plus the `state_summaries` write-through when
 * the Action declares `writesSummary`, all in one transaction. An
 * unparseable or schema-invalid report transitions the job to `failed` /
 * `report-invalid` instead (never left `running`); the invalid payload is
 * NOT stored. `resolve` is invoked lazily, AFTER the parse gate, and a
 * failed resolution mutates nothing.
 */
export async function recordCompletedOutcome(opts: {
  adapter: StoragePort;
  job: Job;
  reportText: string;
  resolve: () => Promise<TActionRecordResolution>;
  metrics: IRecordMetrics;
  now: number;
}): Promise<TRecordCompletedOutcome> {
  const { adapter, job, metrics, now } = opts;

  let parsed: unknown;
  try {
    parsed = JSON.parse(opts.reportText);
  } catch (err) {
    const execution = await recordFailedOutcome({
      adapter,
      job,
      failureReason: 'report-invalid',
      errorText: null,
      metrics,
      now,
    });
    return { kind: 'report-invalid', execution, detail: formatErrorMessage(err) };
  }

  const resolution = await opts.resolve();
  if (!resolution.ok) return { kind: 'schema-unresolved', detail: resolution.detail };

  const validation = loadSchemaValidators().validateActionReport(
    resolution.record.schema,
    parsed,
  );
  if (!validation.ok) {
    const execution = await recordFailedOutcome({
      adapter,
      job,
      failureReason: 'report-invalid',
      errorText: null,
      metrics,
      now,
    });
    return { kind: 'report-invalid', execution, detail: validation.errors };
  }

  // Report stored inline as canonical JSON (the input source is NOT
  // retained, spec §Record step 5). The same serialized report feeds the
  // summary write-through below.
  const reportJson = JSON.stringify(parsed);
  const execution = buildExecution(job, {
    status: 'completed',
    failureReason: null,
    now,
    metrics,
    reportJson,
  });
  // Summary write-through (spec §Record): a `writesSummary` Action's
  // validated report is upserted into `state_summaries` in the SAME
  // transaction as the execution insert + job transition. The adapter
  // reads the node's live kind + body_hash and skips the upsert when the
  // node is gone. Non-summary actions pass `undefined` (report stays
  // history-only).
  const summary =
    resolution.record.action.writesSummary === true
      ? {
          summarizerActionId: job.actionId,
          summarizerVersion: job.actionVersion,
          generatedAt: now,
          summaryJson: reportJson,
        }
      : undefined;
  await adapter.jobs.recordTerminal(execution, summary);
  return { kind: 'completed', execution };
}

/**
 * The failure record path: write the `failed` execution row with the given
 * `failureReason` and transition the job, atomically. `errorText` (the
 * runner's `--error`, a subprocess's output excerpt, or a loop-level
 * detail) is stored verbatim in `report_json`, the only free-text slot on
 * a failed execution (`spec/cli-contract.md` §Record); `null` stores no
 * payload (e.g. an invalid report, which is never retained).
 */
export async function recordFailedOutcome(opts: {
  adapter: StoragePort;
  job: Job;
  failureReason: ExecutionFailureReason;
  errorText: string | null;
  metrics: IRecordMetrics;
  now: number;
}): Promise<ExecutionRecord> {
  const execution = buildExecution(opts.job, {
    status: 'failed',
    failureReason: opts.failureReason,
    now: opts.now,
    metrics: opts.metrics,
    reportJson: opts.errorText,
  });
  await opts.adapter.jobs.recordTerminal(execution);
  return execution;
}

/** Compose the `state_executions` row for a terminal job transition. */
function buildExecution(
  job: Job,
  opts: {
    status: 'completed' | 'failed';
    failureReason: ExecutionFailureReason | null;
    now: number;
    metrics: IRecordMetrics;
    reportJson: string | null;
  },
): ExecutionRecord {
  return {
    id: generateExecutionId(),
    kind: 'action',
    extensionId: job.actionId,
    extensionVersion: job.actionVersion,
    nodeIds: [job.nodeId],
    contentHash: job.contentHash,
    status: opts.status,
    failureReason: opts.failureReason,
    // `sm record` has no --exit-code flag (stays null there); the drain
    // loop fills it from the subprocess result.
    exitCode: opts.metrics.exitCode ?? null,
    runner: job.runner ?? null,
    // Job start = its claim time; a running job always carries claimedAt.
    startedAt: job.claimedAt ?? opts.now,
    finishedAt: opts.now,
    durationMs: opts.metrics.durationMs ?? null,
    tokensIn: opts.metrics.tokensIn ?? null,
    tokensOut: opts.metrics.tokensOut ?? null,
    // Domain field name; storage bridges it to the report_json column.
    reportPath: opts.reportJson,
    jobId: job.id,
  };
}
