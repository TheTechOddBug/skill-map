/**
 * Preferences route, read + write user-scope settings.
 *
 *   GET   /api/preferences        → current envelope
 *   PATCH /api/preferences        → mutate one or more sub-keys
 *
 * Today the envelope carries a single sub-key (`updateCheck.enabled`)
 * but the shape is intentionally extensible. New user-only settings
 * land as additional optional sub-keys under their own namespace
 * (`{ updateCheck: ..., locale: ..., theme: ... }`); the route
 * iterates the present keys at write time so each new addition is one
 * branch + one message constant.
 *
 * Persistence funnels through `core/config/helper:writeConfigValue`
 * with `target: 'user'`. Because the keys touched here are in
 * `USER_ONLY_KEYS`, the helper rejects any attempt to redirect them
 * to project; the route never exposes that switch on the wire so a
 * misbehaving client cannot smuggle a project-layer write.
 *
 * Body validation goes through `server/util/parse-body.ts` (AJV-backed
 * factory). Errors flow through `app.onError` via `HTTPException`.
 */

import type { Hono } from 'hono';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import { readConfigValue, writeConfigValue } from '../../core/config/helper.js';
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

export function registerPreferencesRoute(app: Hono, deps: IRouteDeps): void {
  app.get('/api/preferences', (c) => {
    return c.json(buildEnvelope(deps));
  });

  app.patch('/api/preferences', async (c) => {
    const body = await parsePatchBody(c.req.raw);
    applyPatch(deps, body);
    return c.json(buildEnvelope(deps));
  });
}

/**
 * Read the live envelope via `readConfigValue` (which forces
 * `scope: 'global'` for `USER_ONLY_KEYS`). Defaults match
 * `project-config.schema.json` so an absent key reports the
 * shipped-as default rather than `undefined` on the wire.
 */
function buildEnvelope(deps: IRouteDeps): IPreferencesEnvelope {
  const enabled =
    readConfigValue<boolean>('updateCheck.enabled', {
      scope: 'global',
      cwd: deps.runtimeContext.cwd,
      homedir: deps.runtimeContext.homedir,
      default: true,
    }) ?? true;
  return {
    updateCheck: { enabled },
  };
}

/**
 * Walk every present sub-key in `body` and persist it via the helper.
 * `writeConfigValue` is itself the validator (AJV-revalidates the
 * merged file after the mutation), so a value that violates
 * `project-config.schema.json` reaches the catch and surfaces as a
 * directed 400.
 */
function applyPatch(deps: IRouteDeps, body: IPatchBody): void {
  let wrote = false;
  if (body.updateCheck && typeof body.updateCheck.enabled === 'boolean') {
    try {
      writeConfigValue('updateCheck.enabled', body.updateCheck.enabled, {
        target: 'user',
        cwd: deps.runtimeContext.cwd,
        homedir: deps.runtimeContext.homedir,
      });
      wrote = true;
    } catch (err) {
      throw new HTTPException(400, {
        message: tx(SERVER_TEXTS.preferencesPersistFailed, {
          message: formatErrorMessage(err),
        }),
      });
    }
  }
  // Successful write, drop the cached config view so the next
  // consumer re-reads from disk.
  if (wrote) deps.configService.reload();
}

/**
 * Body schema for `PATCH /api/preferences`. `minProperties: 1` rejects
 * `{}` (no-op patches mask client bugs, typoed key, wrong nesting);
 * `additionalProperties: false` at every level catches the same on
 * unknown keys. Add a new user-only preference as another optional
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
