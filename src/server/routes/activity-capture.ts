/**
 * Conversation-capture gate (see `spec/provider-activity.md`
 * §Conversation capture):
 *
 *   - `GET  /api/activity/capture` → `{ enabled }`.
 *   - `POST /api/activity/capture` `{ enabled, confirm }` → toggles the
 *     gate. Without `confirm: true` the server refuses `412
 *     confirm-required` and changes NOTHING, the same server-enforced
 *     consent pattern `activity-install.ts` applies to both of its
 *     mutations (enabling starts retaining inter-agent conversation
 *     content in memory; disabling clears the store, both deliberate).
 *
 * Persistence mirrors `routes/project-preferences.ts`: the boolean
 * lands on the config key `activity.captureConversations` via
 * `writeConfigValue` targeting the gitignored `project-local` layer
 * (the key is `PROJECT_LOCAL_ONLY`, consent is per-operator), followed
 * by a `configService.reload()`. The in-memory store updates
 * SYNCHRONOUSLY after a successful persist, so turning the gate off
 * clears retained conversations before the response leaves.
 *
 * Loopback-gated like every `/api/*` route; no serve.json token
 * (operator UI surface, not the bridge's ingest path).
 */

import type { Hono } from 'hono';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import { writeConfigValue } from '../../core/config/helper.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { tx } from '../../kernel/util/tx.js';
import type { ActivityConversationStore } from '../activity-conversations.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
import { makeBodyValidator } from '../util/parse-body.js';
import type { IRouteDeps } from './deps.js';

/** Config key backing the gate (project-local layer only). */
export const CAPTURE_CONFIG_KEY = 'activity.captureConversations';

interface ICaptureBody {
  enabled: boolean;
  /** Server-enforced consent: the mutation refuses 412 without `true`. */
  confirm?: boolean;
}

const CAPTURE_BODY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['enabled'],
  properties: {
    enabled: { type: 'boolean' },
    confirm: { type: 'boolean' },
  },
} as const;

const parseCaptureBody = makeBodyValidator<ICaptureBody>(CAPTURE_BODY_SCHEMA, {
  notJson: SERVER_TEXTS.activityBodyNotJson,
  notObject: SERVER_TEXTS.activityBodyNotObject,
  invalid: SERVER_TEXTS.activityBodyNotObject,
  mapping: {
    '/enabled:required': SERVER_TEXTS.activityCaptureEnabledRequired,
    '/enabled:type:boolean': SERVER_TEXTS.activityCaptureEnabledRequired,
    '/confirm:type:boolean': SERVER_TEXTS.activityCaptureConfirmNotBoolean,
  },
});

export interface IActivityCaptureRouteDeps extends IRouteDeps {
  /**
   * Consent-gated conversation store. Explicit extra dep by custody
   * contract (never on `IRouteDeps`, see `activity-conversations.ts`).
   */
  conversations: ActivityConversationStore;
}

export function registerActivityCaptureRoutes(
  app: Hono,
  deps: IActivityCaptureRouteDeps,
): void {
  app.get('/api/activity/capture', (c) => {
    return c.json({ enabled: deps.conversations.enabled });
  });

  app.post('/api/activity/capture', async (c) => {
    const body = await parseCaptureBody(c.req.raw);
    if (body.confirm !== true) {
      throw new HTTPException(412, {
        message: SERVER_TEXTS.activityCaptureConfirmRequired,
      });
    }
    try {
      writeConfigValue(CAPTURE_CONFIG_KEY, body.enabled, {
        target: 'project-local',
        cwd: deps.runtimeContext.cwd,
      });
    } catch (err) {
      throw new HTTPException(400, {
        message: tx(SERVER_TEXTS.activityCapturePersistFailed, {
          message: formatErrorMessage(err),
        }),
      });
    }
    deps.configService.reload();
    deps.conversations.setEnabled(body.enabled);
    return c.json({ enabled: deps.conversations.enabled });
  });
}
