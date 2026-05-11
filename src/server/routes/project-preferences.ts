/**
 * Project preferences route — read + write project-scope settings.
 *
 *   GET   /api/project-preferences        → current envelope
 *   PATCH /api/project-preferences        → mutate one or more sub-keys
 *
 * Today the envelope carries the three privacy-sensitive scan keys:
 *   - `scan.includeHome`       (boolean)
 *   - `scan.extraRoots`        (string[])
 *   - `scan.referencePaths`    (string[])
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
import type { IRouteDeps } from './deps.js';

export interface IProjectPreferencesEnvelope {
  scan: {
    includeHome: boolean;
    extraRoots: readonly string[];
    referencePaths: readonly string[];
  };
}

interface IPatchBody {
  confirm?: boolean;
  scan?: {
    includeHome?: boolean;
    extraRoots?: string[];
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
      includeHome:
        readConfigValue<boolean>('scan.includeHome', {
          scope: 'project',
          cwd,
          homedir,
          default: false,
        }) ?? false,
      extraRoots:
        readConfigValue<string[]>('scan.extraRoots', {
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
  key: 'scan.includeHome' | 'scan.extraRoots' | 'scan.referencePaths';
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
      // PROJECT_LOCAL_ONLY keys (`scan.includeHome`,
      // `scan.extraRoots`, `scan.referencePaths`, `allowEditSmFiles`)
      // can never live in the committed project layer — the loader
      // strips them with a warning. Persist to `project-local`
      // (gitignored, per-checkout) instead.
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
  if (typeof body.scan.includeHome === 'boolean') {
    out.push({ key: 'scan.includeHome', value: body.scan.includeHome });
  }
  if (Array.isArray(body.scan.extraRoots)) {
    out.push({ key: 'scan.extraRoots', value: body.scan.extraRoots });
  }
  if (Array.isArray(body.scan.referencePaths)) {
    out.push({ key: 'scan.referencePaths', value: body.scan.referencePaths });
  }
  return out;
}

async function parsePatchBody(req: Request): Promise<IPatchBody> {
  const obj = await readJsonObject(req);
  const out: IPatchBody = {};
  if ('confirm' in obj) {
    if (typeof obj['confirm'] !== 'boolean') {
      throw new HTTPException(400, { message: SERVER_TEXTS.projectPrefsConfirmNotBoolean });
    }
    out.confirm = obj['confirm'];
  }
  if ('scan' in obj) {
    out.scan = parseScanBlock(obj['scan']);
  }
  if (!out.scan || Object.keys(out.scan).length === 0) {
    throw new HTTPException(400, { message: SERVER_TEXTS.projectPrefsBodyEmpty });
  }
  return out;
}

async function readJsonObject(req: Request): Promise<Record<string, unknown>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HTTPException(400, { message: SERVER_TEXTS.projectPrefsBodyNotJson });
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new HTTPException(400, { message: SERVER_TEXTS.projectPrefsBodyNotObject });
  }
  return raw as Record<string, unknown>;
}

function parseScanBlock(block: unknown): NonNullable<IPatchBody['scan']> {
  if (block === null || typeof block !== 'object' || Array.isArray(block)) {
    throw new HTTPException(400, { message: SERVER_TEXTS.projectPrefsScanNotObject });
  }
  const sub = block as Record<string, unknown>;
  const out: NonNullable<IPatchBody['scan']> = {};
  if ('includeHome' in sub) {
    if (typeof sub['includeHome'] !== 'boolean') {
      throw new HTTPException(400, { message: SERVER_TEXTS.projectPrefsIncludeHomeNotBoolean });
    }
    out.includeHome = sub['includeHome'];
  }
  if ('extraRoots' in sub) {
    out.extraRoots = parseStringArray(sub['extraRoots'], 'scan.extraRoots');
  }
  if ('referencePaths' in sub) {
    out.referencePaths = parseStringArray(sub['referencePaths'], 'scan.referencePaths');
  }
  return out;
}

function parseStringArray(raw: unknown, label: string): string[] {
  if (!Array.isArray(raw)) {
    throw new HTTPException(400, { message: tx(SERVER_TEXTS.projectPrefsListNotArray, { key: label }) });
  }
  for (const entry of raw) {
    if (typeof entry !== 'string') {
      throw new HTTPException(400, { message: tx(SERVER_TEXTS.projectPrefsListEntryNotString, { key: label }) });
    }
  }
  return raw as string[];
}
