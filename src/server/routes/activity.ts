/**
 * `POST /api/activity`, live-activity ingest (see
 * `spec/provider-activity.md` §Ingest).
 *
 * The activity bridge (a short-lived, zero-dependency process the
 * provider runtime spawns per hook event, or opencode's in-process
 * plugin) forwards ONE raw provider hook payload per request:
 *
 *   `{ provider: "<provider-id>", event: <raw payload> }`
 *
 * with the per-session token from `serve.json` in the
 * `x-skill-map-token` header. Flow:
 *
 *   1. Token gate FIRST, before any body processing: missing / wrong
 *      token rejects 403 `token-mismatch` (typed `ActivityTokenError`,
 *      the loopback gate's sibling). Constant-time comparison so the
 *      check leaks nothing about the expected value.
 *   2. AJV body validation via the shared `makeBodyValidator` factory.
 *   3. `resolveActivityEvent` maps the raw event through the Provider's
 *      `activity.mapEvent` and resolves each signal against the scanned
 *      node set. Per resolved activity payload the stats accumulator
 *      records it and one (stats-enriched, when the start counted)
 *      `node.activity` WS envelope broadcasts; per resolved spawn the
 *      consent-gated conversation store records it (a no-op while the
 *      gate is off) and one METADATA-ONLY `agent.spawn` envelope
 *      broadcasts.
 *   4. `202` accepted ALWAYS on a well-formed request, also when nothing
 *      resolved: the bridge is fire-and-forget and never needs the
 *      outcome.
 *
 * **Privacy invariant (normative)**: the request body may carry prompts,
 * command text, even file contents. It is never logged, never thrown
 * inside an error message, never persisted, and never forwarded beyond
 * the mapper. The `node.activity` payload carries only the resolved
 * shape (`nodePath`, `phase`, `owner?`, flags, server-side stats); the
 * `agent.spawn` payload is projected through `toSpawnEventData`, whose
 * return type has NO content fields, so the conversation halves
 * (`prompt` / `response`) cannot ride the WS by construction. They
 * reach ONLY the in-memory conversation store, and only while the
 * capture gate is on.
 */

import type { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';

import { ActivityTokenError } from '../app.js';
import type { WsBroadcaster } from '../broadcaster.js';
import type { ActivityConversationStore } from '../activity-conversations.js';
import type { ActivityStatsService } from '../activity-stats.js';
import {
  buildAgentSpawnEvent,
  buildNodeActivityEvent,
  type IAgentSpawnEventData,
  type INodeActivityEventData,
} from '../events.js';
import { resolveActivityEvent, type IResolvedSpawn } from '../activity-resolver.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
import { makeBodyValidator } from '../util/parse-body.js';
import type { IRouteDeps } from './deps.js';

/** Header the bridge sends the serve.json token in. */
export const ACTIVITY_TOKEN_HEADER = 'x-skill-map-token';

interface IActivityBody {
  /** Registered provider id the bridge was installed for (e.g. `claude`). */
  provider: string;
  /** The provider runtime's raw hook payload, forwarded verbatim. */
  event: Record<string, unknown>;
}

const ACTIVITY_BODY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['provider', 'event'],
  properties: {
    provider: { type: 'string', minLength: 1 },
    event: { type: 'object' },
  },
} as const;

const parseBody = makeBodyValidator<IActivityBody>(ACTIVITY_BODY_SCHEMA, {
  notJson: SERVER_TEXTS.activityBodyNotJson,
  notObject: SERVER_TEXTS.activityBodyNotObject,
  invalid: SERVER_TEXTS.activityBodyNotObject,
  mapping: {
    '/provider:required': SERVER_TEXTS.activityProviderRequired,
    '/provider:type:string': SERVER_TEXTS.activityProviderRequired,
    '/provider:minLength': SERVER_TEXTS.activityProviderRequired,
    '/event:required': SERVER_TEXTS.activityEventRequired,
    '/event:type:object': SERVER_TEXTS.activityEventRequired,
  },
});

export interface IActivityRouteDeps extends IRouteDeps {
  broadcaster: WsBroadcaster;
  /** Per-session shared secret minted by the composition root at boot. */
  activityToken: string;
  /** Boot-scoped execution-stats accumulator (composition-root owned). */
  stats: ActivityStatsService;
  /**
   * Consent-gated conversation store. Explicit extra dep by custody
   * contract (never on `IRouteDeps`, see `activity-conversations.ts`).
   */
  conversations: ActivityConversationStore;
}

export function registerActivityRoute(app: Hono, deps: IActivityRouteDeps): void {
  app.post('/api/activity', async (c) => {
    assertToken(c.req.raw.headers.get(ACTIVITY_TOKEN_HEADER), deps.activityToken);
    const body = await parseBody(c.req.raw);

    const { activity, spawns, reports } = await resolveActivityEvent({
      providers: deps.providers,
      dbPath: deps.options.dbPath,
      providerId: body.provider,
      raw: body.event,
    });
    for (const data of activity) {
      const stats = deps.stats.record(data);
      const payload: INodeActivityEventData = stats ? { ...data, stats } : data;
      deps.broadcaster.broadcast(buildNodeActivityEvent(payload));
    }
    for (const spawn of spawns) {
      deps.conversations.record(spawn);
      const pairCount = deps.stats.recordSpawn(spawn);
      if (spawn.execution !== undefined && spawn.childNodePath !== undefined) {
        deps.stats.recordExecution(spawn.childNodePath, spawn.execution);
      }
      const data = toSpawnEventData(spawn);
      if (pairCount !== null) data.pairCount = pairCount;
      deps.broadcaster.broadcast(buildAgentSpawnEvent(data));
    }
    // End-of-context reports (the async response source) go ONLY to
    // the gated store; like the spawn halves they never broadcast.
    for (const report of reports) {
      deps.conversations.attachReport(report.owner, report.report);
    }

    return c.json({ ok: true, resolved: activity.length, spawns: spawns.length }, 202);
  });
}

/**
 * Project the internal resolved spawn onto the wire event shape by
 * EXPLICIT field picks. `prompt` / `response` have no counterpart on
 * `IAgentSpawnEventData`, so content cannot leak onto the WS through
 * this seam even if `IResolvedSpawn` grows new fields.
 */
function toSpawnEventData(spawn: IResolvedSpawn): IAgentSpawnEventData {
  const data: IAgentSpawnEventData = {
    spawnId: spawn.spawnId,
    phase: spawn.phase,
    parentOwner: spawn.parentOwner,
  };
  if (spawn.parentNodePath !== undefined) data.parentNodePath = spawn.parentNodePath;
  if (spawn.childKind !== undefined) data.childKind = spawn.childKind;
  if (spawn.childName !== undefined) data.childName = spawn.childName;
  if (spawn.childNodePath !== undefined) data.childNodePath = spawn.childNodePath;
  if (spawn.childOwner !== undefined) data.childOwner = spawn.childOwner;
  return data;
}

/**
 * Constant-time token comparison. Lengths are compared first (an
 * unavoidable length oracle, the token length is public in the schema
 * anyway); equal-length buffers go through `timingSafeEqual`.
 */
function assertToken(presented: string | null, expected: string): void {
  if (presented !== null && presented.length === expected.length) {
    const a = Buffer.from(presented, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length === b.length && timingSafeEqual(a, b)) return;
  }
  throw new ActivityTokenError();
}
