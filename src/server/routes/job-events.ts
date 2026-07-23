/**
 * `POST /api/job-events`, the CLI-to-server push leg of the job-event
 * transport (`spec/job-events.md` §Transport; wire row in
 * `spec/cli-contract.md` §HTTP API).
 *
 * Job transitions happen in whatever process runs the verb (`sm jobs
 * submit` / `claim` / `cancel` / `fail`, `sm record`), which the server
 * cannot observe: without a push, a connected UI only learns of a
 * transition on its next full read. So every job-transitioning verb
 * POSTs its already-emitted event envelope here, best-effort and
 * fire-and-forget (discovery via `.skill-map/serve.json`, the
 * per-session token in `x-skill-map-token`). Flow:
 *
 *   1. Token gate FIRST, before any body processing: missing / wrong
 *      token rejects 403 `token-mismatch` (shared constant-time gate,
 *      `util/ingest-token.ts`, the activity ingest's sibling).
 *   2. AJV body validation via the shared `makeBodyValidator` factory:
 *      one canonical envelope, `type` restricted to the five `job.*`
 *      catalog types, integer `timestamp`, string `runId` / `jobId`
 *      (every catalog `job.*` event is job-scoped, so `jobId` is never
 *      null here), object `data`. The per-type `data` shape is NOT
 *      deep-validated: the catalog mandates consumers ignore unknown
 *      `data` fields (forward compatibility), so the ingest checks
 *      presence + object type only. Malformed -> 400 `bad-query`.
 *   3. Rebroadcast the envelope VERBATIM over `/ws` and answer
 *      `202 { ok: true }`.
 *
 * NO DB access, by construction: the deps bag carries only the
 * broadcaster and the session token, so the route cannot reach a DB
 * path. The DB row already carries the truth (the verb transitions it
 * BEFORE pushing); this endpoint is a cache-invalidation hint, and a
 * missed push costs only staleness until the next read.
 */

import type { Hono } from 'hono';

import type { WsBroadcaster } from '../broadcaster.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
import { assertIngestToken, INGEST_TOKEN_HEADER } from '../util/ingest-token.js';
import { makeBodyValidator } from '../util/parse-body.js';
import { log } from '../../kernel/util/logger.js';

/**
 * The five queue-transition event types the push leg carries
 * (`spec/job-events.md` §Event catalog). The run-level `run.*` frames
 * and the record-internal `job.callback.received` stay inside the
 * synthetic `sm record --json` envelope and are never pushed
 * standalone.
 */
const JOB_EVENT_TYPES = [
  'job.submitted',
  'job.claimed',
  'job.completed',
  'job.failed',
  'job.cancelled',
] as const;

type TJobEventType = (typeof JOB_EVENT_TYPES)[number];

/** Canonical event envelope (`spec/job-events.md` §Common envelope), job-scoped flavor. */
interface IJobEventEnvelope {
  type: TJobEventType;
  /** Unix milliseconds when the emitting verb produced the event. */
  timestamp: number;
  /** `r-<mode>-YYYYMMDD-HHMMSS-XXXX` run id of the emitting invocation. */
  runId: string;
  /** The job the event refers to; never null for the five pushed types. */
  jobId: string;
  /** Per-type payload, forwarded verbatim (unknown fields are consumer-ignored). */
  data: Record<string, unknown>;
}

const JOB_EVENT_BODY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'timestamp', 'runId', 'jobId', 'data'],
  properties: {
    type: { enum: JOB_EVENT_TYPES },
    timestamp: { type: 'integer' },
    runId: { type: 'string', minLength: 1 },
    jobId: { type: 'string', minLength: 1 },
    data: { type: 'object' },
  },
} as const;

const parseBody = makeBodyValidator<IJobEventEnvelope>(JOB_EVENT_BODY_SCHEMA, {
  notJson: SERVER_TEXTS.jobEventsBodyNotJson,
  notObject: SERVER_TEXTS.jobEventsBodyNotObject,
  invalid: SERVER_TEXTS.jobEventsBodyInvalid,
});

/**
 * Deliberately NARROW deps (no `IRouteDeps`): the route is DB-free and
 * config-free per contract, so the bag physically cannot hand it a
 * `dbPath`. Same narrow-bag precedent as `registerActivitySummaryRoute`.
 */
export interface IJobEventsRouteDeps {
  broadcaster: WsBroadcaster;
  /**
   * Per-session shared secret minted by the composition root at boot
   * and published via `.skill-map/serve.json` (the same token the
   * activity ingest gate checks).
   */
  ingestToken: string;
}

export function registerJobEventsRoute(app: Hono, deps: IJobEventsRouteDeps): void {
  app.post('/api/job-events', async (c) => {
    assertTokenLogged(c.req.raw.headers.get(INGEST_TOKEN_HEADER), deps.ingestToken);
    const envelope = await parseBody(c.req.raw);
    deps.broadcaster.broadcast(envelope);
    return c.json({ ok: true }, 202);
  });
}

/**
 * Assert the ingest token (shared constant-time gate,
 * `util/ingest-token.ts`), logging a WARN on mismatch (an otherwise
 * silent 403 that blinds an operator to a stale serve.json) before
 * rethrowing. No token or body content is logged.
 */
function assertTokenLogged(presented: string | null, expected: string): void {
  try {
    assertIngestToken(presented, expected);
  } catch (err) {
    log.warn('job-events: ingest rejected (token mismatch)');
    throw err;
  }
}
