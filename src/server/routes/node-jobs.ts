/**
 * The UI's two job-submit surfaces: `POST /api/nodes/:pathB64/jobs` (a job
 * against one node, Step 16 piece 1) and its nodeless sibling
 * `POST /api/jobs` (`spec/cli-contract.md` §BFF endpoint POST /api/jobs, for
 * a probabilistic Action declaring `probNodeless`, which has no target to
 * name). One module because they share everything but the target: body
 * validation, the submit-context preparation, the envelope, the refusal
 * mapping and the WS broadcast.
 *
 * Enqueues a probabilistic extension against one node through the SAME
 * shared submit machinery as `sm jobs submit`
 * (`core/jobs/submit-engine.ts`: `prepareSubmitContext` ->
 * `submitOneJob`), so every submit rule is inherited, never
 * re-implemented: target resolution + the probabilistic gate, duplicate
 * refusal, fixer findings injection, fixer supersede, drift
 * verification, TTL / priority resolution from config. Pull-only stays
 * intact: the BFF enqueues, the user's external agent processes.
 *
 * Refusal mapping (the CLI's structured outcomes -> envelope codes):
 *
 *   - no installed processing skill        -> 409 `no-processing-agent`
 *     (this is an OPERATOR surface, so the gate applies exactly as on
 *     the CLI; the shared engine stays gate-free because the auto-fix
 *     hook path must keep bypassing it).
 *   - unknown extension / node / missing DB / malformed pathB64 -> 404.
 *   - non-probabilistic / ambiguous extension id, virtual node, body
 *     shape                                -> 400 `bad-query` (the CLI
 *     exit-2 refusals).
 *   - active identical job                 -> 409 `duplicate-job`
 *     (`details.existingId`).
 *   - RUNNING sibling (holds its claim, never superseded)
 *                                          -> 409 `job-running`.
 *   - on-disk body drifted from the scanned hash -> 409 `node-drifted`
 *     (advisory names `sm scan`). A node file that went MISSING /
 *     unreadable since the scan maps here too (judgment call: it is the
 *     extreme form of the same divergence and the remedy is identical),
 *     with the unreadable wording carrying the read detail.
 *   - fixer over a node with zero matching findings -> 409 `no-findings`
 *     (defensive: the UI hides that launcher).
 *
 * Success: 200 with the `kind: 'job.submitted'` action-result envelope
 * (`value` = `{ jobId, nodePath, extensionId, supersededIds }` +
 * `elapsedMs`; NO nonce, the record credential never travels to the UI)
 * plus one `job.submitted` WS broadcast in the canonical catalog shape
 * (`spec/job-events.md` §`job.submitted`: runId mode `queue`, the same
 * envelope the CLI push leg delivers via `POST /api/job-events`) so
 * every connected client flips the launcher to `queued`. The DB open is a WRITE open (`withSqlite`
 * via `tryWithSqlite`, no `versionCheck`), so a drifted on-disk schema
 * refuses with `DbSchemaDriftError` -> the `db-drift` envelope.
 */

import type { Hono } from 'hono';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import { processingSkillPresence } from '../../core/agent-skill/targets.js';
import { buildActionRuntime } from '../../core/jobs/action-runtime.js';
import { appendOperation } from '../../core/operations-log.js';
import {
  prepareSubmitContext,
  submitNodelessJob,
  submitOneJob,
  type ISubmitContext,
  type TPrepareError,
  type TSubmitOutcome,
} from '../../core/jobs/submit-engine.js';
import { buildFreshResolver } from '../../core/runtime/fresh-resolver.js';
import { tryWithSqlite } from '../../core/sqlite/with-sqlite.js';
import { nodelessTargetId } from '../../kernel/jobs/index.js';
import type { JobStatus, Node } from '../../kernel/types.js';
import type { StoragePort } from '../../kernel/ports/storage.js';
import { log } from '../../kernel/util/logger.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tx } from '../../kernel/util/tx.js';
import { JobSubmitConflictError } from '../app.js';
import type { WsBroadcaster } from '../broadcaster.js';
import { REST_ENVELOPE_SCHEMA_VERSION } from '../envelope.js';
import { buildJobSubmittedEvent } from '../events.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
import { makeBodyValidator } from '../util/parse-body.js';
import type { IRouteDeps } from './deps.js';
import { decodePathB64Or404 } from './node-loader.js';

interface IJobSubmitBody {
  /**
   * Qualified or bare probabilistic extension id (CLI matching rules),
   * or a `skill:<name>` skill-action target (`spec/skill-actions.md`
   * §HTTP surface): resolved against the boot-frozen catalog on
   * `IRouteDeps.skillActionCatalog`, unknown name -> 404 `not-found`;
   * `autoFix` is clamped false and `findingIds` -> 400 `bad-query` on a
   * skill target; everything else below is inherited unchanged.
   */
  extension: string;
  /**
   * Per-job auto-fix opt-in (default off). `true` on a finder submit
   * freezes `state_jobs.auto_fix` so `sm record` chains the finder's
   * fixers on completion (`spec/job-lifecycle.md` §Auto-fix chain
   * (per-job)); CLAMPED to `false` on a non-finder target by the engine.
   */
  autoFix?: boolean;
  /**
   * Finding-subset targeting for a findings-branch fixer submit
   * (`spec/job-lifecycle.md` §Finding-subset targeting): the tray's
   * per-row fix button sends the single row id so each finding fixes
   * individually. 400 on any other target.
   */
  findingIds?: number[];
}

const JOB_BODY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['extension'],
  properties: {
    extension: { type: 'string', minLength: 1 },
    autoFix: { type: 'boolean', default: false },
    findingIds: {
      type: 'array',
      minItems: 1,
      items: { type: 'integer', minimum: 1 },
    },
  },
} as const;

const parseBody = makeBodyValidator<IJobSubmitBody>(JOB_BODY_SCHEMA, {
  notJson: SERVER_TEXTS.jobsBodyNotJson,
  notObject: SERVER_TEXTS.jobsBodyNotObject,
  invalid: SERVER_TEXTS.jobsBodyExtensionRequired,
});

/**
 * Body of the NODELESS submit: the extension and nothing else. `autoFix` /
 * `findingIds` are per-node fixer concerns and have no meaning without a
 * node, so they are rejected rather than ignored.
 */
const NODELESS_BODY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['extension'],
  properties: {
    extension: { type: 'string', minLength: 1 },
  },
} as const;

const parseNodelessBody = makeBodyValidator<{ extension: string }>(NODELESS_BODY_SCHEMA, {
  notJson: SERVER_TEXTS.jobsBodyNotJson,
  notObject: SERVER_TEXTS.jobsBodyNotObject,
  invalid: SERVER_TEXTS.jobsBodyExtensionRequired,
});

/** Wire `value` of the `job.submitted` envelope (no nonce, by construction). */
interface IJobSubmittedValue {
  jobId: string;
  nodePath: string;
  extensionId: string;
  supersededIds: string[];
}

interface IJobSubmittedEnvelope {
  schemaVersion: typeof REST_ENVELOPE_SCHEMA_VERSION;
  kind: 'job.submitted';
  value: IJobSubmittedValue;
  elapsedMs: number;
}

export interface INodeJobsRouteDeps extends IRouteDeps {
  broadcaster: WsBroadcaster;
}

export function registerNodeJobsRoute(app: Hono, deps: INodeJobsRouteDeps): void {
  // Plugin-runtime discovery warnings are static per boot; emit them
  // once here (the per-request runtime build below uses a noop sink so a
  // mid-session recompose never re-spams the server log).
  for (const line of deps.pluginRuntimeHolder.current.warnings) log.warn(line);

  app.post('/api/nodes/:pathB64/jobs', async (c) => {
    const startedAt = Date.now();
    const nodePath = decodePathB64Or404(c.req.param('pathB64'));
    const body = await parseBody(c.req.raw);

    // Build the submit runtime against a fresh resolver from the LIVE
    // layered config so a finder enabled mid-session (PATCH
    // /api/plugins[/...] + configService.reload(), or `sm plugins enable`
    // side by side) is not only SHOWN by the launcher catalog but also
    // SUBMITTABLE here, without an `sm serve` restart, else clicking the
    // just-enabled button 400s "not probabilistic / not found". Cheap
    // in-memory re-filter of the boot-cached runtime (audit M3); a
    // drop-in that booted `startsAsDisabled` still needs a restart. See
    // `core/runtime/fresh-resolver.ts`.
    const resolveEnabled = await buildFreshResolver({
      effectiveConfig: () => deps.configService.effective(),
    });
    const runtime = buildActionRuntime(
      deps.pluginRuntimeHolder.current,
      () => {
        /* discard: warnings emitted once at registration */
      },
      undefined,
      resolveEnabled,
    );

    // Processing-agent gate (`spec/job-lifecycle.md` §Submit): a queue
    // nothing ever claims must refuse before any work is staged.
    // Installed-but-stale passes (the CLI's refresh nudge is a human-mode
    // stderr advisory with no envelope slot). Probed against the COMPOSED
    // provider set, so a project-local Provider's own skill territory
    // counts exactly like a built-in's.
    if (!processingSkillPresence(deps.runtimeContext.cwd, runtime.providers).installed) {
      throw new JobSubmitConflictError({
        code: 'no-processing-agent',
        message: SERVER_TEXTS.jobsNoProcessingAgent,
      });
    }

    const prep = prepareSubmitContext({
      runtime,
      jobs: deps.configService.effective().jobs,
      extensionId: body.extension,
      cwd: deps.runtimeContext.cwd,
      force: false,
      flagTtl: undefined,
      flagPriority: undefined,
      autoFix: body.autoFix ?? false,
      ...(body.findingIds !== undefined ? { findingIds: body.findingIds } : {}),
      // Skill-action targets (`skill:<name>`) resolve against the
      // boot-frozen catalog; this per-node route is the ONLY submit
      // surface that supplies it in v1 (`spec/skill-actions.md` §CLI
      // surface: the CLI grammar stays reserved, the nodeless route has
      // no skill shape to accept).
      skillCatalog: deps.skillActionCatalog,
    });
    if (!prep.ok) throw prepareErrorToHttp(prep.error, body.extension);

    // WRITE open: `tryWithSqlite` short-circuits to `null` on a missing
    // DB file (-> 404 per the route contract) and, having no
    // `versionCheck`, runs the write-side drift refusal
    // (`DbSchemaDriftError` -> the global `db-drift` envelope).
    const submitted = await tryWithSqlite(
      { databasePath: deps.options.dbPath, autoBackup: false },
      (adapter) => submitAgainstNode(adapter, nodePath, prep.prepared),
    );
    if (submitted === null) {
      throw new HTTPException(404, {
        message: tx(SERVER_TEXTS.dbMissingHint, { path: deps.options.dbPath }),
      });
    }

    const value = toSubmittedValue(submitted, nodePath, prep.prepared);
    appendOperation(deps.runtimeContext.cwd, {
      op: 'jobs.submit',
      target: nodePath,
      extension: value.extensionId,
      channel: 'ui',
      outcome: 'queued',
      id: value.jobId,
    });
    deps.broadcaster.broadcast(
      buildJobSubmittedEvent(value.jobId, {
        nodePath: value.nodePath,
        extensionId: value.extensionId,
        supersededIds: value.supersededIds,
      }),
    );
    const envelope: IJobSubmittedEnvelope = {
      schemaVersion: REST_ENVELOPE_SCHEMA_VERSION,
      kind: 'job.submitted',
      value,
      elapsedMs: Date.now() - startedAt,
    };
    return c.json(envelope);
  });
}

/**
 * `POST /api/jobs`, the NODELESS sibling (`spec/cli-contract.md` §BFF
 * endpoint POST /api/jobs). Enqueues a probabilistic Action that declares
 * `probNodeless`, which by contract has no target: the caller names the
 * extension and nothing else, so no surface is ever in the position of
 * picking a node for a job that does not want one.
 *
 * Two deliberate differences from the node route above:
 *   - NO processing-agent gate. The only declarer today is the liveness
 *     probe, whose entire purpose is to find out whether an agent is
 *     attending; refusing to submit it for lack of a processing skill
 *     would answer the question with itself.
 *   - No `node-drifted` path. There is no file, so drift cannot happen,
 *     which is the whole point of the nodeless submit.
 */
export function registerNodelessJobsRoute(app: Hono, deps: INodeJobsRouteDeps): void {
  app.post('/api/jobs', async (c) => {
    const startedAt = Date.now();
    const body = await parseNodelessBody(c.req.raw);

    const resolveEnabled = await buildFreshResolver({
      effectiveConfig: () => deps.configService.effective(),
    });
    const runtime = buildActionRuntime(
      deps.pluginRuntimeHolder.current,
      () => {
        /* discard: warnings emitted once at registration */
      },
      undefined,
      resolveEnabled,
    );

    const prep = prepareSubmitContext({
      runtime,
      jobs: deps.configService.effective().jobs,
      extensionId: body.extension,
      cwd: deps.runtimeContext.cwd,
      force: false,
      flagTtl: undefined,
      flagPriority: undefined,
    });
    if (!prep.ok) throw prepareErrorToHttp(prep.error, body.extension);
    // A node-taking extension has a target to name, so it belongs on the
    // node route; sending it here is a caller bug, not an operator error.
    if (!prep.prepared.nodeless) {
      throw new HTTPException(400, {
        message: tx(SERVER_TEXTS.jobsNotNodeless, {
          extension: sanitizeForTerminal(body.extension),
        }),
      });
    }

    const submitted = await tryWithSqlite(
      { databasePath: deps.options.dbPath, autoBackup: false },
      async (adapter): Promise<ISubmitAttempt> => {
        const outcome = await submitNodelessJob(adapter, prep.prepared);
        if (outcome.kind !== 'duplicate') return { outcome, existingStatus: null };
        const existing = await adapter.jobs.get(outcome.existingId);
        return { outcome, existingStatus: existing?.status ?? 'queued' };
      },
    );
    if (submitted === null) {
      throw new HTTPException(404, {
        message: tx(SERVER_TEXTS.dbMissingHint, { path: deps.options.dbPath }),
      });
    }

    const nodePath = nodelessTargetId(prep.prepared.extensionId);
    const value = toSubmittedValue(submitted, nodePath, prep.prepared);
    appendOperation(deps.runtimeContext.cwd, {
      op: 'jobs.submit',
      target: nodePath,
      extension: value.extensionId,
      channel: 'ui',
      outcome: 'queued',
      id: value.jobId,
    });
    deps.broadcaster.broadcast(
      buildJobSubmittedEvent(value.jobId, {
        nodePath: value.nodePath,
        extensionId: value.extensionId,
        supersededIds: value.supersededIds,
      }),
    );
    const envelope: IJobSubmittedEnvelope = {
      schemaVersion: REST_ENVELOPE_SCHEMA_VERSION,
      kind: 'job.submitted',
      value,
      elapsedMs: Date.now() - startedAt,
    };
    return c.json(envelope);
  });
}

/** Outcome of the DB half: the engine's verdict plus, for a duplicate, the covering job's live status. */
interface ISubmitAttempt {
  outcome: TSubmitOutcome;
  /** Status of `existingId` when `outcome.kind === 'duplicate'`, else `null`. */
  existingStatus: JobStatus | null;
}

/**
 * Resolve the node and run the shared submit engine inside the single
 * write open. The existence / virtual checks mirror the CLI's
 * single-target path (`JobSubmitCommand.submitOneTarget`) exactly.
 */
async function submitAgainstNode(
  adapter: StoragePort,
  nodePath: string,
  prepared: ISubmitContext,
): Promise<ISubmitAttempt> {
  const bundle = await adapter.scans.findNode(nodePath);
  if (!bundle) {
    throw new HTTPException(404, {
      message: tx(SERVER_TEXTS.nodeNotFound, { path: sanitizeForTerminal(nodePath) }),
    });
  }
  if (isVirtual(bundle.node)) {
    throw new HTTPException(400, {
      message: tx(SERVER_TEXTS.jobsNodeVirtual, { node: sanitizeForTerminal(nodePath) }),
    });
  }
  const outcome = await submitOneJob(adapter, bundle.node, prepared);
  if (outcome.kind !== 'duplicate') return { outcome, existingStatus: null };
  // The engine folds the fixer running-conflict into `duplicate`
  // (`insertFixerJobRow`); the wire contract distinguishes
  // `duplicate-job` from `job-running`, so read the covering job's live
  // status while the DB is still open.
  const existing = await adapter.jobs.get(outcome.existingId);
  return { outcome, existingStatus: existing?.status ?? 'queued' };
}

function isVirtual(node: Node): boolean {
  return node.virtual === true;
}

/**
 * Map the engine outcome to the 200 `value`, or throw the matching
 * `JobSubmitConflictError` (`spec/cli-contract.md` §BFF endpoint
 * POST /api/nodes/:pathB64/jobs, the 409 table).
 */
function toSubmittedValue(
  attempt: ISubmitAttempt,
  nodePath: string,
  prepared: ISubmitContext,
): IJobSubmittedValue {
  const { outcome } = attempt;
  if (outcome.kind === 'created') {
    return {
      jobId: outcome.id,
      nodePath,
      extensionId: prepared.extensionId,
      supersededIds: outcome.supersededIds,
    };
  }
  // Caller bug (a nodeless extension routed through the per-node path):
  // a 400 like every other "wrong shape of request", not a 409 conflict.
  if (outcome.kind === 'nodeless-mismatch') {
    throw new HTTPException(400, {
      message: tx(SERVER_TEXTS.jobsIsNodeless, {
        extension: sanitizeForTerminal(prepared.extensionId),
      }),
    });
  }
  throw submitRefusal(outcome, attempt.existingStatus, nodePath, prepared);
}

/** Build the 409 for a non-`created` engine outcome. */
function submitRefusal(
  outcome: Exclude<TSubmitOutcome, { kind: 'created' } | { kind: 'nodeless-mismatch' }>,
  existingStatus: JobStatus | null,
  nodePath: string,
  prepared: ISubmitContext,
): JobSubmitConflictError {
  const safePath = sanitizeForTerminal(nodePath);
  switch (outcome.kind) {
    case 'duplicate': {
      const running = existingStatus === 'running';
      return new JobSubmitConflictError({
        code: running ? 'job-running' : 'duplicate-job',
        message: tx(running ? SERVER_TEXTS.jobsRunningSibling : SERVER_TEXTS.jobsDuplicate, {
          id: outcome.existingId,
          node: safePath,
        }),
        details: { existingId: outcome.existingId },
      });
    }
    case 'drift':
      return new JobSubmitConflictError({
        code: 'node-drifted',
        message: tx(SERVER_TEXTS.jobsNodeDrifted, { node: safePath }),
      });
    case 'unreadable':
      // Judgment call documented in the module header: a file missing /
      // unreadable since the scan is the extreme form of drift, same
      // remedy (`sm scan`), same code.
      return new JobSubmitConflictError({
        code: 'node-drifted',
        message: tx(SERVER_TEXTS.jobsNodeUnreadable, {
          node: safePath,
          detail: sanitizeForTerminal(outcome.detail),
        }),
      });
    case 'no-findings':
      return new JobSubmitConflictError({
        code: 'no-findings',
        message: tx(SERVER_TEXTS.jobsNoFindings, {
          finders: (prepared.analyzerIds ?? []).join(', '),
          node: safePath,
        }),
      });
  }
}

/**
 * Map a `prepareSubmitContext` failure to its HTTP refusal: unknown
 * extension -> 404 (the CLI's exit 5), everything else -> 400
 * `bad-query` (the CLI's exit-2 refusals). The client-supplied id is
 * sanitised before interpolation. Lookup-shaped (one formatter per
 * kind) so the catalog grows without pushing the function over the
 * complexity cap.
 */
const PREPARE_ERROR_TO_HTTP: {
  [K in TPrepareError['kind']]: (
    error: Extract<TPrepareError, { kind: K }>,
    extension: string,
  ) => HTTPException;
} = {
  'not-found': (_e, extension) =>
    new HTTPException(404, { message: tx(SERVER_TEXTS.jobsExtensionNotFound, { extension }) }),
  deterministic: (e, extension) =>
    new HTTPException(400, {
      message: tx(SERVER_TEXTS.jobsExtensionNotProbabilistic, { extension, mode: e.mode }),
    }),
  ambiguous: (e, extension) =>
    new HTTPException(400, {
      message: tx(SERVER_TEXTS.jobsExtensionAmbiguous, {
        extension,
        actionId: e.actionId,
        analyzerId: e.analyzerId,
      }),
    }),
  'prompt-unresolved': (e, extension) =>
    new HTTPException(400, {
      message: tx(SERVER_TEXTS.jobsPromptUnresolved, { extension, detail: e.detail }),
    }),
  'report-schema-unresolved': (e, extension) =>
    new HTTPException(400, {
      message: tx(SERVER_TEXTS.jobsReportSchemaUnresolved, { extension, detail: e.detail }),
    }),
  'finding-ids-unsupported': (_e, extension) =>
    new HTTPException(400, {
      message: tx(SERVER_TEXTS.jobsFindingIdsUnsupported, { extension }),
    }),
  'invalid-ttl': (e) =>
    new HTTPException(400, { message: tx(SERVER_TEXTS.jobsConfigInvalid, { detail: e.message }) }),
  'invalid-priority': (e) =>
    new HTTPException(400, { message: tx(SERVER_TEXTS.jobsConfigInvalid, { detail: e.message }) }),
};

function prepareErrorToHttp(error: TPrepareError, extensionInput: string): HTTPException {
  const extension = sanitizeForTerminal(extensionInput);
  return (
    PREPARE_ERROR_TO_HTTP[error.kind] as (e: TPrepareError, ext: string) => HTTPException
  )(error, extension);
}
