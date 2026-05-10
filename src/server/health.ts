/**
 * `/api/health` — liveness + version surface for the SPA bootstrap.
 *
 * Shape (`IHealthResponse`):
 *
 *   ```json
 *   {
 *     "ok": true,
 *     "schemaVersion": "1",
 *     "specVersion": "0.11.0",
 *     "implVersion": "0.9.0",
 *     "scope": "project",
 *     "db": "present"
 *   }
 *   ```
 *
 * The endpoint deliberately boots even when the DB file is missing.
 * The SPA polls health on first paint to decide whether to render an
 * empty-state CTA ("run `sm scan` first") versus the live data flow.
 *
 * `db` resolution:
 *
 *   - `existsSync(dbPath)` true  → `'present'`.
 *   - `existsSync(dbPath)` false → `'missing'`.
 *
 * Adding a separate `'error'` value (corrupt header, permission denied)
 * is a non-breaking widening of the union when the integrity work
 * lands in Step 14.2; today the type stays at the two states the
 * implementation actually produces so consumers never branch on a
 * value that can't appear.
 *
 * The `schemaVersion` field tracks `scan-result.schema.json#/properties/schemaVersion/const`
 * (numeric in the schema, stringified here so the SPA branches on a single
 * type). Hardcoded to `'1'` until the spec ever bumps the on-the-wire
 * `schemaVersion` — at which point this constant moves into the
 * `@skill-map/spec` index payload.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { SKILL_MAP_DIR } from '../core/paths/db-path.js';
import { VERSION } from '../version.js';
import type { TServerScope } from './options.js';

export type THealthDbState = 'present' | 'missing';

export interface IHealthResponse {
  ok: true;
  schemaVersion: string;
  specVersion: string;
  implVersion: string;
  scope: TServerScope;
  db: THealthDbState;
  /**
   * Absolute path to the project root the BFF is serving from. Source
   * of truth: the `runtimeContext.cwd` threaded into `createServer`.
   * Surfaced here so the SPA's About panel can show the operator
   * "you're looking at <path>" without needing a second endpoint.
   */
  cwd: string;
  /**
   * Absolute path to the project DB file the BFF reads / writes
   * against. Mirrors `IServerOptions.dbPath`. The companion `db` field
   * still indicates whether the file exists today; this one tells the
   * user where to find it.
   */
  dbPath: string;
  /**
   * Absolute path to the user-scope `.skill-map/` directory under the
   * operator's home (`<homedir>/.skill-map`). This is where global
   * preferences (`settings.json`) and global plugins live. Surfaced so
   * the SPA's About panel can show the directory regardless of whether
   * any configuration has been written yet — the path is derived
   * deterministically from `homedir`, not from disk.
   */
  homeDir: string;
}

export interface IHealthDeps {
  dbPath: string;
  scope: TServerScope;
  /** Project root — usually `runtimeContext.cwd`. */
  cwd: string;
  /** Operator home directory — usually `runtimeContext.homedir`. The
   *  user-scope `.skill-map/` is derived from this. */
  homedir: string;
  /**
   * Pre-resolved spec version. Computed once at server boot via
   * `resolveSpecVersion()` and threaded in — keeps `buildHealth`
   * synchronous (every health probe must be fast) and avoids re-walking
   * Node's resolution graph on each request.
   */
  specVersion: string;
}

const FALLBACK_SCHEMA_VERSION = '1';

/**
 * Build the health payload. Synchronous: every read is either an
 * `existsSync` call or a value the composition root injected.
 */
export function buildHealth(deps: IHealthDeps): IHealthResponse {
  return {
    ok: true,
    schemaVersion: FALLBACK_SCHEMA_VERSION,
    specVersion: deps.specVersion,
    implVersion: VERSION,
    scope: deps.scope,
    db: existsSync(deps.dbPath) ? 'present' : 'missing',
    cwd: tildeHome(deps.cwd, deps.homedir),
    // Tilde the DB path too so the About panel's `relativeToCwd` strip
    // keeps working (both inputs share the same `~`-prefix shape) and
    // so the absolute fallback (when the DB lives outside cwd) still
    // reads as `~/...` instead of `/home/<user>/...`.
    dbPath: tildeHome(deps.dbPath, deps.homedir),
    homeDir: tildeHome(join(deps.homedir, SKILL_MAP_DIR), deps.homedir),
  };
}

/**
 * Collapse the operator's homedir prefix to a leading `~` so the About
 * panel shows `~/.skill-map` instead of `/home/<user>/.skill-map`.
 * Pure string replacement on the absolute path the rest of the system
 * already produced — keeps the underlying path deterministic and lets
 * the UI ship a single source of truth without re-parsing.
 *
 * Falls through unchanged if the path doesn't start with `homedir` (an
 * impossible state today, but cheap defence against future callers
 * that pass an unrelated absolute path).
 */
function tildeHome(absolutePath: string, homedir: string): string {
  if (!homedir) return absolutePath;
  const normalized = homedir.replace(/[/\\]+$/, '');
  if (!absolutePath.startsWith(normalized)) return absolutePath;
  const rest = absolutePath.slice(normalized.length);
  return rest === '' ? '~' : `~${rest}`;
}

/**
 * Resolve `@skill-map/spec`'s package version once at boot. Reads the
 * `specPackageVersion` field from the spec index payload (the package's
 * default export). Failure → `'unknown'`, mirroring `sm version`'s
 * degradation policy — the health endpoint must never crash.
 *
 * Module-level cached promise: every `createServer()` call shares the
 * same dynamic-import resolution. Tests that boot the server
 * in-process used to pay one full import per boot; the cache makes
 * that O(1) for the lifetime of the process.
 */
let cachedSpecVersion: Promise<string> | null = null;

export function resolveSpecVersion(): Promise<string> {
  cachedSpecVersion ??= resolveSpecVersionUncached();
  return cachedSpecVersion;
}

async function resolveSpecVersionUncached(): Promise<string> {
  try {
    const mod = await import('@skill-map/spec', { with: { type: 'json' } });
    const version = (mod as { default?: { specPackageVersion?: string } }).default
      ?.specPackageVersion;
    return version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
