/**
 * The shared record engine, the SINGLE orchestration of
 * `spec/job-lifecycle.md` §Record (the nonce + running gate, the
 * completed / failed transition, the auto-fix chain, and the tags
 * write-through) shared by the two surfaces that CLOSE a running job:
 *
 *   - `sm record` (`cli/commands/record.ts`), the nonce-authenticated CLI
 *     callback; it keeps its `--report` reading, printer / exit-code
 *     mapping, `--json` synthetic envelope, and its `pushJobEvent`-backed
 *     `onEvent` leg;
 *   - the MCP `record_job` tool (`server/mcp/queue-tools.ts`); it maps the
 *     structured outcome to a tool result and broadcasts its `onEvent`
 *     directly (in-process, like a BFF route).
 *
 * The engine RE-CHECKS the nonce + `status === 'running'` and returns the
 * refusals as structured values (never a throw, so both surfaces map them
 * to their own error shape); runs `recordCompletedOutcome` /
 * `recordFailedOutcome` (`core/jobs/record-outcome.ts`); appends ONE
 * operations-log line with the caller's channel; then, AFTER the
 * transaction, fires the finder -> fixer auto-fix chain and the tagger
 * tags write-through best-effort (a failure there never changes the
 * recorded outcome, hooks react, they do not steer the pipeline). The
 * surface-specific side effects (the live job-event push and the tags
 * advisory line) travel out through the optional `onEvent` / `onTags*`
 * callbacks so the engine stays printer-free and transport-agnostic.
 */

import { resolve as resolvePath } from 'node:path';

import type {
  ExecutionFailureReason,
  ExecutionRecord,
  Job,
  JobStatus,
} from '../../kernel/types.js';
import type { IAction, IHookActionInfo } from '../../kernel/extensions/index.js';
import type { StoragePort } from '../../kernel/ports/storage.js';
import type { ProgressEmitterPort } from '../../kernel/ports/progress-emitter.js';
import { makeHookDispatcher } from '../../kernel/extensions/hook-dispatcher.js';
import { generateRunId, isTagsReportSchema, JobNotRunningError } from '../../kernel/jobs/index.js';
import { loadConfig, type IJobsConfig } from '../../kernel/config/loader.js';
import { qualifiedExtensionId } from '../../kernel/registry.js';
import { readSidecarFor, sidecarPathFor } from '../../kernel/sidecar/index.js';
import { FilesystemSidecarStore } from '../../kernel/sidecar/store.js';
import {
  EConsentRequiredError,
  ensureSidecarWritesAllowed,
} from '../config/sidecar-consent.js';
import { appendOperation, type TOperationChannel } from '../operations-log.js';
import {
  recordCompletedOutcome,
  recordFailedOutcome,
  resolveExtensionRecord,
  type IRecordMetrics,
} from './record-outcome.js';
import type { IActionRuntime } from './action-runtime.js';
import { resolveMatchingFixerIds } from './auto-fix-chain.js';
import { submitFixerJob } from './submit-engine.js';

/**
 * A job-lifecycle event the engine hands to `onEvent`. Structurally
 * assignable to BOTH the CLI push envelope (`IJobEventEnvelope`) and the
 * `/ws` broadcaster envelope (`IWsEventEnvelope`), so the CLI forwards it
 * to `pushJobEvent` and the MCP tool forwards it to `broadcaster.broadcast`
 * with no adaptation.
 */
export interface IJobLifecycleEvent {
  type: 'job.completed' | 'job.failed' | 'job.submitted';
  timestamp: number;
  runId: string;
  jobId: string;
  data: Record<string, unknown>;
}

/**
 * Structured outcome of `recordJob`. The `completed` kind means the record
 * LANDED (the execution row may itself be `completed` OR `failed`, a
 * `--status failed` record still succeeds); the caller reads
 * `execution.status` to phrase its success line. `report-invalid` carries
 * the already-persisted failed execution + the validation detail; the
 * refusals (`nonce-mismatch` / `not-running` / `not-found` /
 * `schema-unresolved`) mutated nothing.
 */
export type TRecordOutcome =
  | { kind: 'completed'; execution: ExecutionRecord }
  | { kind: 'report-invalid'; execution: ExecutionRecord; detail: string }
  | { kind: 'schema-unresolved'; detail: string }
  | { kind: 'nonce-mismatch' }
  | { kind: 'not-running'; status: JobStatus | 'unknown' }
  | { kind: 'not-found' };

export interface IRecordJobOpts {
  adapter: StoragePort;
  /**
   * Lazily-resolved composed runtime. Invoked at most once, AFTER the
   * report parses (preserving the report-invalid-before-resolution
   * ordering) and reused by the auto-fix + tags legs. Memoise it in the
   * caller so the plugin runtime is discovered once per record.
   */
  getRuntime: () => Promise<IActionRuntime>;
  id: string;
  nonce: string;
  status: 'completed' | 'failed';
  /** Required for `status: 'completed'`; the raw agent report text. */
  reportText?: string;
  /** `status: 'failed'` reason (default `runner-error`). */
  failureReason?: ExecutionFailureReason;
  /** Verbatim free text stored on a failed execution (`--error`). */
  errorText?: string | null;
  metrics: IRecordMetrics;
  now: number;
  /** Shared run id stamped on every `onEvent` envelope this record emits. */
  runId: string;
  cwd: string;
  channel: TOperationChannel;
  /** Surface-specific live push: CLI wraps `pushJobEvent`, MCP broadcasts. */
  onEvent?: (event: IJobLifecycleEvent) => void | Promise<void>;
  /** A tagger record merged tags into the sidecar (human advisory hook). */
  onTagsApplied?: (tags: string[], nodeId: string) => void;
  /** A tagger record could not write tags for lack of standing consent. */
  onTagsConsentMissing?: (nodeId: string) => void;
}

/**
 * `job.completed` event data (`spec/job-events.md`): the job's frozen
 * extension identity plus the execution metrics, so a hook can filter to a
 * kind / extension. Shared by the live push and the CLI `--json` synthetic
 * envelope.
 */
export function buildCompletedEventData(
  execution: ExecutionRecord,
  job: Job,
  model: string | null,
): Record<string, unknown> {
  return {
    extensionId: job.extensionId,
    extensionKind: job.extensionKind,
    durationMs: execution.durationMs ?? null,
    tokensIn: execution.tokensIn ?? null,
    tokensOut: execution.tokensOut ?? null,
    model,
    executionId: execution.id,
  };
}

/**
 * `job.failed` event data (`spec/job-events.md`). `message` defaults to the
 * agent-reported `errorText`; the report-invalid push overrides it with the
 * schema-validation detail.
 */
export function buildFailedEventData(
  execution: ExecutionRecord,
  errorText: string | null,
  message?: string,
): Record<string, unknown> {
  return {
    reason: execution.failureReason ?? null,
    message: message ?? errorText ?? null,
    exitCode: execution.exitCode ?? null,
    durationMs: execution.durationMs ?? null,
  };
}

/**
 * Close a running job: authenticate the nonce, verify the running state,
 * then route to the completed / failed path. Nonce / state refusals return
 * structured values (no throw); a lost record race (the job left `running`
 * between the pre-check and the record transaction) is mapped to the same
 * `not-running` outcome as the pre-check.
 */
export async function recordJob(opts: IRecordJobOpts): Promise<TRecordOutcome> {
  const job = await opts.adapter.jobs.get(opts.id);
  if (!job) return { kind: 'not-found' };
  if (job.nonce !== opts.nonce) return { kind: 'nonce-mismatch' };
  if (job.status !== 'running') return { kind: 'not-running', status: job.status };
  return runRecordTransaction(opts, job);
}

/**
 * Route to the completed / failed path and map the lost-record race (the
 * job left `running` between the pre-check and the record transaction; the
 * storage guard rolled everything back) to the same `not-running` outcome.
 */
async function runRecordTransaction(opts: IRecordJobOpts, job: Job): Promise<TRecordOutcome> {
  try {
    return opts.status === 'completed'
      ? await recordCompletedPath(opts, job)
      : await recordFailedPath(opts, job);
  } catch (err) {
    if (!(err instanceof JobNotRunningError)) throw err;
    const fresh = await opts.adapter.jobs.get(opts.id);
    return { kind: 'not-running', status: fresh?.status ?? 'unknown' };
  }
}

/** Emit one job-lifecycle envelope through the caller's `onEvent`, if any. */
async function emit(
  opts: IRecordJobOpts,
  event: Omit<IJobLifecycleEvent, 'timestamp' | 'runId'>,
): Promise<void> {
  await opts.onEvent?.({ ...event, timestamp: Date.now(), runId: opts.runId });
}

/** The `--status completed` path (`spec/job-lifecycle.md` §Record steps 4-6). */
async function recordCompletedPath(opts: IRecordJobOpts, job: Job): Promise<TRecordOutcome> {
  const outcome = await recordCompletedOutcome({
    adapter: opts.adapter,
    job,
    reportText: opts.reportText ?? '',
    // Kind-strict resolution against the job row's frozen extension kind.
    resolve: async () =>
      resolveExtensionRecord(await opts.getRuntime(), job.extensionId, job.extensionKind),
    metrics: opts.metrics,
    now: opts.now,
  });

  if (outcome.kind === 'schema-unresolved') return outcome; // no mutation
  if (outcome.kind === 'report-invalid') {
    // The failed / report-invalid transition already landed; emit its live
    // hint before surfacing (no ops-log line, mirrors the CLI).
    await emit(opts, {
      type: 'job.failed',
      jobId: job.id,
      data: buildFailedEventData(outcome.execution, opts.errorText ?? null, outcome.detail),
    });
    return { kind: 'report-invalid', execution: outcome.execution, detail: outcome.detail };
  }

  // The record committed: push job.completed BEFORE the hook chain so a
  // connected server sees the completion ahead of any chained fixer's
  // job.submitted (spec/job-events.md §Transport).
  await emit(opts, {
    type: 'job.completed',
    jobId: job.id,
    data: buildCompletedEventData(outcome.execution, job, opts.metrics.model ?? null),
  });
  appendOperation(opts.cwd, {
    op: 'jobs.record',
    target: job.nodeId,
    extension: job.extensionId,
    channel: opts.channel,
    outcome: 'completed',
    id: job.id,
  });
  await chainAutoFix(opts, job);
  await applyTagsWriteThrough(opts, job, outcome.execution);
  return { kind: 'completed', execution: outcome.execution };
}

/** The `--status failed` path (reason `runner-error` by default). */
async function recordFailedPath(opts: IRecordJobOpts, job: Job): Promise<TRecordOutcome> {
  const execution = await recordFailedOutcome({
    adapter: opts.adapter,
    job,
    failureReason: opts.failureReason ?? 'runner-error',
    errorText: opts.errorText ?? null,
    metrics: opts.metrics,
    now: opts.now,
  });
  await emit(opts, {
    type: 'job.failed',
    jobId: job.id,
    data: buildFailedEventData(execution, opts.errorText ?? null),
  });
  appendOperation(opts.cwd, {
    op: 'jobs.record',
    target: job.nodeId,
    extension: job.extensionId,
    channel: opts.channel,
    outcome: 'failed',
    id: job.id,
  });
  return { kind: 'completed', execution };
}

// ---------------------------------------------------------------------------
// Auto-fix chain (moved verbatim from `cli/commands/record.ts`)
// ---------------------------------------------------------------------------

/**
 * Chain the finder -> fixer auto-fix after a completed finder record, from
 * its TWO independent entry points (the per-job `auto_fix` flag frozen at
 * submit AND any enabled `job.completed` hook), while the record's DB
 * handle is still open. Entirely best-effort: ANY failure leaves the
 * recorded job completed and never changes the outcome (hooks react, they
 * do not steer the pipeline).
 */
async function chainAutoFix(opts: IRecordJobOpts, job: Job): Promise<void> {
  try {
    const runtime = await opts.getRuntime();
    const actions = projectHookActions(runtime.actions);
    const requests = new Map<string, { actionId: string; nodeId: string }>();
    const add = (actionId: string, nodeId: string): void => {
      if (nodeId.length > 0) requests.set(`${actionId}\n${nodeId}`, { actionId, nodeId });
    };
    // Per-job branch: a flagged finder chains its fixers even when the
    // global hook is disabled.
    if (job.autoFix && job.extensionKind === 'analyzer') {
      for (const fixerId of resolveMatchingFixerIds(job.extensionId, actions)) {
        add(fixerId, job.nodeId);
      }
    }
    // Hook branch: only touches the DB when something subscribes.
    await collectHookQueued(opts.adapter, job, runtime, actions, add);
    if (requests.size === 0) return;
    const jobsConfig = loadConfig({ cwd: opts.cwd }).effective.jobs;
    await drainFixerSubmits(opts, runtime, jobsConfig, [...requests.values()]);
  } catch {
    // Hooks never block the pipeline (spec §Hook).
  }
}

/**
 * Dispatch `job.completed` to the composed (enabled) hooks and feed every
 * fixer they `ctx.queue` into `add`. A no-op (and no DB read) when nothing
 * subscribes to `job.completed`.
 */
async function collectHookQueued(
  adapter: StoragePort,
  job: Job,
  runtime: IActionRuntime,
  actions: IHookActionInfo[],
  add: (actionId: string, nodeId: string) => void,
): Promise<void> {
  if (!runtime.hooks.some((hook) => hook.triggers.includes('job.completed'))) return;
  const bundle = await adapter.scans.findNode(job.nodeId);
  const dispatcher = makeHookDispatcher(runtime.hooks, silentEmitter(), {
    queue: (actionId, payload) => {
      const nodeId = (payload as { nodeId?: unknown } | undefined)?.nodeId;
      if (typeof nodeId === 'string') add(actionId, nodeId);
    },
    actions,
  });
  await dispatcher.dispatch('job.completed', {
    type: 'job.completed',
    timestamp: Date.now(),
    jobId: job.id,
    data: {
      extensionId: job.extensionId,
      extensionKind: job.extensionKind,
      ...(bundle ? { node: bundle.node } : {}),
    },
  });
}

/**
 * Shared fixer-submit sink for BOTH auto-fix entry points: for each
 * `(fixerId, nodeId)` request submit the fixer through the SAME
 * `submitFixerJob` path the CLI uses (full render, findings injection,
 * supersede, drift verification) and, on a real created job, emit its
 * `job.submitted` live hint under this record run's id. A no-findings /
 * drift / duplicate refusal is swallowed (nothing to fix is not an error);
 * a hard throw is caught too. Cannot fail the record.
 */
async function drainFixerSubmits(
  opts: IRecordJobOpts,
  runtime: IActionRuntime,
  jobsConfig: IJobsConfig,
  requests: readonly { actionId: string; nodeId: string }[],
): Promise<void> {
  for (const request of requests) {
    try {
      const result = await submitFixerJob(opts.adapter, runtime, jobsConfig, {
        extensionId: request.actionId,
        nodeId: request.nodeId,
        cwd: opts.cwd,
      });
      if (result.kind === 'created') {
        await emit(opts, {
          type: 'job.submitted',
          jobId: result.id,
          data: {
            nodePath: request.nodeId,
            extensionId: request.actionId,
            supersededIds: [...result.supersededIds],
          },
        });
      }
    } catch {
      // best-effort: a fixer submit failure never fails the record.
    }
  }
}

/**
 * Project the composed Actions to the minimal `IHookActionInfo[]` a hook
 * resolves the inverse of Modelo B against (qualified id + declared
 * `precondition.analyzerIds`).
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
 * record path must NOT write anything to stdout.
 */
function silentEmitter(): ProgressEmitterPort {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  return { emit: () => {} } as unknown as ProgressEmitterPort;
}

// ---------------------------------------------------------------------------
// Tags write-through (moved verbatim from `cli/commands/record.ts`)
// ---------------------------------------------------------------------------

/**
 * Merge a completed TAGGER report's `tags[]` into the node's sidecar
 * `annotations.tags` via the gated `.sm` channel, then refresh the mirror.
 * Honours the STANDING consent only: a missing grant surfaces a
 * `onTagsConsentMissing` advisory and applies nothing (the report still
 * carries the tags). Every other failure is swallowed (best-effort).
 */
async function applyTagsWriteThrough(
  opts: IRecordJobOpts,
  job: Job,
  execution: ExecutionRecord,
): Promise<void> {
  try {
    const tags = taggerReportTags(await opts.getRuntime(), job, execution);
    if (tags.length === 0) return;
    const merged = await writeMergedTags(opts.adapter, job.nodeId, tags, opts.cwd);
    if (merged === null) return;
    opts.onTagsApplied?.(merged, job.nodeId);
  } catch (err) {
    if (err instanceof EConsentRequiredError) {
      opts.onTagsConsentMissing?.(job.nodeId);
    }
    // Best-effort: the record's success never depends on the apply.
  }
}

/**
 * The tags a completed TAGGER report wants applied, or `[]` when the
 * recorded extension is not a tagger (kind, schema namespace) or the report
 * carries no usable tags.
 */
function taggerReportTags(runtime: IActionRuntime, job: Job, execution: ExecutionRecord): string[] {
  const resolution = resolveExtensionRecord(runtime, job.extensionId, job.extensionKind);
  if (!resolution.ok || resolution.record.extensionKind !== 'action') return [];
  if (!isTagsReportSchema(resolution.record.schema)) return [];
  return reportTags(execution.reportPath ?? null);
}

/**
 * Merge `tags` into the node's sidecar `annotations.tags` through the gated
 * `.sm` channel (standing consent only), refresh the mirror, and return the
 * merged list. `null` = nothing written (a brand-new sidecar with no live
 * scan node to source the identity from). Consent failures propagate as
 * `EConsentRequiredError`.
 */
async function writeMergedTags(
  adapter: StoragePort,
  nodeId: string,
  tags: readonly string[],
  cwd: string,
): Promise<string[] | null> {
  const mdAbs = resolvePath(cwd, nodeId);
  const read = readSidecarFor(mdAbs);
  const merged = mergeTagLists(existingTags(read.parsed?.annotations), tags);
  const changes: Record<string, unknown> = { annotations: { tags: merged } };
  if (read.parsed === null) {
    const bundle = await adapter.scans.findNode(nodeId);
    if (!bundle) return null;
    changes['identity'] = {
      path: bundle.node.path,
      bodyHash: bundle.node.bodyHash,
      frontmatterHash: bundle.node.frontmatterHash,
    };
  }
  const store = new FilesystemSidecarStore(ensureSidecarWritesAllowed);
  await store.applyPatch(sidecarPathFor(mdAbs), changes, { confirm: false, always: false, cwd });
  await adapter.scans.refreshAnnotations(nodeId, readSidecarFor(mdAbs).parsed?.annotations ?? null);
  return merged;
}

/** Parse the recorded report JSON and extract a clean `tags[]`. */
function reportTags(reportJson: string | null): string[] {
  if (reportJson === null) return [];
  try {
    const parsed = JSON.parse(reportJson) as { tags?: unknown };
    if (!Array.isArray(parsed.tags)) return [];
    return parsed.tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0);
  } catch {
    return [];
  }
}

/** The sidecar's current `annotations.tags`, defensively read. */
function existingTags(annotations: Record<string, unknown> | null | undefined): string[] {
  const raw = annotations?.['tags'];
  return Array.isArray(raw) ? raw.filter((t): t is string => typeof t === 'string') : [];
}

/**
 * Union merge (spec §Tags write-through): existing entries first in their
 * order, new tags appended, case-insensitive dedup.
 */
function mergeTagLists(existing: readonly string[], incoming: readonly string[]): string[] {
  const seen = new Set(existing.map((t) => t.toLowerCase()));
  const merged = [...existing];
  for (const tag of incoming) {
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(tag);
  }
  return merged;
}

// Re-export so a caller that needs a fresh ext-mode run id (the CLI shares
// one across the push leg + the synthetic envelope) has one import site.
export { generateRunId };
