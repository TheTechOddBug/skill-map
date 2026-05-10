/**
 * Preferences route — read + write user-scope settings.
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
 * Mirrors `routes/plugins.ts` for body parsing (manual `req.json()` +
 * shape guards, no Zod) so the BFF stays consistent with the existing
 * convention. Errors flow through `app.onError` via `HTTPException`.
 */

import type { Hono } from 'hono';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import { readConfigValue, writeConfigValue } from '../../core/config/helper.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { tx } from '../../kernel/util/tx.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
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
  if (body.updateCheck && typeof body.updateCheck.enabled === 'boolean') {
    try {
      writeConfigValue('updateCheck.enabled', body.updateCheck.enabled, {
        target: 'user',
        cwd: deps.runtimeContext.cwd,
        homedir: deps.runtimeContext.homedir,
      });
    } catch (err) {
      throw new HTTPException(400, {
        message: tx(SERVER_TEXTS.preferencesPersistFailed, {
          message: formatErrorMessage(err),
        }),
      });
    }
  }
}

async function parsePatchBody(req: Request): Promise<IPatchBody> {
  const obj = await readJsonObject(req);
  const out: IPatchBody = {};
  if ('updateCheck' in obj) {
    out.updateCheck = parseUpdateCheckBlock(obj['updateCheck']);
  }
  // Empty body (no recognised sub-key) is a 400 — the route's intent
  // is to mutate something. Returning the unchanged envelope on a
  // no-op patch would mask client bugs (typoed key, wrong nesting).
  if (Object.keys(out).length === 0) {
    throw new HTTPException(400, { message: SERVER_TEXTS.preferencesBodyEmpty });
  }
  return out;
}

async function readJsonObject(req: Request): Promise<Record<string, unknown>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HTTPException(400, { message: SERVER_TEXTS.preferencesBodyNotJson });
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new HTTPException(400, { message: SERVER_TEXTS.preferencesBodyNotObject });
  }
  return raw as Record<string, unknown>;
}

/**
 * Parse the `updateCheck` sub-key of the patch body. `{}` is allowed
 * (treated as "no fields to change here") so a future partial-patch
 * client doesn't have to special-case "I have nothing for this
 * block." Throws 400 with a directed message on every other shape.
 */
function parseUpdateCheckBlock(block: unknown): { enabled?: boolean } {
  if (block === null || typeof block !== 'object' || Array.isArray(block)) {
    throw new HTTPException(400, {
      message: SERVER_TEXTS.preferencesUpdateCheckNotObject,
    });
  }
  const sub = block as Record<string, unknown>;
  if (!('enabled' in sub)) return {};
  if (typeof sub['enabled'] !== 'boolean') {
    throw new HTTPException(400, {
      message: SERVER_TEXTS.preferencesUpdateCheckEnabledNotBoolean,
    });
  }
  return { enabled: sub['enabled'] };
}
