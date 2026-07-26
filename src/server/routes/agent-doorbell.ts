/**
 * `POST /api/agent/doorbell`, the wake-endpoint registration for the
 * agent doorbell (`spec/job-lifecycle.md` §Agent doorbell,
 * `spec/cli-contract.md` route row).
 *
 * Same trust boundary as the activity ingest: loopback-gated like every
 * `/api/*` route PLUS the per-session serve.json token (403 before any
 * body processing). The body is one `{ url }`; the doorbell itself
 * enforces the loopback-host rule on the URL (a non-loopback
 * registration answers 422 and registers nothing), so the server can
 * never be steered into calling out.
 */

import type { Hono } from 'hono';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import type { AgentDoorbell } from '../agent-doorbell.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
import { assertIngestToken, INGEST_TOKEN_HEADER } from '../util/ingest-token.js';
import { makeBodyValidator } from '../util/parse-body.js';
import type { IRouteDeps } from './deps.js';

interface IDoorbellBody {
  /** The runtime's local HTTP API base (OpenCode's own `serverUrl`). */
  url: string;
}

const DOORBELL_BODY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['url'],
  properties: {
    url: { type: 'string', minLength: 1 },
  },
} as const;

const parseBody = makeBodyValidator<IDoorbellBody>(DOORBELL_BODY_SCHEMA, {
  notJson: SERVER_TEXTS.doorbellBodyInvalid,
  notObject: SERVER_TEXTS.doorbellBodyInvalid,
  invalid: SERVER_TEXTS.doorbellBodyInvalid,
  mapping: {
    '/url:required': SERVER_TEXTS.doorbellUrlRequired,
    '/url:type:string': SERVER_TEXTS.doorbellUrlRequired,
    '/url:minLength': SERVER_TEXTS.doorbellUrlRequired,
  },
});

export interface IAgentDoorbellRouteDeps extends IRouteDeps {
  /** Per-session shared secret minted by the composition root at boot. */
  activityToken: string;
  doorbell: AgentDoorbell;
}

export function registerAgentDoorbellRoute(app: Hono, deps: IAgentDoorbellRouteDeps): void {
  app.post('/api/agent/doorbell', async (c) => {
    assertIngestToken(c.req.raw.headers.get(INGEST_TOKEN_HEADER), deps.activityToken);
    const body = await parseBody(c.req.raw);
    const outcome = deps.doorbell.register(body.url);
    if (outcome !== 'registered') {
      throw new HTTPException(422, { message: SERVER_TEXTS.doorbellUrlNotLoopback });
    }
    return c.json({ ok: true }, 202);
  });
}
