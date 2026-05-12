/**
 * Pure path helpers for the on-disk skill-map scope layout. Moved out
 * of `cli/util/db-path.ts` so the BFF (`src/server/`) can consume them
 * without reaching into the CLI layer. The CLI-only siblings
 * (`assertDbExists`, `requireDbOrExit`, they take a stderr stream and
 * an `ExitCode`) stay in `cli/util/db-path.ts` and re-export the
 * primitives from here.
 *
 * Spec global flags (per `spec/cli-contract.md` §Global flags):
 *   -g / --global    operate on `~/.skill-map/` instead of `./.skill-map/`
 *   --db <path>      escape hatch for explicit DB file
 */

import { join, resolve } from 'node:path';

import type { IRuntimeContext } from '../runtime/runtime-context.js';

/**
 * Per-scope directory the CLI stores its state under (DB file, settings,
 * plugins, etc.). Same name in project (`<cwd>/.skill-map/`) and global
 * (`~/.skill-map/`) scopes; the difference is the parent. Exported so
 * write-side scaffolding (`sm init`) and other helpers can reuse the
 * convention without duplicating the literal.
 */
export const SKILL_MAP_DIR = '.skill-map';

const DB_FILENAME = 'skill-map.db';
const JOBS_DIRNAME = 'jobs';
const PLUGINS_DIRNAME = 'plugins';
const SETTINGS_FILENAME = 'settings.json';
const LOCAL_SETTINGS_FILENAME = 'settings.local.json';
const IGNORE_FILENAME = '.skillmapignore';

/**
 * Single source of truth for the relative DB path inside a scope
 * directory (`.skill-map/skill-map.db`). Same string in project and
 * global scope; the difference is the parent directory the helper
 * resolves against.
 */
const DEFAULT_DB_REL = `${SKILL_MAP_DIR}/${DB_FILENAME}`;

/**
 * Entries `sm init` appends to the project `.gitignore`. Centralised
 * here (instead of the verb file) so the literals live alongside their
 * filename constants and the verb consumes them as a frozen list.
 */
export const GITIGNORE_ENTRIES: readonly string[] = [
  `${SKILL_MAP_DIR}/${LOCAL_SETTINGS_FILENAME}`,
  `${SKILL_MAP_DIR}/${DB_FILENAME}`,
];

/**
 * Inputs for `resolveDbPath`. Extends `IRuntimeContext` so the helper
 * never reads `process.cwd()` / `homedir()` directly, every caller
 * threads the runtime context (mandatory) alongside the spec flags.
 * Pattern: `resolveDbPath({ global, db, ...defaultRuntimeContext() })`.
 */
export interface IDbLocationOptions extends IRuntimeContext {
  global: boolean;
  db: string | undefined;
}

/**
 * Resolve the DB file path from command-line options.
 *
 * Precedence: explicit `--db <path>` > `-g/--global` (~/.skill-map/) >
 * project default (cwd/.skill-map/).
 *
 * Always returns an absolute path. Does NOT verify existence, pair with
 * `assertDbExists` for read-side verbs.
 */
export function resolveDbPath(options: IDbLocationOptions): string {
  if (options.db) return resolve(options.db);
  if (options.global) return join(options.homedir, DEFAULT_DB_REL);
  return resolve(options.cwd, DEFAULT_DB_REL);
}

/**
 * Default project DB path (`<cwd>/.skill-map/skill-map.db`). Same effect
 * as `resolveDbPath({ global: false, db: undefined, ...ctx })`; this
 * helper is the cheaper and more explicit route for call sites that have
 * no `--global` / `--db` flags to honour (`sm scan`, `sm refresh`,
 * `sm watch`).
 */
export function defaultProjectDbPath(ctx: IRuntimeContext): string {
  return resolve(ctx.cwd, DEFAULT_DB_REL);
}

/**
 * Default project jobs directory (`<cwd>/.skill-map/jobs`). Used by the
 * `sm job prune` orphan-files pass and any other call site that needs
 * the project-scoped jobs spool.
 */
export function defaultProjectJobsDir(ctx: IRuntimeContext): string {
  return resolve(ctx.cwd, SKILL_MAP_DIR, JOBS_DIRNAME);
}

/**
 * Default project plugins directory (`<cwd>/.skill-map/plugins`).
 * Project + user plugin discovery composes this with the user-scoped
 * `<homedir>/.skill-map/plugins` peer.
 */
export function defaultProjectPluginsDir(ctx: IRuntimeContext): string {
  return resolve(ctx.cwd, SKILL_MAP_DIR, PLUGINS_DIRNAME);
}

/**
 * Default user (global) plugins directory (`<homedir>/.skill-map/plugins`).
 * Used alongside `defaultProjectPluginsDir` when discovery walks both
 * scopes.
 */
export function defaultUserPluginsDir(ctx: IRuntimeContext): string {
  return join(ctx.homedir, SKILL_MAP_DIR, PLUGINS_DIRNAME);
}

/**
 * Default DB path under an arbitrary scope root
 * (`<scopeRoot>/.skill-map/skill-map.db`). Companion to
 * `defaultProjectDbPath` for callers that already resolved the scope
 * root themselves (today: `sm init`, which switches between
 * `cwd`/`homedir` based on `--global`).
 */
export function defaultDbPath(scopeRoot: string): string {
  return join(scopeRoot, SKILL_MAP_DIR, DB_FILENAME);
}

/**
 * Default settings file (`<scopeRoot>/.skill-map/settings.json`).
 */
export function defaultSettingsPath(scopeRoot: string): string {
  return join(scopeRoot, SKILL_MAP_DIR, SETTINGS_FILENAME);
}

/**
 * Default local-overrides settings file
 * (`<scopeRoot>/.skill-map/settings.local.json`).
 */
export function defaultLocalSettingsPath(scopeRoot: string): string {
  return join(scopeRoot, SKILL_MAP_DIR, LOCAL_SETTINGS_FILENAME);
}

/**
 * Default `.skillmapignore` file path
 * (`<scopeRoot>/.skillmapignore`). Sits at the scope root, NOT inside
 * `.skill-map/`, `sm scan` reads it from the same level as `package.json`
 * etc. so authors can keep ignore rules visible in the project tree.
 */
export function defaultIgnoreFilePath(scopeRoot: string): string {
  return join(scopeRoot, IGNORE_FILENAME);
}
