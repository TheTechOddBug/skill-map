/**
 * Preferences route, read + write the update-check toggle.
 *
 *   GET   /api/preferences        → current envelope
 *   PATCH /api/preferences        → mutate one or more sub-keys
 *
 * Today the envelope carries a single sub-key (`updateCheck.enabled`)
 * but the shape is intentionally extensible. New per-machine settings
 * land as additional optional sub-keys under their own namespace.
 *
 * Persistence funnels through `cli/util/user-settings-store.ts`, the
 * single legitimate `os.homedir()` reader. The toggle lives at
 * `~/.skill-map/settings.json` under `updateCheck.*` alongside the
 * throttle cache, per `spec/cli-contract.md` §Scope is always
 * project-local: this is the documented exception to the
 * no-`$HOME`-reads principle. No project config layer participates;
 * `sm config` does not surface `updateCheck.enabled`.
 *
 * Body validation goes through `server/util/parse-body.ts` (AJV-backed
 * factory). Errors flow through `app.onError` via `HTTPException`.
 */

import type { Hono } from 'hono';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import {
  isUpdateCheckEnabled,
  writeUserSettings,
} from '../../cli/util/user-settings-store.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { tx } from '../../kernel/util/tx.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
import { makeBodyValidator } from '../util/parse-body.js';
import type { IRouteDeps } from './deps.js';

export interface IPreferencesEnvelope {
  updateCheck: {
    enabled: boolean;
  };
}

interface IPatchBody {
  updateCheck?: {
    enabled?: boolean;
  };
}

export function registerPreferencesRoute(app: Hono, _deps: IRouteDeps): void {
  app.get('/api/preferences', (c) => {
    return c.json(buildEnvelope());
  });

  app.patch('/api/preferences', async (c) => {
    const body = await parsePatchBody(c.req.raw);
    applyPatch(body);
    return c.json(buildEnvelope());
  });
}

/**
 * Read the live envelope from `~/.skill-map/settings.json`.
 * Defaults match the schema (`enabled = true`) so an absent or
 * malformed file reports the shipped-as default rather than
 * `undefined` on the wire.
 */
function buildEnvelope(): IPreferencesEnvelope {
  return {
    updateCheck: { enabled: isUpdateCheckEnabled() },
  };
}

/**
 * Walk every present sub-key in `body` and persist it through the
 * user-settings store. Errors degrade to a directed 400 so a
 * permission denied / disk full surfaces predictably.
 */
function applyPatch(body: IPatchBody): void {
  if (body.updateCheck && typeof body.updateCheck.enabled === 'boolean') {
    try {
      writeUserSettings({ updateCheck: { enabled: body.updateCheck.enabled } });
    } catch (err) {
      throw new HTTPException(400, {
        message: tx(SERVER_TEXTS.preferencesPersistFailed, {
          message: formatErrorMessage(err),
        }),
      });
    }
  }
}

/**
 * Body schema for `PATCH /api/preferences`. `minProperties: 1` rejects
 * `{}` (no-op patches mask client bugs, typoed key, wrong nesting);
 * `additionalProperties: false` at every level catches the same on
 * unknown keys. Add a new per-machine preference as another optional
 * sub-key here and append its error mappings below.
 */
const PATCH_BODY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    updateCheck: {
      type: 'object',
      additionalProperties: false,
      properties: {
        enabled: { type: 'boolean' },
      },
    },
  },
} as const;

const parsePatchBody = makeBodyValidator<IPatchBody>(PATCH_BODY_SCHEMA, {
  notJson: SERVER_TEXTS.preferencesBodyNotJson,
  notObject: SERVER_TEXTS.preferencesBodyNotObject,
  invalid: SERVER_TEXTS.preferencesBodyEmpty,
  mapping: {
    ':minProperties': SERVER_TEXTS.preferencesBodyEmpty,
    '/updateCheck:type:object': SERVER_TEXTS.preferencesUpdateCheckNotObject,
    '/updateCheck/enabled:type:boolean': SERVER_TEXTS.preferencesUpdateCheckEnabledNotBoolean,
  },
});
