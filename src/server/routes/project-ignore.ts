/**
 * Project-ignore route, read + write the project-root
 * `.skillmapignore` file (gitignore-syntax) from the UI.
 *
 *   GET   /api/project-ignore        → current envelope { patterns }
 *   PATCH /api/project-ignore        → replace the active pattern list
 *
 * Why a dedicated route rather than an extension of
 * `/api/project-preferences`: `.skillmapignore` is its own artifact
 * (project-root file, not a config-layer key) and bundling the two
 * backings under a single envelope would smear the invariants the
 * `core/config/helper` family relies on.
 *
 * Privacy gate: NONE. Ignore patterns can only NARROW the scan
 * surface; there is no path that an attacker (or a typo) could send
 * here to widen disk access. Mirrors the "narrowing → no confirm"
 * branch of `project-preferences`.
 *
 * Existence gate: NONE. Entries are patterns, not paths, and
 * gitignore-style globs do not need to resolve to a directory on
 * disk to be useful.
 *
 * Persistence funnels through `util/skillmapignore-io.ts`. On success
 * the route triggers `watcherHolder.current?.restart()` so the next
 * batch consumes the rebuilt ignore filter without waiting on an
 * unrelated edit.
 */

import type { Hono } from 'hono';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { log } from '../../kernel/util/logger.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tx } from '../../kernel/util/tx.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
import { makeBodyValidator } from '../util/parse-body.js';
import { readPatterns, writePatterns } from '../util/skillmapignore-io.js';
import type { IRouteDeps } from './deps.js';

export interface IProjectIgnoreEnvelope {
  patterns: readonly string[];
}

interface IPatchBody {
  patterns: string[];
}

export function registerProjectIgnoreRoute(app: Hono, deps: IRouteDeps): void {
  app.get('/api/project-ignore', (c) => {
    return c.json(buildEnvelope(deps));
  });

  app.patch('/api/project-ignore', async (c) => {
    const body = await parsePatchBody(c.req.raw);
    await applyPatch(deps, body);
    return c.json(buildEnvelope(deps));
  });
}

function buildEnvelope(deps: IRouteDeps): IProjectIgnoreEnvelope {
  const cwd = deps.runtimeContext.cwd;
  return { patterns: readPatterns(cwd) };
}

async function applyPatch(deps: IRouteDeps, body: IPatchBody): Promise<void> {
  const cwd = deps.runtimeContext.cwd;

  // Server-side trim + duplicate guard. The AJV schema enforces shape
  // (string[]) and a per-entry pattern that already excludes control
  // chars; the schema cannot collapse whitespace or detect duplicates
  // post-trim. Doing it here keeps the on-disk contract clean:
  // `.skillmapignore` never carries leading/trailing whitespace or
  // duplicate lines because of a write through this route.
  const trimmed: string[] = [];
  const seen = new Set<string>();
  for (const raw of body.patterns) {
    const t = raw.trim();
    if (t.length === 0) {
      throw new HTTPException(400, {
        message: SERVER_TEXTS.projectIgnorePatternEmpty,
      });
    }
    if (seen.has(t)) {
      throw new HTTPException(400, {
        message: tx(SERVER_TEXTS.projectIgnorePatternDuplicate, { pattern: t }),
      });
    }
    seen.add(t);
    trimmed.push(t);
  }

  const before = readPatterns(cwd);

  try {
    writePatterns(cwd, trimmed);
  } catch (err) {
    throw new HTTPException(400, {
      message: tx(SERVER_TEXTS.projectIgnorePersistFailed, {
        message: formatErrorMessage(err),
      }),
    });
  }

  logPatternChanges(before, trimmed);

  if (arrayChanged(before, trimmed)) await maybeRestartWatcher(deps);
}

/**
 * Set-equality check, ignores ordering. The route's UX is "manage a
 * list of patterns"; reordering the array via PATCH counts as a no-op,
 * only added / removed entries warrant a watcher restart.
 */
function arrayChanged(before: readonly string[], next: readonly string[]): boolean {
  if (before.length !== next.length) return true;
  const beforeSet = new Set(before);
  for (const p of next) {
    if (!beforeSet.has(p)) return true;
  }
  return false;
}

function logPatternChanges(before: readonly string[], next: readonly string[]): void {
  const beforeSet = new Set(before);
  const nextSet = new Set(next);
  for (const p of next) {
    if (beforeSet.has(p)) continue;
    log.warn(
      tx(SERVER_TEXTS.projectIgnorePatternAdded, {
        pattern: sanitizeForTerminal(p),
      }),
    );
  }
  for (const p of before) {
    if (nextSet.has(p)) continue;
    log.warn(
      tx(SERVER_TEXTS.projectIgnorePatternRemoved, {
        pattern: sanitizeForTerminal(p),
      }),
    );
  }
}

/**
 * Best-effort watcher reload. Swallows + logs failures so a flaky
 * chokidar boot does not roll back the on-disk write; the advisory
 * message tells the operator to restart `sm serve` manually.
 */
async function maybeRestartWatcher(deps: IRouteDeps): Promise<void> {
  const watcher = deps.watcherHolder.current;
  if (!watcher) return;
  try {
    await watcher.restart();
  } catch (err) {
    log.warn(
      tx(SERVER_TEXTS.projectIgnoreWatcherRestartFailed, {
        message: formatErrorMessage(err),
      }),
    );
  }
}

/**
 * Body schema for `PATCH /api/project-ignore`. Requires a `patterns`
 * array of strings, each a single line with no control characters.
 * The `pattern` regex `^[^\n\r\x00-\x1F\x7F]+$` rejects empty strings
 * (the `+` quantifier), newlines / CR, and the ASCII C0/DEL control
 * subset. Server-side `applyPatch` re-trims and deduplicates so the
 * persisted file is canonical regardless of how the client builds its
 * payload.
 */
const PATCH_BODY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['patterns'],
  properties: {
    patterns: {
      type: 'array',
      items: {
        type: 'string',
        pattern: '^[^\\n\\r\\x00-\\x1F\\x7F]+$',
      },
    },
  },
} as const;

const parsePatchBody = makeBodyValidator<IPatchBody>(PATCH_BODY_SCHEMA, {
  notJson: SERVER_TEXTS.projectIgnoreBodyNotJson,
  notObject: SERVER_TEXTS.projectIgnoreBodyNotObject,
  invalid: SERVER_TEXTS.projectIgnoreBodyEmpty,
  mapping: {
    '/patterns:required': SERVER_TEXTS.projectIgnoreBodyEmpty,
    '/patterns:type:array': SERVER_TEXTS.projectIgnoreListNotArray,
    '/patterns/*:type:string': SERVER_TEXTS.projectIgnoreEntryNotString,
    '/patterns/*:pattern': SERVER_TEXTS.projectIgnorePatternHasControlChar,
  },
});
