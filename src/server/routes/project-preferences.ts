/**
 * Project preferences route — read + write project-scope settings.
 *
 *   GET   /api/project-preferences        → current envelope
 *   PATCH /api/project-preferences        → mutate one or more sub-keys
 *
 * Today the envelope carries the two privacy-sensitive scan keys:
 *   - `scan.extraFolders`     (string[])
 *   - `scan.referencePaths`   (string[])
 *
 * Every write is gated by the same "expanding the surface?"
 * predicate the CLI's `sm config set --yes` consumes — when the
 * incoming patch would open disk access outside the project root
 * AND `confirm: true` is not in the body, the route returns 412
 * `confirm-required` with the list of paths the change would
 * expose. The UI's Project section shows that list in a confirm
 * dialog and re-issues the PATCH with `confirm: true`.
 *
 * Persistence funnels through `core/config/helper:writeConfigValue`
 * with `target: 'project'`. Mirrors `routes/preferences.ts` for the
 * body-parsing convention (manual `req.json()` + shape guards, no
 * Zod) so the BFF stays consistent.
 */

import type { Hono } from 'hono';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import {
  ConfigValidationError,
  projectPathExposure,
  readConfigValue,
  writeConfigValue,
} from '../../core/config/helper.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { tx } from '../../kernel/util/tx.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
import { makeBodyValidator } from '../util/parse-body.js';
import type { IRouteDeps } from './deps.js';

export interface IProjectPreferencesEnvelope {
  scan: {
    extraFolders: readonly string[];
    referencePaths: readonly string[];
  };
}

interface IPatchBody {
  confirm?: boolean;
  scan?: {
    extraFolders?: string[];
    referencePaths?: string[];
  };
}

export function registerProjectPreferencesRoute(app: Hono, deps: IRouteDeps): void {
  app.get('/api/project-preferences', (c) => {
    return c.json(buildEnvelope(deps));
  });

  app.patch('/api/project-preferences', async (c) => {
    const body = await parsePatchBody(c.req.raw);
    applyPatch(deps, body);
    return c.json(buildEnvelope(deps));
  });
}

function buildEnvelope(deps: IRouteDeps): IProjectPreferencesEnvelope {
  const cwd = deps.runtimeContext.cwd;
  const homedir = deps.runtimeContext.homedir;
  return {
    scan: {
      extraFolders:
        readConfigValue<string[]>('scan.extraFolders', {
          scope: 'project',
          cwd,
          homedir,
          default: [],
        }) ?? [],
      referencePaths:
        readConfigValue<string[]>('scan.referencePaths', {
          scope: 'project',
          cwd,
          homedir,
          default: [],
        }) ?? [],
    },
  };
}

interface IPlannedWrite {
  key: 'scan.extraFolders' | 'scan.referencePaths';
  value: unknown;
}

function applyPatch(deps: IRouteDeps, body: IPatchBody): void {
  const writes = collectWrites(body);
  if (writes.length === 0) return;
  const cwd = deps.runtimeContext.cwd;
  const homedir = deps.runtimeContext.homedir;

  // Privacy gate: aggregate every exposure across the patch and
  // refuse the write when ANY sub-key expands the surface without
  // an explicit `confirm: true`.
  const exposures = writes
    .map((w) => projectPathExposure({ key: w.key, value: w.value, cwd, homedir }))
    .filter((e) => e.expandsSurface);
  if (exposures.length > 0 && body.confirm !== true) {
    const exposed = exposures.flatMap((e) => e.exposedPaths);
    throw new HTTPException(412, {
      message: tx(SERVER_TEXTS.projectPrefsConfirmRequired, {
        paths: exposed.join(', '),
      }),
    });
  }

  for (const w of writes) {
    try {
      // PROJECT_LOCAL_ONLY keys (`scan.extraFolders`,
      // `scan.referencePaths`, `allowEditSmFiles`) can never live in
      // the committed project layer — the loader strips them with a
      // warning. Persist to `project-local` (gitignored,
      // per-checkout) instead.
      writeConfigValue(w.key, w.value, { target: 'project-local', cwd, homedir });
    } catch (err) {
      const status = err instanceof ConfigValidationError ? 400 : 400;
      throw new HTTPException(status, {
        message: tx(SERVER_TEXTS.projectPrefsPersistFailed, {
          key: w.key,
          message: formatErrorMessage(err),
        }),
      });
    }
  }
  // Successful writes mutate the on-disk config; the cached view
  // would now hand out stale state. Drop it so the next consumer
  // re-reads from disk.
  deps.configService.reload();
}

function collectWrites(body: IPatchBody): IPlannedWrite[] {
  if (!body.scan) return [];
  const out: IPlannedWrite[] = [];
  if (Array.isArray(body.scan.extraFolders)) {
    out.push({ key: 'scan.extraFolders', value: body.scan.extraFolders });
  }
  if (Array.isArray(body.scan.referencePaths)) {
    out.push({ key: 'scan.referencePaths', value: body.scan.referencePaths });
  }
  return out;
}

/**
 * Body schema for `PATCH /api/project-preferences`. Requires `scan`
 * with at least one of the two sub-keys present; rejects unknown
 * keys at every level (`additionalProperties: false`). The `confirm`
 * flag is optional and only consumed by the privacy gate when the
 * patch would expand disk access.
 */
const PATCH_BODY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['scan'],
  properties: {
    confirm: { type: 'boolean' },
    scan: {
      type: 'object',
      additionalProperties: false,
      minProperties: 1,
      properties: {
        extraFolders: { type: 'array', items: { type: 'string' } },
        referencePaths: { type: 'array', items: { type: 'string' } },
      },
    },
  },
} as const;

const parsePatchBody = makeBodyValidator<IPatchBody>(PATCH_BODY_SCHEMA, {
  notJson: SERVER_TEXTS.projectPrefsBodyNotJson,
  notObject: SERVER_TEXTS.projectPrefsBodyNotObject,
  invalid: SERVER_TEXTS.projectPrefsBodyEmpty,
  mapping: {
    '/scan:required': SERVER_TEXTS.projectPrefsBodyEmpty,
    '/scan:minProperties': SERVER_TEXTS.projectPrefsBodyEmpty,
    '/scan:type:object': SERVER_TEXTS.projectPrefsScanNotObject,
    '/confirm:type:boolean': SERVER_TEXTS.projectPrefsConfirmNotBoolean,
    '/scan/extraFolders:type:array': tx(SERVER_TEXTS.projectPrefsListNotArray, { key: 'scan.extraFolders' }),
    '/scan/referencePaths:type:array': tx(SERVER_TEXTS.projectPrefsListNotArray, { key: 'scan.referencePaths' }),
    '/scan/extraFolders/*:type:string': tx(SERVER_TEXTS.projectPrefsListEntryNotString, { key: 'scan.extraFolders' }),
    '/scan/referencePaths/*:type:string': tx(SERVER_TEXTS.projectPrefsListEntryNotString, { key: 'scan.referencePaths' }),
  },
});
