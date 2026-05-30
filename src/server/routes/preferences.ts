/**
 * Preferences route, read + write the per-machine user settings.
 *
 *   GET   /api/preferences        → current envelope
 *   PATCH /api/preferences        → mutate one or more sub-keys
 *
 * The envelope carries the update-check toggle (`updateCheck.enabled`) and
 * the three telemetry consent flags (`telemetry.errorsEnabled`,
 * `telemetry.usageCliEnabled`, `telemetry.usageUiEnabled`) plus the
 * read-only anonymous usage id (`telemetry.anonymousId`, the PostHog
 * `distinct_id` the browser reuses). PATCH accepts the three toggles; the id
 * is never writable over the wire. The shape is intentionally extensible:
 * new per-machine settings land as additional optional sub-keys (locale,
 * theme).
 *
 * Persistence funnels through `cli/util/user-settings-store.ts`, the
 * single legitimate `os.homedir()` reader. The flags live at
 * `~/.skill-map/settings.json` under `updateCheck.*` / `telemetry.*`,
 * per `spec/cli-contract.md` §Scope is always project-local: this is the
 * documented exception to the no-`$HOME`-reads principle. No project
 * config layer participates; `sm config` does not surface these keys
 * (see `spec/telemetry.md` for the consent contract).
 *
 * Body validation goes through `server/util/parse-body.ts` (AJV-backed
 * factory). Errors flow through `app.onError` via `HTTPException`.
 */

import type { Hono } from 'hono';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import {
  ensureAnonymousId,
  isErrorTelemetryEnabled,
  isUpdateCheckEnabled,
  isUsageCliTelemetryEnabled,
  isUsageUiTelemetryEnabled,
  readAnonymousId,
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
  telemetry: {
    errorsEnabled: boolean;
    usageCliEnabled: boolean;
    usageUiEnabled: boolean;
    // Read-only on the wire: the browser uses it as the PostHog
    // `distinct_id` so CLI + UI usage share one anonymous install id. Never
    // accepted in a PATCH body (the schema's `additionalProperties: false`
    // rejects it). `null` until usage is first enabled.
    anonymousId: string | null;
  };
}

interface IPatchBody {
  updateCheck?: {
    enabled?: boolean;
  };
  telemetry?: {
    errorsEnabled?: boolean;
    usageCliEnabled?: boolean;
    usageUiEnabled?: boolean;
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
    telemetry: {
      errorsEnabled: isErrorTelemetryEnabled(),
      usageCliEnabled: isUsageCliTelemetryEnabled(),
      usageUiEnabled: isUsageUiTelemetryEnabled(),
      anonymousId: readAnonymousId(),
    },
  };
}

/**
 * Walk every present sub-key in `body` and persist it through the
 * user-settings store. Errors degrade to a directed 400 so a
 * permission denied / disk full surfaces predictably.
 */
function applyPatch(body: IPatchBody): void {
  try {
    if (body.updateCheck && typeof body.updateCheck.enabled === 'boolean') {
      writeUserSettings({ updateCheck: { enabled: body.updateCheck.enabled } });
    }
    if (body.telemetry) {
      applyTelemetryPatch(body.telemetry);
    }
  } catch (err) {
    throw new HTTPException(400, {
      message: tx(SERVER_TEXTS.preferencesPersistFailed, {
        message: formatErrorMessage(err),
      }),
    });
  }
}

/**
 * Persist the telemetry sub-keys. Each toggle is independent. When a usage
 * toggle is turned ON and no anonymous id exists yet, mint one so the very
 * first usage event (CLI or UI) already carries a stable `distinct_id`;
 * `ensureAnonymousId` is idempotent, so re-enabling never rotates it.
 */
function applyTelemetryPatch(t: NonNullable<IPatchBody['telemetry']>): void {
  if (typeof t.errorsEnabled === 'boolean') {
    writeUserSettings({ telemetry: { errorsEnabled: t.errorsEnabled } });
  }
  if (typeof t.usageCliEnabled === 'boolean') {
    writeUserSettings({ telemetry: { usageCliEnabled: t.usageCliEnabled } });
    if (t.usageCliEnabled) ensureAnonymousId();
  }
  if (typeof t.usageUiEnabled === 'boolean') {
    writeUserSettings({ telemetry: { usageUiEnabled: t.usageUiEnabled } });
    if (t.usageUiEnabled) ensureAnonymousId();
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
    telemetry: {
      type: 'object',
      additionalProperties: false,
      properties: {
        errorsEnabled: { type: 'boolean' },
        usageCliEnabled: { type: 'boolean' },
        usageUiEnabled: { type: 'boolean' },
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
    '/telemetry:type:object': SERVER_TEXTS.preferencesTelemetryNotObject,
    '/telemetry/errorsEnabled:type:boolean': SERVER_TEXTS.preferencesTelemetryErrorsEnabledNotBoolean,
    '/telemetry/usageCliEnabled:type:boolean': SERVER_TEXTS.preferencesTelemetryUsageCliEnabledNotBoolean,
    '/telemetry/usageUiEnabled:type:boolean': SERVER_TEXTS.preferencesTelemetryUsageUiEnabledNotBoolean,
  },
});
