/**
 * Pure path helpers for the on-disk skill-map scope layout. Moved out
 * of `cli/util/db-path.ts` so the BFF (`src/server/`) can consume them
 * without reaching into the CLI layer. The CLI-only siblings
 * (`assertDbExists`, `requireDbOrExit`, they take a stderr stream and
 * an `ExitCode`) stay in `cli/util/db-path.ts` and re-export the
 * primitives from here.
 *
 * Scope is always project-local: every helper resolves under
 * `<cwd>/.skill-map/`. There is no `-g/--global` flag and no implicit
 * `$HOME` read. The single documented exception is the per-user
 * settings file (`~/.skill-map/settings.json`), which lives in
 * `cli/util/user-settings-store.ts` and does NOT use any helper from
 * this module. See `spec/cli-contract.md` §Scope is always
 * project-local.
 *
 * `--db <path>` remains as an explicit escape hatch (mirrored on
 * `SmCommand` and threaded through `resolveDbPath` below).
 */

import { join, resolve } from 'node:path';

import type { IRuntimeContext } from '../runtime/runtime-context.js';
import {
  SKILL_MAP_DIR,
  BACKUPS_DIRNAME,
  kernelBackupsDir,
} from '../../kernel/util/skill-map-paths.js';

/**
 * Per-scope directory the CLI stores its state under (DB file, settings,
 * plugins, etc.). Resolved against the project cwd (`<cwd>/.skill-map/`).
 * The canonical literal lives in `kernel/util/skill-map-paths.ts` (the
 * innermost layer); it is re-exported here so the CLI / BFF path helpers
 * keep importing it from one place without `core/` owning the literal.
 */
export { SKILL_MAP_DIR, BACKUPS_DIRNAME };

const DB_FILENAME = 'skill-map.db';
const JOBS_DIRNAME = 'jobs';
const PLUGINS_DIRNAME = 'plugins';
const SETTINGS_FILENAME = 'settings.json';
const LOCAL_SETTINGS_FILENAME = 'settings.local.json';
const IGNORE_FILENAME = '.skillmapignore';
const GITIGNORE_FILENAME = '.gitignore';

/**
 * Single source of truth for the relative DB path inside the project
 * scope directory (`.skill-map/skill-map.db`).
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
 * never reads `process.cwd()` directly, every caller threads the
 * runtime context (mandatory) alongside the `--db` override.
 * Pattern: `resolveDbPath({ db, ...defaultRuntimeContext() })`.
 */
export interface IDbLocationOptions extends IRuntimeContext {
  db: string | undefined;
}

/**
 * Resolve the DB file path from command-line options.
 *
 * Precedence: explicit `--db <path>` > project default
 * (`<cwd>/.skill-map/skill-map.db`).
 *
 * Always returns an absolute path. Does NOT verify existence, pair
 * with `assertDbExists` for read-side verbs.
 */
export function resolveDbPath(options: IDbLocationOptions): string {
  if (options.db) return resolve(options.db);
  return resolve(options.cwd, DEFAULT_DB_REL);
}

/**
 * Default project DB path (`<cwd>/.skill-map/skill-map.db`). Same
 * effect as `resolveDbPath({ db: undefined, ...ctx })`; this helper
 * is the cheaper and more explicit route for call sites that have no
 * `--db` flag to honour (`sm scan`, `sm refresh`, `sm watch`).
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
 * Default project plugins directory (`<cwd>/.skill-map/plugins`). Sole
 * discovery root for drop-in plugins; the `--plugin-dir <path>`
 * override (CLI verbs under `sm plugins …`) replaces it when the user
 * wants to point at a sibling tree.
 */
export function defaultProjectPluginsDir(ctx: IRuntimeContext): string {
  return resolve(ctx.cwd, SKILL_MAP_DIR, PLUGINS_DIRNAME);
}

/**
 * `<dbDir>/backups` for a DB file path: where `sm db backup` writes and
 * where the migrations runner drops its pre-migrate snapshots. Derives
 * from the DB's OWN directory so a `--db <path>` override keeps backups
 * beside it. Thin re-export of the kernel primitive so CLI / BFF never
 * compose the `backups` segment by hand.
 */
export function backupsDirForDb(dbPath: string): string {
  return kernelBackupsDir(dbPath);
}

/**
 * Default DB path under an arbitrary scope root
 * (`<scopeRoot>/.skill-map/skill-map.db`). Companion to
 * `defaultProjectDbPath` for callers that already resolved the scope
 * root themselves (today: `sm init`).
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

/**
 * Default `.gitignore` path (`<scopeRoot>/.gitignore`). The root file the
 * meta-watcher observes so editing it rebuilds the ignore filter live;
 * its content is also folded into the scan/watcher ignore layers.
 */
export function defaultGitignorePath(scopeRoot: string): string {
  return join(scopeRoot, GITIGNORE_FILENAME);
}
