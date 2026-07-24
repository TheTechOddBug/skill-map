/**
 * The MCP queue tools (see `spec/mcp-server.md` §Queue tools), registered
 * whenever the MCP server is on (`mcp.server.enabled`, unified 2026-07-23).
 * They wrap the SAME shared job engines the CLI verbs (`sm jobs *`,
 * `sm record`) and the BFF routes use, they add no new queue semantics:
 *
 *   - `list_extensions`        -> DISCOVERY: the enabled probabilistic
 *                                 extensions submit_job accepts (finders /
 *                                 fixers / standalone), composed read.
 *   - `list_jobs` / `get_job`  -> reads projected through `toPublicJob`
 *                                 (the nonce is stripped, spec §Nonce
 *                                 exposure).
 *   - `submit_job`             -> the `no-processing-agent` gate +
 *                                 `prepareSubmitContext` + `submitOneJob`
 *                                 (mirror of `routes/node-jobs.ts`).
 *   - `claim_job`              -> the `claimJob` engine (the one tool that
 *                                 returns the nonce, so the client can
 *                                 `record_job`).
 *   - `record_job`            -> the `recordJob` engine.
 *   - `cancel_job` / `fail_job` -> the adapter transition primitives.
 *
 * WRITE POSTURE: every mutating tool opens the DB with the WRITE posture
 * (`tryWithSqlite` with NO `versionCheck`), so a drifted / stale on-disk
 * schema refuses the write (`DbSchemaDriftError`) rather than silently
 * mutating it, the same posture as the REST mutating routes. Reads keep the
 * advisory `bffReadVersionCheck`. Every mutating tool appends one
 * operations-log line with `channel: 'mcp'` and broadcasts its
 * job-lifecycle event over the one `/ws` broadcaster (a live UI / MCP
 * subscriber sees the transition without a poll).
 *
 * The executors are exported un-wrapped (returning the raw structured
 * result) so unit tests assert their shapes without booting a transport;
 * `registerMcpQueueTools` wraps each into a `CallToolResult`.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ErrorCode, McpError, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { processingSkillPresence } from '../../core/agent-skill/targets.js';
import { buildActionRuntime, type IActionRuntime } from '../../core/jobs/action-runtime.js';
import { claimJob, type TClaimOutcome } from '../../core/jobs/claim-engine.js';
import { generateRunId } from '../../core/jobs/record-engine.js';
import { recordJob } from '../../core/jobs/record-engine.js';
import {
  fixerAnalyzerIds,
  prepareSubmitContext,
  submitOneJob,
  type ISubmitContext,
  type TPrepareError,
  type TSubmitOutcome,
} from '../../core/jobs/submit-engine.js';
import { isProbabilistic } from '../../kernel/jobs/index.js';
import { qualifiedExtensionId } from '../../kernel/registry.js';
import { isLockedBuiltIn } from '../../plugins/locked-built-ins.js';
import { appendOperation } from '../../core/operations-log.js';
import { buildFreshResolver } from '../../core/runtime/fresh-resolver.js';
import { tryWithSqlite } from '../../core/sqlite/with-sqlite.js';
import { loadConfig } from '../../kernel/config/loader.js';
import {
  toPublicJob,
  type PublicJob,
} from '../../kernel/jobs/index.js';
import type { StoragePort } from '../../kernel/ports/storage.js';
import type {
  ExecutionFailureReason,
  JobRunner,
  JobStatus,
  Node,
} from '../../kernel/types.js';
import type { IJobListFilter } from '../../kernel/types/storage.js';
import { bffReadVersionCheck } from '../util/db-read-check.js';
import { buildJobCancelledEvent, buildJobSubmittedEvent } from '../events.js';
import type { IMcpWriteContext } from './context.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Open the project DB with the WRITE posture (no `versionCheck`, so a
 * drifted schema refuses via `DbSchemaDriftError`). A missing DB file
 * short-circuits `tryWithSqlite` to `null`; surface it as an invalid-params
 * error (there is no project to operate on).
 */
async function withWriteDb<T>(
  ctx: IMcpWriteContext,
  fn: (adapter: StoragePort) => Promise<T>,
): Promise<T> {
  const result = await tryWithSqlite({ databasePath: ctx.dbPath, autoBackup: false }, fn);
  if (result === null) {
    throw new McpError(ErrorCode.InvalidParams, `Project database not found: ${ctx.dbPath}`);
  }
  return result;
}

/**
 * Build a fresh action runtime from the boot-cached plugin runtime against
 * a per-call enabled resolver from the LIVE layered config (mirror of
 * `routes/node-jobs.ts`), so a plugin toggled mid-session is submittable /
 * recordable without an `sm serve` restart.
 */
async function buildMcpRuntime(ctx: IMcpWriteContext): Promise<IActionRuntime> {
  const resolveEnabled = await buildFreshResolver({
    effectiveConfig: () => loadConfig({ cwd: ctx.cwd }).effective,
  });
  return buildActionRuntime(
    ctx.pluginRuntime,
    () => {
      /* discard: plugin warnings are emitted once at server boot */
    },
    undefined,
    resolveEnabled,
  );
}

// ---------------------------------------------------------------------------
// list_extensions
// ---------------------------------------------------------------------------

/** One submittable probabilistic extension (the discovery shape). */
export interface IMcpExtensionInfo {
  /** Qualified id (`<plugin>/<extension>`), the value `submit_job` accepts. */
  id: string;
  /** Extension kind: `analyzer` (a finder) or `action` (a fixer / standalone). */
  kind: 'analyzer' | 'action';
  /**
   * Coarse role for the agent: `finder` (probabilistic analyzer, emits
   * findings), `fixer` (action resolving a finder's findings, carries
   * `analyzerIds`), or `standalone` (action with no `analyzerIds`).
   */
  role: 'finder' | 'fixer' | 'standalone';
  /** Manifest description (what it judges / does). */
  description: string;
  /** For a fixer: the qualified analyzer ids whose findings it resolves. */
  analyzerIds?: readonly string[];
}

export interface IListExtensionsResult {
  extensions: IMcpExtensionInfo[];
}

/**
 * Discovery gate for `list_extensions`: a probabilistic extension that is
 * NOT a hidden system (`locked`) one. Locked extensions (e.g. the
 * `core/ai-ping-action` liveness probe) are never offered as submittable
 * capabilities, the platform enqueues them by id and claims / records them
 * directly, so they stay out of the agent-facing catalog.
 */
function isDiscoverableProbabilistic(
  ext: Parameters<typeof isProbabilistic>[0],
  qualifiedId: string,
): boolean {
  return isProbabilistic(ext) && !isLockedBuiltIn(qualifiedId);
}

/**
 * List every ENABLED probabilistic extension the agent can pass to
 * `submit_job` (finders = probabilistic analyzers; fixers / standalone =
 * probabilistic actions), so the valid extension ids are DISCOVERABLE over
 * MCP instead of guessed. Composed from the live enabled runtime, so a
 * plugin toggled mid-session shows up without a serve restart. Read-only.
 */
export async function listExtensions(ctx: IMcpWriteContext): Promise<IListExtensionsResult> {
  const runtime = await buildMcpRuntime(ctx);
  const extensions: IMcpExtensionInfo[] = [];
  for (const analyzer of runtime.analyzers) {
    const id = qualifiedExtensionId(analyzer.pluginId, analyzer.id);
    if (!isDiscoverableProbabilistic(analyzer, id)) continue;
    extensions.push({
      id,
      kind: 'analyzer',
      role: 'finder',
      description: analyzer.description,
    });
  }
  for (const action of runtime.actions) {
    const id = qualifiedExtensionId(action.pluginId, action.id);
    if (!isDiscoverableProbabilistic(action, id)) continue;
    const analyzerIds = fixerAnalyzerIds('action', action);
    extensions.push({
      id,
      kind: 'action',
      role: analyzerIds !== undefined ? 'fixer' : 'standalone',
      description: action.description,
      ...(analyzerIds !== undefined ? { analyzerIds } : {}),
    });
  }
  extensions.sort((a, b) => a.id.localeCompare(b.id));
  return { extensions };
}

// ---------------------------------------------------------------------------
// list_jobs
// ---------------------------------------------------------------------------

export const listJobsInputShape = {
  status: z.string().optional().describe('Job-status filter (queued / running / completed / failed / cancelled).'),
  extension: z.string().optional().describe('Qualified or bare extension id.'),
  node: z.string().optional().describe('Node path (its stable id).'),
};

export interface IListJobsArgs {
  status?: string | undefined;
  extension?: string | undefined;
  node?: string | undefined;
}

/** The live queue, nonce stripped (spec §Nonce exposure). Absent DB -> `[]`. */
export async function listJobs(
  ctx: IMcpWriteContext,
  args: IListJobsArgs,
): Promise<{ items: PublicJob[] }> {
  const filter: IJobListFilter = {};
  if (args.status !== undefined) filter.status = args.status as JobStatus;
  if (args.extension !== undefined) filter.extensionId = args.extension;
  if (args.node !== undefined) filter.nodeId = args.node;
  const jobs = await tryWithSqlite(
    { databasePath: ctx.dbPath, autoBackup: false, versionCheck: bffReadVersionCheck() },
    (adapter) => adapter.jobs.list(filter),
  );
  return { items: (jobs ?? []).map(toPublicJob) };
}

// ---------------------------------------------------------------------------
// get_job
// ---------------------------------------------------------------------------

export const getJobInputShape = {
  id: z.string().describe('Job id.'),
};

export interface IGetJobArgs {
  id: string;
}

/** One job by id, nonce stripped. Unknown id (or absent DB) -> `-32602`. */
export async function getJob(
  ctx: IMcpWriteContext,
  args: IGetJobArgs,
): Promise<{ item: PublicJob }> {
  const job = await tryWithSqlite(
    { databasePath: ctx.dbPath, autoBackup: false, versionCheck: bffReadVersionCheck() },
    (adapter) => adapter.jobs.get(args.id),
  );
  if (!job) throw new McpError(ErrorCode.InvalidParams, `Unknown job id: ${args.id}`);
  return { item: toPublicJob(job) };
}

// ---------------------------------------------------------------------------
// submit_job
// ---------------------------------------------------------------------------

export const submitJobInputShape = {
  node: z.string().describe('Target node path (its stable id).'),
  extension: z.string().describe('Qualified or bare probabilistic extension id.'),
  autoFix: z.boolean().optional().describe('Freeze the finder submit so record chains its fixers (finder targets only).'),
  findingIds: z.array(z.number().int().positive()).optional().describe('Finding-subset targeting for a findings-branch fixer.'),
  force: z.boolean().optional().describe('Skip the duplicate pre-check (never defeats the unique index).'),
  ttl: z.number().int().optional().describe('Arm an expiry (seconds); 0 disarms any config policy.'),
  priority: z.number().int().optional().describe('Scheduling priority (higher wins).'),
};

export interface ISubmitJobArgs {
  node: string;
  extension: string;
  autoFix?: boolean | undefined;
  findingIds?: number[] | undefined;
  force?: boolean | undefined;
  ttl?: number | undefined;
  priority?: number | undefined;
}

export type TSubmitJobResult =
  | { outcome: 'created'; jobId: string; nodePath: string; supersededIds: string[] }
  | { outcome: 'duplicate'; existingId: string }
  | { outcome: 'job-running'; existingId: string }
  | { outcome: 'drift' }
  | { outcome: 'unreadable'; detail: string }
  | { outcome: 'no-findings' };

/**
 * Enqueue a probabilistic extension against one node through the shared
 * submit machinery. The `no-processing-agent` gate applies (decision
 * 2026-07-23): a queue nothing ever claims refuses before any work is
 * staged. Prepare failures + unknown node / virtual node surface as
 * `McpError`; the DB-half refusals (duplicate / running / drift /
 * unreadable / no-findings) return as structured results.
 */
export async function submitJob(
  ctx: IMcpWriteContext,
  args: ISubmitJobArgs,
): Promise<TSubmitJobResult> {
  // Processing-agent gate FIRST (spec §Submit): consistency with the CLI /
  // BFF operator surfaces.
  if (!processingSkillPresence(ctx.cwd).installed) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'No processing skill is installed in this project (run `sm agent install`); the submitted job would never be claimed.',
    );
  }

  const runtime = await buildMcpRuntime(ctx);
  const prep = prepareSubmitContext({
    runtime,
    jobs: loadConfig({ cwd: ctx.cwd }).effective.jobs,
    extensionId: args.extension,
    cwd: ctx.cwd,
    force: args.force ?? false,
    flagTtl: args.ttl,
    flagPriority: args.priority,
    autoFix: args.autoFix ?? false,
    ...(args.findingIds !== undefined ? { findingIds: args.findingIds } : {}),
  });
  if (!prep.ok) throw prepareErrorToMcp(prep.error, args.extension);

  const result = await withWriteDb(ctx, (adapter) =>
    submitAgainstNode(adapter, args.node, prep.prepared),
  );

  if (result.outcome === 'created') {
    appendOperation(ctx.cwd, {
      op: 'jobs.submit',
      target: result.nodePath,
      extension: prep.prepared.extensionId,
      channel: 'mcp',
      outcome: 'queued',
      id: result.jobId,
    });
    ctx.broadcaster.broadcast(
      buildJobSubmittedEvent(result.jobId, {
        nodePath: result.nodePath,
        extensionId: prep.prepared.extensionId,
        supersededIds: result.supersededIds,
      }),
    );
  }
  return result;
}

/**
 * Resolve the node and run the shared submit engine inside the write open,
 * mirroring the CLI single-target path + the BFF route. Missing / virtual
 * node -> `McpError`; a duplicate reads the covering job's live status to
 * split `duplicate` from `job-running`.
 */
async function submitAgainstNode(
  adapter: StoragePort,
  nodePath: string,
  prepared: ISubmitContext,
): Promise<TSubmitJobResult> {
  const bundle = await adapter.scans.findNode(nodePath);
  if (!bundle) throw new McpError(ErrorCode.InvalidParams, `Unknown node path: ${nodePath}`);
  if (isVirtual(bundle.node)) {
    throw new McpError(ErrorCode.InvalidParams, `Node is virtual (not submittable): ${nodePath}`);
  }
  const outcome = await submitOneJob(adapter, bundle.node, prepared);
  return mapSubmitOutcome(adapter, outcome, nodePath);
}

async function mapSubmitOutcome(
  adapter: StoragePort,
  outcome: TSubmitOutcome,
  nodePath: string,
): Promise<TSubmitJobResult> {
  switch (outcome.kind) {
    case 'created':
      return { outcome: 'created', jobId: outcome.id, nodePath, supersededIds: outcome.supersededIds };
    case 'duplicate':
      return mapDuplicate(adapter, outcome.existingId);
    case 'drift':
      return { outcome: 'drift' };
    case 'unreadable':
      return { outcome: 'unreadable', detail: outcome.detail };
    case 'no-findings':
      return { outcome: 'no-findings' };
  }
}

/**
 * The engine folds the fixer running-conflict into `duplicate`; read the
 * covering job's live status to split `job-running` from `duplicate`.
 */
async function mapDuplicate(adapter: StoragePort, existingId: string): Promise<TSubmitJobResult> {
  const existing = await adapter.jobs.get(existingId);
  const running = (existing?.status ?? 'queued') === 'running';
  return running ? { outcome: 'job-running', existingId } : { outcome: 'duplicate', existingId };
}

function isVirtual(node: Node): boolean {
  return node.virtual === true;
}

/**
 * Map a `prepareSubmitContext` failure to a JSON-RPC invalid-params error
 * (unknown extension -> its own message; everything else -> a `bad-query`
 * flavour). Lookup-shaped so the catalog grows without a complexity spike.
 */
const PREPARE_ERROR_TO_MCP: {
  [K in TPrepareError['kind']]: (error: Extract<TPrepareError, { kind: K }>, extension: string) => string;
} = {
  'not-found': (_e, extension) => `Unknown extension: ${extension}`,
  deterministic: (e, extension) => `Extension is not probabilistic (mode ${e.mode}): ${extension}`,
  ambiguous: (e, extension) =>
    `Ambiguous extension id ${extension} (action ${e.actionId} vs analyzer ${e.analyzerId}); qualify it.`,
  'prompt-unresolved': (e, extension) => `Prompt template unresolved for ${extension}: ${e.detail}`,
  'report-schema-unresolved': (e, extension) => `Report schema unresolved for ${extension}: ${e.detail}`,
  'finding-ids-unsupported': (_e, extension) => `findingIds is not supported on this target: ${extension}`,
  'invalid-ttl': (e) => e.message,
  'invalid-priority': (e) => e.message,
};

function prepareErrorToMcp(error: TPrepareError, extension: string): McpError {
  const message = (PREPARE_ERROR_TO_MCP[error.kind] as (e: TPrepareError, ext: string) => string)(
    error,
    extension,
  );
  return new McpError(ErrorCode.InvalidParams, message);
}

// ---------------------------------------------------------------------------
// claim_job
// ---------------------------------------------------------------------------

/**
 * Hard cap on the server-side blocking window (1 hour). A client may ask
 * for a longer `wait`, but the tool never parks a response beyond this.
 */
const MAX_CLAIM_WAIT_SECONDS = 3600;

/**
 * Re-attempt cadence while long-polling: sleep this long OUTSIDE any open
 * DB handle, then open a fresh `withWriteDb` for the next claim attempt.
 * Mirrors the CLI's `DEFAULT_CLAIM_WAIT_SECONDS = 2` poll cadence.
 */
const CLAIM_WAIT_POLL_INTERVAL_MS = 2000;

export const claimJobInputShape = {
  runner: z.string().optional().describe('Runner label stamped on the claim (default "agent").'),
  filter: z.string().optional().describe('Restrict the claim to one extension id.'),
  wait: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Long-poll up to N seconds (server-side blocking claim): the tool holds the response until a job is claimable or the window elapses, so an MCP client can PARK on one call instead of polling. Omit for a single immediate attempt. Set the MCP client tool timeout >= this value.',
    ),
};

export interface IClaimJobArgs {
  runner?: string | undefined;
  filter?: string | undefined;
  wait?: number | undefined;
}

export interface IClaimJobResult {
  id: string;
  nonce: string;
  content: string;
}

/**
 * Atomic claim over the shared `claimJob` engine (reap-first, corruption
 * handling). Empty queue -> `null`. A claimed job broadcasts `job.claimed`
 * and returns `{ id, nonce, content }` (the nonce lets the client
 * `record_job`). A corrupt (missing-content) job is failed by the engine
 * and surfaces as an `McpError`.
 */
export async function claimJobTool(
  ctx: IMcpWriteContext,
  args: IClaimJobArgs,
): Promise<IClaimJobResult | null> {
  const runner: JobRunner = args.runner === 'in-process' ? 'in-process' : 'agent';
  // The engine outcome is mapped OUTSIDE `withWriteDb`: an empty queue must
  // return `null` to the caller, but returning `null` from the DB callback
  // is indistinguishable from a missing-DB short-circuit.
  const outcome = await claimWithOptionalWait(ctx, runner, args.filter, args.wait);
  if (outcome.kind === 'empty') return null;
  if (outcome.kind === 'corrupt') {
    throw new McpError(
      ErrorCode.InternalError,
      `Claimed job ${outcome.jobId} has no stored content; it was marked failed (job-file-missing).`,
    );
  }
  ctx.broadcaster.broadcast({
    type: 'job.claimed',
    timestamp: Date.now(),
    runId: generateRunId('ext'),
    jobId: outcome.job.id,
    data: {
      extensionId: outcome.job.extensionId,
      extensionVersion: outcome.job.extensionVersion,
      nodeId: outcome.job.nodeId,
      ttlSeconds: outcome.job.ttlSeconds,
      priority: outcome.job.priority,
    },
  });
  return { id: outcome.id, nonce: outcome.nonce, content: outcome.content };
}

/** Resolve after `ms` (the long-poll pause between claim attempts). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One immediate claim attempt, optionally followed by a server-side
 * blocking long-poll when the first attempt is `empty` and `waitSeconds`
 * is set. Each attempt opens a FRESH `withWriteDb`, and the `sleep()`
 * between attempts happens OUTSIDE any open DB handle, so the long-poll
 * never holds a sqlite write lock across the wait. `waitSeconds` is capped
 * at `MAX_CLAIM_WAIT_SECONDS`; `pollIntervalMs` is injectable for tests
 * (never exposed on the tool input shape).
 */
export async function claimWithOptionalWait(
  ctx: IMcpWriteContext,
  runner: JobRunner,
  filter: string | undefined,
  waitSeconds: number | undefined,
  pollIntervalMs: number = CLAIM_WAIT_POLL_INTERVAL_MS,
): Promise<TClaimOutcome> {
  const attempt = (): Promise<TClaimOutcome> =>
    withWriteDb(ctx, (adapter) => claimJob(adapter, { runner, nowMs: Date.now(), filter }));

  const first = await attempt();
  if (first.kind !== 'empty' || !waitSeconds) return first;

  const deadline = Date.now() + Math.min(waitSeconds, MAX_CLAIM_WAIT_SECONDS) * 1000;
  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);
    const next = await attempt();
    if (next.kind !== 'empty') return next;
  }
  return { kind: 'empty' };
}

// ---------------------------------------------------------------------------
// record_job
// ---------------------------------------------------------------------------

export const recordJobInputShape = {
  id: z.string().describe('Job id.'),
  nonce: z.string().describe('The claim nonce (the sole credential, from claim_job).'),
  status: z.enum(['completed', 'failed']).describe('Terminal transition.'),
  report: z.string().optional().describe('Agent report JSON text (required for completed).'),
  failureReason: z.string().optional().describe('Failure reason for a failed record (default runner-error).'),
  tokensIn: z.number().int().nonnegative().optional(),
  tokensOut: z.number().int().nonnegative().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  model: z.string().optional().describe('Agent self-declared model id (unverifiable).'),
};

export interface IRecordJobArgs {
  id: string;
  nonce: string;
  status: 'completed' | 'failed';
  report?: string | undefined;
  failureReason?: string | undefined;
  tokensIn?: number | undefined;
  tokensOut?: number | undefined;
  durationMs?: number | undefined;
  model?: string | undefined;
}

export type TRecordJobResult =
  | { outcome: 'completed'; executionId: string }
  | { outcome: 'report-invalid'; detail: string }
  | { outcome: 'schema-unresolved'; detail: string }
  | { outcome: 'nonce-mismatch' }
  | { outcome: 'not-running'; status: JobStatus | 'unknown' }
  | { outcome: 'not-found' };

/**
 * Close a running job over the shared `recordJob` engine (nonce + running
 * gate, completed / failed transition, auto-fix chain + tags write-through,
 * ops-log with `channel: 'mcp'`). The engine's job-lifecycle events
 * broadcast directly (in-process, like a BFF route). `report` is required
 * for the completed path.
 */
export async function recordJobTool(
  ctx: IMcpWriteContext,
  args: IRecordJobArgs,
): Promise<TRecordJobResult> {
  if (args.status === 'completed' && args.report === undefined) {
    throw new McpError(ErrorCode.InvalidParams, 'A completed record requires the `report` JSON text.');
  }
  const runId = generateRunId('ext');
  let runtimeMemo: IActionRuntime | undefined;
  const getRuntime = async (): Promise<IActionRuntime> =>
    (runtimeMemo ??= await buildMcpRuntime(ctx));

  return withWriteDb(ctx, async (adapter) => {
    const outcome = await recordJob({
      adapter,
      getRuntime,
      id: args.id,
      nonce: args.nonce,
      status: args.status,
      ...(args.report !== undefined ? { reportText: args.report } : {}),
      ...(args.failureReason !== undefined
        ? { failureReason: args.failureReason as ExecutionFailureReason }
        : {}),
      metrics: {
        tokensIn: args.tokensIn,
        tokensOut: args.tokensOut,
        durationMs: args.durationMs,
        model: args.model ?? null,
      },
      now: Date.now(),
      runId,
      cwd: ctx.cwd,
      channel: 'mcp',
      onEvent: (event) => ctx.broadcaster.broadcast(event),
    });
    return mapRecordOutcome(outcome);
  });
}

function mapRecordOutcome(
  outcome: Awaited<ReturnType<typeof recordJob>>,
): TRecordJobResult {
  switch (outcome.kind) {
    case 'completed':
      return { outcome: 'completed', executionId: outcome.execution.id };
    case 'report-invalid':
      return { outcome: 'report-invalid', detail: outcome.detail };
    case 'schema-unresolved':
      return { outcome: 'schema-unresolved', detail: outcome.detail };
    case 'nonce-mismatch':
      return { outcome: 'nonce-mismatch' };
    case 'not-running':
      return { outcome: 'not-running', status: outcome.status };
    case 'not-found':
      return { outcome: 'not-found' };
  }
}

// ---------------------------------------------------------------------------
// cancel_job / fail_job
// ---------------------------------------------------------------------------

export const cancelJobInputShape = { id: z.string().describe('Job id.') };
export const failJobInputShape = { id: z.string().describe('Job id.') };

export interface ITransitionArgs {
  id: string;
}

export type TCancelJobResult = { outcome: 'cancelled' | 'already-terminal' | 'not-found' };
export type TFailJobResult = { outcome: 'failed' | 'already-terminal' | 'not-found' };

/** Move a queued / running job to terminal `cancelled` (never interrupts a running agent). */
export async function cancelJob(
  ctx: IMcpWriteContext,
  args: ITransitionArgs,
): Promise<TCancelJobResult> {
  return withWriteDb(ctx, async (adapter) => {
    const outcome = await adapter.jobs.cancel(args.id, Date.now());
    if (outcome === 'not-found') return { outcome: 'not-found' };
    if (outcome === 'already-terminal') return { outcome: 'already-terminal' };
    ctx.broadcaster.broadcast(buildJobCancelledEvent(args.id));
    appendOperation(ctx.cwd, {
      op: 'jobs.cancel',
      target: '*',
      channel: 'mcp',
      outcome: 'cancelled',
      id: args.id,
    });
    return { outcome: 'cancelled' };
  });
}

/** Force a queued / running job to `failed` with reason `user-failed`. */
export async function failJob(
  ctx: IMcpWriteContext,
  args: ITransitionArgs,
): Promise<TFailJobResult> {
  return withWriteDb(ctx, async (adapter) => {
    const outcome = await adapter.jobs.fail(args.id, Date.now());
    if (outcome === 'not-found') return { outcome: 'not-found' };
    if (outcome === 'already-terminal') return { outcome: 'already-terminal' };
    ctx.broadcaster.broadcast({
      type: 'job.failed',
      timestamp: Date.now(),
      runId: generateRunId('queue'),
      jobId: args.id,
      data: { reason: 'user-failed' },
    });
    appendOperation(ctx.cwd, {
      op: 'jobs.fail',
      target: '*',
      channel: 'mcp',
      outcome: 'failed',
      id: args.id,
    });
    return { outcome: 'failed' };
  });
}

// ---------------------------------------------------------------------------
// registration
// ---------------------------------------------------------------------------

/**
 * Register the seven queue tools on an `McpServer`. Each callback runs the
 * executor and wraps the structured result into a `CallToolResult`. A
 * `claim_job` empty result (`null`) rides the text channel only (there is
 * no object to put on `structuredContent`).
 */
export function registerMcpQueueTools(server: McpServer, ctx: IMcpWriteContext): void {
  server.registerTool(
    'list_extensions',
    {
      title: 'List submittable extensions',
      description:
        'Return { extensions } of every enabled probabilistic extension you can pass to submit_job: finders (analyzers), fixers, and standalone actions, each with id / kind / role / description. Call this to discover valid extension ids.',
      inputSchema: {},
    },
    async () => toToolResult(await listExtensions(ctx)),
  );

  server.registerTool(
    'list_jobs',
    {
      title: 'List queue jobs',
      description: 'Return { items } of live jobs (nonce stripped), filtered by status / extension / node.',
      inputSchema: listJobsInputShape,
    },
    async (args) => toToolResult(await listJobs(ctx, args)),
  );

  server.registerTool(
    'get_job',
    {
      title: 'Get one job',
      description: 'Return { item } for one job id (nonce stripped). Unknown id is an invalid-params error.',
      inputSchema: getJobInputShape,
    },
    async (args) => toToolResult(await getJob(ctx, args)),
  );

  server.registerTool(
    'submit_job',
    {
      title: 'Enqueue a job',
      description: 'Enqueue a probabilistic extension against one node. Returns { outcome: created, ... } or a structured refusal.',
      inputSchema: submitJobInputShape,
    },
    async (args) => toToolResult(await submitJob(ctx, args)),
  );

  server.registerTool(
    'claim_job',
    {
      title: 'Claim the next job',
      description: 'Atomic claim: returns { id, nonce, content } (the rendered prompt + record credential), or null when the queue is empty.',
      inputSchema: claimJobInputShape,
    },
    async (args) => toClaimToolResult(await claimJobTool(ctx, args)),
  );

  server.registerTool(
    'record_job',
    {
      title: 'Close a running job',
      description: 'Record a completed / failed job (validates the report, writes findings, fires auto-fix). Returns { outcome, ... }.',
      inputSchema: recordJobInputShape,
    },
    async (args) => toToolResult(await recordJobTool(ctx, args)),
  );

  server.registerTool(
    'cancel_job',
    {
      title: 'Cancel a job',
      description: 'Move a queued / running job to the terminal cancelled state (never interrupts a running agent).',
      inputSchema: cancelJobInputShape,
    },
    async (args) => toToolResult(await cancelJob(ctx, args)),
  );

  server.registerTool(
    'fail_job',
    {
      title: 'Fail a job',
      description: 'Force a queued / running job to failed (reason user-failed).',
      inputSchema: failJobInputShape,
    },
    async (args) => toToolResult(await failJob(ctx, args)),
  );
}

/** Wrap a structured result into a `CallToolResult` (JSON structured content + a text mirror). */
function toToolResult(data: object): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
  };
}

/** `claim_job` variant: an empty claim (`null`) has no object to put on `structuredContent`. */
function toClaimToolResult(data: IClaimJobResult | null): CallToolResult {
  if (data === null) {
    return { content: [{ type: 'text', text: 'null' }] };
  }
  return toToolResult(data);
}
