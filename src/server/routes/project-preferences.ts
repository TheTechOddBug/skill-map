/**
 * Project preferences route, read + write project-scope settings.
 *
 *   GET   /api/project-preferences        → current envelope
 *   PATCH /api/project-preferences        → mutate one or more sub-keys
 *
 * Today the envelope carries the privacy-sensitive scan key
 * `scan.referencePaths` (string[]).
 *
 * Every write is gated by the same "expanding the surface?"
 * predicate the CLI's `sm config set --yes` consumes, when the
 * incoming patch would open disk access outside the project root
 * AND `confirm: true` is not in the body, the route returns 412
 * `confirm-required` with the list of paths the change would
 * expose. The UI's Project section shows that list in a confirm
 * dialog and re-issues the PATCH with `confirm: true`.
 *
 * Persistence funnels through `core/config/helper:writeConfigValue`
 * with `target: 'project'`. Mirrors `routes/preferences.ts` for the
 * body-parsing convention (AJV via `makeBodyValidator` from
 * `server/util/parse-body.ts`) so the BFF stays consistent.
 */

import { statSync } from 'node:fs';

import type { Hono } from 'hono';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import {
  projectPathExposure,
  readConfigValue,
  writeConfigValue,
} from '../../core/config/helper.js';
import { resolveScanPath } from '../../core/runtime/reference-paths-walker.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { log } from '../../kernel/util/logger.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tx } from '../../kernel/util/tx.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
import { makeBodyValidator } from '../util/parse-body.js';
import type { IRouteDeps } from './deps.js';

export interface IProjectPreferencesEnvelope {
  scan: {
    referencePaths: readonly string[];
  };
}

interface IPatchBody {
  confirm?: boolean;
  scan?: {
    referencePaths?: string[];
  };
}

export function registerProjectPreferencesRoute(app: Hono, deps: IRouteDeps): void {
  app.get('/api/project-preferences', (c) => {
    return c.json(buildEnvelope(deps));
  });

  app.patch('/api/project-preferences', async (c) => {
    const body = await parsePatchBody(c.req.raw);
    await applyPatch(deps, body);
    return c.json(buildEnvelope(deps));
  });
}

function buildEnvelope(deps: IRouteDeps): IProjectPreferencesEnvelope {
  const cwd = deps.runtimeContext.cwd;
  return {
    scan: {
      referencePaths:
        readConfigValue<string[]>('scan.referencePaths', {
          cwd,
          default: [],
        }) ?? [],
    },
  };
}

interface IPlannedWrite {
  key: 'scan.referencePaths';
  value: unknown;
}

async function applyPatch(deps: IRouteDeps, body: IPatchBody): Promise<void> {
  const writes = collectWrites(body);
  if (writes.length === 0) return;
  const cwd = deps.runtimeContext.cwd;

  // Existence gate: every NEW entry (not already present in the
  // current config) must resolve to a directory on disk. Stops
  // typos and stale paths at write time, the alternative would be
  // a scan that silently logs a missing-root advisory and ignores
  // the entry. Pre-existing entries are not re-validated so a path
  // that disappeared from disk between sessions doesn't block the
  // operator from removing OTHER paths.
  const missingPaths = collectMissingPaths(writes, cwd);
  if (missingPaths.length > 0) {
    throw new HTTPException(400, {
      message: tx(SERVER_TEXTS.projectPrefsPathNotFound, {
        paths: missingPaths.join(', '),
      }),
    });
  }

  // Privacy gate: aggregate every exposure across the patch and
  // refuse the write when ANY sub-key expands the surface without
  // an explicit `confirm: true`.
  const exposures = writes
    .map((w) => projectPathExposure({ key: w.key, value: w.value, cwd }))
    .filter((e) => e.expandsSurface);
  if (exposures.length > 0 && body.confirm !== true) {
    const exposed = exposures.flatMap((e) => e.exposedPaths);
    throw new HTTPException(412, {
      message: tx(SERVER_TEXTS.projectPrefsConfirmRequired, {
        paths: exposed.join(', '),
      }),
    });
  }

  let scanSurfaceMutated = false;
  for (const w of writes) {
    if (runWrite(w, cwd)) scanSurfaceMutated = true;
  }

  // Best-effort watcher restart: `scan.referencePaths` is re-walked on
  // every batch by the runtime so the next file edit picks it up
  // anyway, but the restart guarantees the operator sees the effect
  // of a write without waiting for an unrelated edit. Failures here
  // do not roll back the on-disk write.
  if (scanSurfaceMutated) await maybeRestartWatcher(deps);
  // Successful writes mutate the on-disk config; the cached view
  // would now hand out stale state. Drop it so the next consumer
  // re-reads from disk.
  deps.configService.reload();
}

function collectWrites(body: IPatchBody): IPlannedWrite[] {
  if (!body.scan) return [];
  const out: IPlannedWrite[] = [];
  if (Array.isArray(body.scan.referencePaths)) {
    out.push({ key: 'scan.referencePaths', value: body.scan.referencePaths });
  }
  return out;
}

/**
 * For each planned write, diff the incoming array against the
 * currently-persisted one and validate that every NEW entry resolves
 * to an existing directory on disk (after `~` expansion + relative-
 * to-cwd resolution). Returns the list of entries (original strings,
 * not the expanded paths) that failed the check.
 */
function collectMissingPaths(writes: IPlannedWrite[], cwd: string): string[] {
  const missing: string[] = [];
  for (const w of writes) {
    if (!Array.isArray(w.value)) continue;
    const current = readConfigValue<string[]>(w.key, { cwd, default: [] }) ?? [];
    const currentSet = new Set(current);
    // AJV already validated `items: { type: 'string', pattern: '...' }`
    // upstream, so every entry is a string here.
    for (const entry of w.value as string[]) {
      if (currentSet.has(entry)) continue;
      if (!isExistingDirectory(entry, cwd)) missing.push(entry);
    }
  }
  return missing;
}

/**
 * Diff the persisted-before-the-write snapshot against the patch's
 * incoming array and emit one `log.info` line per added / removed
 * path. Lets the operator see settings-side mutations land on the
 * server's stderr without opening the DB or the config file. Paths
 * are sanitised through `sanitizeForTerminal` so a hostile entry
 * cannot smuggle ANSI / C0 controls into the log stream.
 */
/**
 * Best-effort watcher reload. Swallows + logs failures so a flaky
 * chokidar boot does not roll back the on-disk config write; the
 * advisory message tells the operator to restart `sm serve`
 * manually in that case.
 */
async function maybeRestartWatcher(deps: IRouteDeps): Promise<void> {
  const watcher = deps.watcherHolder.current;
  if (!watcher) return;
  try {
    await watcher.restart();
  } catch (err) {
    log.warn(
      tx(SERVER_TEXTS.projectPrefsWatcherRestartFailed, {
        message: formatErrorMessage(err),
      }),
    );
  }
}

/**
 * Snapshot the current persisted value, persist the write, then log
 * the diff. Extracted from `applyPatch` so the cyclomatic budget of
 * the per-write step (snapshot + write + log) does not blow up the
 * orchestrator's complexity. Throws `HTTPException(400)` on persist
 * failure with the catalog message; the caller funnels through the
 * global `app.onError`.
 *
 * Returns `true` when the persisted value actually changed (added /
 * removed entries), so the caller can decide whether to fire the
 * watcher restart. A no-op write (same array contents) returns
 * `false` and the watcher stays untouched.
 */
function runWrite(w: IPlannedWrite, cwd: string): boolean {
  // Snapshot the persisted array BEFORE the write so we can diff
  // (and log) after a successful persist. Reads from the loader
  // cache, no extra disk hit.
  const before = readConfigValue<string[]>(w.key, { cwd, default: [] }) ?? [];
  try {
    // PROJECT_LOCAL_ONLY keys (`scan.referencePaths`,
    // `allowEditSmFiles`) can never live in the committed project
    // layer, the loader strips them with a warning. Persist to
    // `project-local` (gitignored, per-checkout) instead.
    writeConfigValue(w.key, w.value, { target: 'project-local', cwd });
  } catch (err) {
    throw new HTTPException(400, {
      message: tx(SERVER_TEXTS.projectPrefsPersistFailed, {
        key: w.key,
        message: formatErrorMessage(err),
      }),
    });
  }
  logPathChanges(w.key, before, w.value, cwd);
  return arrayChanged(before, w.value);
}

/**
 * Set-equality check, ignores ordering. The route's UX is "manage a
 * list of paths"; reordering the array via PATCH counts as a no-op,
 * only added / removed entries warrant a watcher restart.
 */
function arrayChanged(before: readonly string[], nextValue: unknown): boolean {
  if (!Array.isArray(nextValue)) return false;
  const next = nextValue as string[];
  if (before.length !== next.length) return true;
  const beforeSet = new Set(before);
  for (const p of next) {
    if (!beforeSet.has(p)) return true;
  }
  return false;
}

function logPathChanges(
  key: string,
  before: readonly string[],
  nextValue: unknown,
  cwd: string,
): void {
  if (!Array.isArray(nextValue)) return;
  const next = nextValue as string[];
  const beforeSet = new Set(before);
  const nextSet = new Set(next);
  for (const path of next) {
    if (beforeSet.has(path)) continue;
    log.warn(
      tx(SERVER_TEXTS.projectPrefsPathAdded, {
        key,
        detail: formatPathDetail(path, cwd),
      }),
    );
  }
  for (const path of before) {
    if (nextSet.has(path)) continue;
    log.warn(
      tx(SERVER_TEXTS.projectPrefsPathRemoved, {
        key,
        detail: formatPathDetail(path, cwd),
      }),
    );
  }
}

/**
 * Compose the log line's `{{detail}}` for one path entry:
 *
 *   - home (`~/foo`, `~`)           → `~/foo (home) → /home/<u>/foo`
 *   - relative (`./foo`, `foo/bar`) → `foo/bar (relative) → <cwd>/foo/bar`
 *   - absolute (`/foo`, `/Volumes`) → `/foo (absolute)`
 *
 * Both the user-typed string and the resolved absolute path go
 * through `sanitizeForTerminal` so a hostile config value cannot
 * smuggle ANSI / C0 controls into the operator's log stream.
 */
function formatPathDetail(path: string, cwd: string): string {
  const safePath = sanitizeForTerminal(path);
  if (path.startsWith('~/') || path === '~') {
    const abs = sanitizeForTerminal(resolveScanPath(path, cwd));
    return `${safePath} (home) → ${abs}`;
  }
  if (path.startsWith('/')) {
    return `${safePath} (absolute)`;
  }
  const abs = sanitizeForTerminal(resolveScanPath(path, cwd));
  return `${safePath} (relative) → ${abs}`;
}

/**
 * Resolve `entry` through `resolveScanPath` (expands `~`, joins to
 * cwd) and `statSync` it. Returns `true` only when the resolved path
 * is a directory on disk; any FS error counts as missing.
 */
function isExistingDirectory(entry: string, cwd: string): boolean {
  const abs = resolveScanPath(entry, cwd);
  try {
    return statSync(abs).isDirectory();
  } catch {
    return false;
  }
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
        referencePaths: {
          type: 'array',
          items: { type: 'string', pattern: '^[^,]+$' },
        },
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
    '/scan/referencePaths:type:array': tx(SERVER_TEXTS.projectPrefsListNotArray, { key: 'scan.referencePaths' }),
    '/scan/referencePaths/*:type:string': tx(SERVER_TEXTS.projectPrefsListEntryNotString, { key: 'scan.referencePaths' }),
    '/scan/referencePaths/*:pattern': SERVER_TEXTS.projectPrefsEntryHasComma,
  },
});
