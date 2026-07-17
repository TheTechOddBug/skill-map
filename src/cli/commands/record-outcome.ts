/**
 * Shared record machinery: the single implementation of
 * `spec/job-lifecycle.md` §Record steps 4-6 consumed by both driving
 * surfaces that close a running job:
 *
 *   - `sm record` (`record.ts`), the nonce-authenticated callback fed by
 *     CLI flags (`--report <path|->`, `--tokens-in`, ...). The canonical
 *     path: an external agent processes the queue via `sm jobs claim` +
 *     `sm record` (skill-map never executes a job itself).
 *   - the claim-side corruption path (`job-queue.ts`), which marks a
 *     just-claimed job with a missing content row `job-file-missing`.
 *
 * Both paths MUST behave identically on the `state_executions` row, the
 * job transition, and the summary-schema -> `state_summaries`
 * write-through; extracting the core here is what guarantees that (no
 * duplicated logic to drift).
 *
 * Exposed pieces:
 *   - `resolveActionRecord`, resolve a job's Action + report schema against
 *     a preloaded runtime (plugin `report.schema.json` from the source dir,
 *     or the built-in's inlined `reportSchema`).
 *   - `resolveExtensionRecord`, the kind-strict resolver the record path
 *     uses: routes on the job row's FROZEN `extensionKind`
 *     (`state_jobs.extension_kind`, stamped at submit) and resolves the
 *     report schema within that kind's registry only, so a plugin
 *     shipping both kinds under one extension id stays unambiguous.
 *   - `recordCompletedOutcome`, the `--status completed` path: parse the
 *     report text, validate against the schema, and either land the
 *     `completed` execution (+ summary write-through when the Action's
 *     report schema is a summary schema, + findings write-through per
 *     `spec/job-lifecycle.md` §Record, + the fixer resolution stamps when
 *     the Action declares `analyzerIds`) or transition to
 *     `failed`/`report-invalid` (never left `running`). Extension
 *     resolution is LAZY (a callback) so an unparseable report
 *     short-circuits to `report-invalid` without ever loading the
 *     runtime, preserving `sm record`'s historical ordering.
 *   - `recordFailedOutcome`, the failure path shared by `sm record
 *     --status failed` (reason `runner-error`, `--error` verbatim) and the
 *     claim-side corruption path (`job-file-missing` on a missing content
 *     row).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ExecutionFailureReason, ExecutionRecord, Job, JobExtensionKind } from '../../kernel/types.js';
import type { IAction, IAnalyzer } from '../../kernel/extensions/index.js';
import type { StoragePort } from '../../kernel/ports/storage.js';
import type {
  IFindingResolutionIntent,
  IFindingsWriteIntent,
  ISummaryWriteIntent,
} from '../../kernel/types/storage.js';
import {
  extensionFindingRows,
  findReservedFindingTypes,
  fixerResolutionEntries,
  generateExecutionId,
  kernelSafetyRows,
  summaryKindOfReportSchema,
} from '../../kernel/jobs/index.js';
import { readActiveSuppressions } from '../util/sidecar-suppressions.js';
import { loadSchemaValidators } from '../../kernel/adapters/schema-validators.js';
import { qualifiedExtensionId } from '../../kernel/registry.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { tx } from '../../kernel/util/tx.js';
import { RECORD_TEXTS } from '../i18n/record.texts.js';
import type { IActionRuntime } from '../../core/jobs/action-runtime.js';
import { resolveAction } from './action-runtime.js';

/**
 * Agent-side metrics stamped onto the execution row. Every field is
 * optional: `sm record` fills them from flags, the claim-side corruption
 * path passes none. `model` is the agent's self-reported `--model`
 * (unverifiable by design, like the token counts); it persists on
 * `state_executions.model` and is denormalized onto the findings /
 * summary rows the same record writes.
 */
export interface IRecordMetrics {
  tokensIn?: number | undefined;
  tokensOut?: number | undefined;
  durationMs?: number | undefined;
  model?: string | null | undefined;
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
 * both so the completed path can validate the report AND detect the
 * summarizer opt-in from the schema itself
 * (`summaryKindOfReportSchema`). Failure details (`action not found`, a read error,
 * `no report schema`) are caller-rendered; no mutation happens here.
 */
export function resolveActionRecord(
  runtime: IActionRuntime,
  extensionId: string,
): TActionRecordResolution {
  const action = resolveAction(runtime.actions, extensionId);
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

/**
 * Kind-strict record resolution (`spec/job-lifecycle.md` §Record): the
 * job row carries the extension kind FROZEN at submit
 * (`state_jobs.extension_kind`), so the record path routes on it
 * directly, no cross-registry guessing, and a plugin shipping BOTH
 * kinds under one extension id stays unambiguous end-to-end.
 * `extensionKind` drives the write-through routing: an Analyzer's
 * validated report lands in `state_findings` by definition, an Action's
 * routes by schema namespace (summaries / enrichments / history-only).
 */
export interface IResolvedExtensionRecord {
  extensionKind: JobExtensionKind;
  schema: Record<string, unknown>;
  /**
   * The Action's declared `precondition.analyzerIds`, i.e. THE FIXER
   * SIGNAL (Modelo B): a non-empty list means this extension resolves
   * another finder's findings, so its report's `resolved[]` entries get
   * stamped onto them at record. `null` for an Analyzer (a finder never
   * resolves) and for an Action that declares none (a plain probabilistic
   * Action: summarizer, enricher, ...).
   */
  analyzerIds: readonly string[] | null;
}

export type TExtensionRecordResolution =
  | { ok: true; record: IResolvedExtensionRecord }
  | { ok: false; detail: string };

/**
 * Resolve the recorded job's report schema within the registry the
 * frozen `extensionKind` names: an `analyzer` job validates against the
 * ANALYZER's `report.schema.json` (or codegen-inlined `reportSchema`)
 * even when a sibling Action shares the extension id, and vice versa.
 */
export function resolveExtensionRecord(
  runtime: IActionRuntime,
  extensionId: string,
  extensionKind: JobExtensionKind,
): TExtensionRecordResolution {
  return extensionKind === 'action'
    ? resolveActionExtensionRecord(runtime, extensionId)
    : resolveAnalyzerExtensionRecord(runtime, extensionId);
}

/**
 * The `action` leg: the Action's report schema plus its declared
 * `precondition.analyzerIds`, the FIXER signal the record path scopes
 * its resolution stamps by.
 */
function resolveActionExtensionRecord(
  runtime: IActionRuntime,
  extensionId: string,
): TExtensionRecordResolution {
  const resolution = resolveActionRecord(runtime, extensionId);
  if (!resolution.ok) return resolution;
  return {
    ok: true,
    record: {
      extensionKind: 'action',
      schema: resolution.record.schema,
      analyzerIds: resolution.record.action.precondition?.analyzerIds ?? null,
    },
  };
}

/**
 * The `analyzer` leg: the finder's own `report.schema.json` (from its
 * source dir) or the built-in's codegen-inlined `reportSchema`. Always
 * `analyzerIds: null`, a finder never resolves another's findings.
 */
function resolveAnalyzerExtensionRecord(
  runtime: IActionRuntime,
  extensionId: string,
): TExtensionRecordResolution {
  const analyzer = resolveProbabilisticAnalyzer(runtime.analyzers, extensionId);
  if (!analyzer) return { ok: false, detail: 'analyzer not found' };
  const dir = runtime.dirByAnalyzer.get(qualifiedExtensionId(analyzer.pluginId, analyzer.id));
  if (dir !== undefined) {
    try {
      const schema = JSON.parse(
        readFileSync(join(dir, 'report.schema.json'), 'utf8'),
      ) as Record<string, unknown>;
      return { ok: true, record: { extensionKind: 'analyzer', schema, analyzerIds: null } };
    } catch (err) {
      return { ok: false, detail: formatErrorMessage(err) };
    }
  }
  if (analyzer.reportSchema && typeof analyzer.reportSchema === 'object') {
    return {
      ok: true,
      record: { extensionKind: 'analyzer', schema: analyzer.reportSchema, analyzerIds: null },
    };
  }
  return { ok: false, detail: 'no report schema' };
}

/**
 * Qualified-then-bare analyzer lookup, restricted to the probabilistic
 * subset: only finders enter the queue, so a deterministic analyzer can
 * never be the recorded job's extension.
 */
function resolveProbabilisticAnalyzer(
  analyzers: readonly IAnalyzer[],
  id: string,
): IAnalyzer | null {
  const finders = analyzers.filter((a) => (a.mode ?? 'deterministic') === 'probabilistic');
  for (const analyzer of finders) {
    if (qualifiedExtensionId(analyzer.pluginId, analyzer.id) === id) return analyzer;
  }
  for (const analyzer of finders) {
    if (analyzer.id === id) return analyzer;
  }
  return null;
}

export type TRecordCompletedOutcome =
  | { kind: 'completed'; execution: ExecutionRecord }
  | { kind: 'report-invalid'; execution: ExecutionRecord; detail: string }
  /** Extension / schema unresolvable: NO mutation happened (caller decides). */
  | { kind: 'schema-unresolved'; detail: string };

/**
 * The `completed` record path (`spec/job-lifecycle.md` §Record steps 4-6).
 * Parse `reportText` as JSON and validate it against the extension's
 * report schema; on success write the `completed` execution row (report
 * stored inline as canonical JSON) plus the write-throughs, all in one
 * transaction:
 *
 *   - `state_summaries` when the recorded ACTION's report schema extends
 *     a `summaries/<kind>` schema (unchanged).
 *   - `state_findings` for EVERY completed probabilistic record: the
 *     finder lane (one `origin: 'extension'` row per `findings[]` entry,
 *     ANALYZER reports only) plus the kernel safety lane (`origin:
 *     'kernel'` rows synthesized from a trouble-flagging `safety` block,
 *     both kinds). The intent always travels, even with zero rows, so
 *     the replace semantics erase the pair's previous judgment (a clean
 *     verdict); the adapter skips the whole write when the node is gone.
 *
 * A `findings[]` entry that uses a RESERVED type slug
 * (`injection-detected` / `content-suspicious` / `content-malformed`)
 * fails the job as `report-invalid` (spec: implementations SHOULD
 * reject). An unparseable or schema-invalid report transitions the job
 * to `failed` / `report-invalid` too (never left `running`); the invalid
 * payload is NOT stored. `resolve` is invoked lazily, AFTER the parse
 * gate, and a failed resolution mutates nothing.
 */
export async function recordCompletedOutcome(opts: {
  adapter: StoragePort;
  job: Job;
  reportText: string;
  resolve: () => Promise<TExtensionRecordResolution>;
  metrics: IRecordMetrics;
  now: number;
  /**
   * Runtime cwd, threaded so the finder lane can read the node's LIVE
   * `.sm` sidecar suppressions (`spec/db-schema.md` §state_findings) and
   * drop dismissed findings before they land. The sidecar is the source
   * of truth (`sm findings dismiss` writes it directly), NOT the
   * denormalized `scan_nodes.annotations_json` (stale between a dismiss
   * and the next scan).
   */
  cwd: string;
}): Promise<TRecordCompletedOutcome> {
  const { adapter, job, metrics, now } = opts;

  // Shared invalid-report transition: `failed` / `report-invalid`, the
  // payload NOT stored, `detail` surfaced by the caller.
  const failReportInvalid = async (detail: string): Promise<TRecordCompletedOutcome> => {
    const execution = await recordFailedOutcome({
      adapter,
      job,
      failureReason: 'report-invalid',
      errorText: null,
      metrics,
      now,
    });
    return { kind: 'report-invalid', execution, detail };
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(opts.reportText);
  } catch (err) {
    return failReportInvalid(formatErrorMessage(err));
  }

  const resolution = await opts.resolve();
  if (!resolution.ok) return { kind: 'schema-unresolved', detail: resolution.detail };

  const validation = loadSchemaValidators().validateActionReport(
    resolution.record.schema,
    parsed,
  );
  if (!validation.ok) return failReportInvalid(validation.errors);

  // Schema-validated report as a record (the schemas pin `type: object`;
  // the guard is defence in depth, never a validation layer).
  const report = asRecord(parsed);
  const extensionKind = resolution.record.extensionKind;

  // Reserved-slug gate (spec §state_findings, safety lane): extensions
  // MUST NOT emit the kernel-reserved type slugs themselves. A finder
  // report that does fails the job as report-invalid, exactly like a
  // schema violation (the payload is NOT stored, no findings land).
  if (extensionKind === 'analyzer') {
    const reserved = findReservedFindingTypes(report);
    if (reserved.length > 0) {
      return failReportInvalid(
        tx(RECORD_TEXTS.reservedFindingTypes, { slugs: reserved.join(', ') }),
      );
    }
  }

  // Report stored inline as canonical JSON (the input source is NOT
  // retained, spec §Record step 5). The same serialized report feeds the
  // write-throughs below.
  const reportJson = JSON.stringify(parsed);
  const execution = buildExecution(job, {
    status: 'completed',
    failureReason: null,
    now,
    metrics,
    reportJson,
  });
  const summary = buildSummaryIntent(job, resolution.record, reportJson, now, metrics);
  const findings = buildFindingsIntent(job, extensionKind, report, now, metrics, opts.cwd);
  const resolutions = buildResolutionIntent(job, resolution.record, report, now);
  await adapter.jobs.recordTerminal(execution, summary, findings, resolutions);
  return { kind: 'completed', execution };
}

/**
 * Fixer resolution intent (`spec/db-schema.md` §state_findings, "Fixer
 * resolution"). Fires ONLY for a FIXER: an Action declaring a non-empty
 * `precondition.analyzerIds`, the same signal the submit path gates the
 * findings injection on. Its report's `resolved[]` entries carry the
 * finding `id`s the fixer echoed back, and the adapter stamps each onto
 * its row inside the record transaction, scoped to the job's node and
 * these `analyzerIds`.
 *
 * `undefined` (no stamping leg at all) for a finder, for a plain
 * probabilistic Action, and for a fixer whose report resolved nothing:
 * unlike the findings write-through, an empty intent has NO erase
 * semantics to preserve, so there is nothing to hand the adapter.
 */
function buildResolutionIntent(
  job: Job,
  record: IResolvedExtensionRecord,
  report: Record<string, unknown>,
  now: number,
): IFindingResolutionIntent | undefined {
  if (record.extensionKind !== 'action') return undefined;
  const analyzerIds = record.analyzerIds;
  if (analyzerIds === null || analyzerIds.length === 0) return undefined;
  const entries = fixerResolutionEntries(report);
  if (entries.length === 0) return undefined;
  return {
    // The job row's extensionId is the qualified id (stamped at submit).
    resolvedBy: job.extensionId,
    analyzerIds,
    resolvedAt: now,
    entries,
  };
}

/**
 * Summary write-through intent (spec §Record): the summarizer signal is
 * the report schema, not a manifest flag. When a recorded ACTION's schema
 * extends a canonical `summaries/<kind>` schema, the validated report is
 * upserted into `state_summaries` in the SAME transaction as the
 * execution insert + job transition (the adapter reads the node's live
 * kind + body_hash and skips the upsert when the node is gone).
 * Non-summary actions return `undefined` (report stays history-only);
 * an Analyzer's report is findings by definition, never a summary.
 */
function buildSummaryIntent(
  job: Job,
  record: IResolvedExtensionRecord,
  reportJson: string,
  now: number,
  metrics: IRecordMetrics,
): ISummaryWriteIntent | undefined {
  if (record.extensionKind !== 'action') return undefined;
  if (summaryKindOfReportSchema(record.schema) === null) return undefined;
  return {
    // `state_summaries` keeps the Action-specific column names (a
    // summarizer is always an Action); the values mirror the job's
    // kind-agnostic `extensionId` / `extensionVersion`.
    summarizerActionId: job.extensionId,
    summarizerVersion: job.extensionVersion,
    generatedAt: now,
    // Denormalized agent-self-reported model (spec §state_summaries).
    model: metrics.model ?? null,
    summaryJson: reportJson,
  };
}

/**
 * Findings write-through intent (spec §Record): finder lane for ANALYZER
 * reports, kernel safety lane for both kinds. The intent travels on
 * EVERY completed probabilistic record, even when it carries zero rows:
 * recording a completed job replaces the pair's previous rows (both
 * origins), so a clean report erases a prior trouble flag instead of
 * letting it linger.
 *
 * The finder lane drops any finding matching an active sidecar suppression
 * on the node (`spec/db-schema.md` §state_findings, finder-lane suppression
 * filter): a `sm findings dismiss`ed judgment class never returns until the
 * operator removes the entry from the `.sm` file. The safety lane is never
 * suppressed (its rows are `origin = 'kernel'`, and suppressions only carry
 * finder extension ids anyway).
 */
function buildFindingsIntent(
  job: Job,
  extensionKind: JobExtensionKind,
  report: Record<string, unknown>,
  now: number,
  metrics: IRecordMetrics,
  cwd: string,
): IFindingsWriteIntent {
  const suppressions =
    extensionKind === 'analyzer' ? readActiveSuppressions(cwd, job.nodeId) : [];
  return {
    extensionId: job.extensionId,
    extensionVersion: job.extensionVersion,
    generatedAt: now,
    jobId: job.id,
    // Stamped onto EVERY row, both lanes (spec §state_findings).
    model: metrics.model ?? null,
    rows: [
      ...(extensionKind === 'analyzer'
        ? extensionFindingRows(report, { extensionId: job.extensionId, suppressions })
        : []),
      ...kernelSafetyRows(report),
    ],
  };
}

/** Defensive object narrowing for the schema-validated report payload. */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * The failure record path: write the `failed` execution row with the given
 * `failureReason` and transition the job, atomically. `errorText` (the
 * agent's `--error`, or the claim-side corruption detail) is stored
 * verbatim in `report_json`, the only free-text slot on a failed
 * execution (`spec/cli-contract.md` §Record); `null` stores no payload
 * (e.g. an invalid report, which is never retained).
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
    extensionId: job.extensionId,
    extensionVersion: job.extensionVersion,
    nodeIds: [job.nodeId],
    contentHash: job.contentHash,
    status: opts.status,
    failureReason: opts.failureReason,
    // `sm record` has no --exit-code flag; the column stays null (the
    // external agent owns its subprocesses, skill-map never sees them).
    exitCode: null,
    runner: job.runner ?? null,
    // Job start = its claim time; a running job always carries claimedAt.
    startedAt: job.claimedAt ?? opts.now,
    finishedAt: opts.now,
    durationMs: opts.metrics.durationMs ?? null,
    tokensIn: opts.metrics.tokensIn ?? null,
    tokensOut: opts.metrics.tokensOut ?? null,
    model: opts.metrics.model ?? null,
    // Domain field name; storage bridges it to the report_json column.
    reportPath: opts.reportJson,
    jobId: job.id,
  };
}
