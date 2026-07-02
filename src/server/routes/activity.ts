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
 *      node set; one `node.activity` WS envelope broadcasts per resolved
 *      signal.
 *   4. `202` accepted ALWAYS on a well-formed request, also when nothing
 *      resolved: the bridge is fire-and-forget and never needs the
 *      outcome.
 *
 * **Privacy invariant (normative)**: the request body may carry prompts,
 * command text, even file contents. It is never logged, never thrown
 * inside an error message, never persisted, and never forwarded beyond
 * the mapper. The broadcast payload carries only `{ nodePath, phase,
 * owner? }`, all values the UI already has from the scan surface.
 */

import type { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';

import { ActivityTokenError } from '../app.js';
import type { WsBroadcaster } from '../broadcaster.js';
import { buildNodeActivityEvent } from '../events.js';
import { resolveActivityEvent } from '../activity-resolver.js';
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
}

export function registerActivityRoute(app: Hono, deps: IActivityRouteDeps): void {
  app.post('/api/activity', async (c) => {
    assertToken(c.req.raw.headers.get(ACTIVITY_TOKEN_HEADER), deps.activityToken);
    const body = await parseBody(c.req.raw);

    const resolved = await resolveActivityEvent({
      providers: deps.providers,
      dbPath: deps.options.dbPath,
      providerId: body.provider,
      raw: body.event,
    });
    for (const data of resolved) {
      deps.broadcaster.broadcast(buildNodeActivityEvent(data));
    }

    return c.json({ ok: true, resolved: resolved.length }, 202);
  });
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
