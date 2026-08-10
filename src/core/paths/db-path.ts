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

import { SCOPE_LOCK_FILENAME } from '../../kernel/util/scope-lock.js';
import { join, resolve } from 'node:path';

import type { IRuntimeContext } from '../runtime/runtime-context.js';
import {
  SKILL_MAP_DIR,
  BACKUPS_DIRNAME,
  kernelBackupsDir,
  kernelSkillActionsDir,
} from '../../kernel/util/skill-map-paths.js';

/**
 * Per-scope directory the CLI stores its state under (DB file, settings,
 * plugins, etc.). Resolved against the project cwd (`<cwd>/.skill-map/`).
 * The canonical literal lives in `kernel/util/skill-map-paths.ts` (the
 * innermost layer); it is re-exported here so the CLI / BFF path helpers
 * keep importing it from one place without `core/` owning the literal.
 * `kernelSkillActionsDir` (the skill-action catalog folder,
 * `spec/skill-actions.md`) rides the same re-export.
 */
export { SKILL_MAP_DIR, BACKUPS_DIRNAME, kernelSkillActionsDir };

const DB_FILENAME = 'skill-map.db';
const JOBS_DIRNAME = 'jobs';
const PLUGINS_DIRNAME = 'plugins';
const VIEWS_DIRNAME = 'views';
const SETTINGS_FILENAME = 'settings.json';
const LOCAL_SETTINGS_FILENAME = 'settings.local.json';
const IGNORE_FILENAME = '.skillmapignore';
const GITIGNORE_FILENAME = '.gitignore';
export const SERVE_INFO_FILENAME = 'serve.json';
const ACTIVITY_DIRNAME = 'activity';
const ACTIVITY_BRIDGE_FILENAME = 'bridge.js';

/** The operations-log filename (`spec/cli-contract.md` §Operations log). */
export const OPERATIONS_LOG_FILENAME = 'operations.log';

/**
 * The scope ignore file (`<scopeRoot>/.skill-map/.gitignore`). Same
 * basename as the project-root `.gitignore`, distinct location: this one
 * lives INSIDE the scope directory and describes only its contents.
 */
const SCOPE_GITIGNORE_FILENAME = '.gitignore';

/**
 * Single source of truth for the relative DB path inside the project
 * scope directory (`.skill-map/skill-map.db`).
 */
const DEFAULT_DB_REL = `${SKILL_MAP_DIR}/${DB_FILENAME}`;

/**
 * Entries of the scope ignore file (`<scopeRoot>/.skill-map/.gitignore`,
 * `spec/cli-contract.md` §Scope ignore file). Paths are relative to
 * `.skill-map/` because the ignore file lives INSIDE it. Centralised
 * here (instead of the writer) so the literals live alongside their
 * filename constants and consumers take a frozen list.
 *
 * Every entry is a per-machine runtime artifact that must never travel
 * via the shared repo: the local settings, the DB plus its SQLite
 * sidecars (`-wal` / `-shm`, which the bare DB pattern does NOT match),
 * the serve discovery file, the operations log and its rotated
 * generation (`operations.log.1`, hence the glob), the DB backups
 * directory (pre-migrate snapshots + `sm db backup` output), and the
 * generated activity bridge (`sm activity install` regenerates it, so a
 * committed copy only goes stale against the CLI that wrote it).
 *
 * Everything NOT listed stays trackable, notably `settings.json` (the
 * committed team config layer) and `plugins/` (drop-in plugins a team
 * may commit).
 */
export const SCOPE_GITIGNORE_ENTRIES: readonly string[] = [
  LOCAL_SETTINGS_FILENAME,
  DB_FILENAME,
  `${DB_FILENAME}-wal`,
  `${DB_FILENAME}-shm`,
  SERVE_INFO_FILENAME,
  SCOPE_LOCK_FILENAME,
  `${OPERATIONS_LOG_FILENAME}*`,
  `${BACKUPS_DIRNAME}/`,
  `${ACTIVITY_DIRNAME}/`,
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
 * `--db` flag to honour (`sm scan`, `sm enrich`, `sm watch`).
 */
export function defaultProjectDbPath(ctx: IRuntimeContext): string {
  return resolve(ctx.cwd, DEFAULT_DB_REL);
}

/**
 * Default project jobs directory (`<cwd>/.skill-map/jobs`). Retained for
 * call sites that still need the project-scoped jobs spool. Note: job
 * CONTENT is DB-only (`state_job_contents`); `sm jobs prune` no longer
 * walks this directory.
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
 * Default project operations log (`<cwd>/.skill-map/operations.log`),
 * the append-only JSONL every mutating verb writes one line to
 * (`spec/cli-contract.md` §Operations log). Consumers go through
 * `core/operations-log.ts`, never compose this themselves.
 */
export function defaultProjectOperationsLogPath(ctx: IRuntimeContext): string {
  return resolve(ctx.cwd, SKILL_MAP_DIR, OPERATIONS_LOG_FILENAME);
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
 * Server discovery file (`<scopeRoot>/.skill-map/serve.json`). Written by
 * the `sm serve` verb while the server is up (resolved host/port +
 * per-session ingest token, shape per `spec/schemas/serve-info.schema.json`)
 * and deleted on shutdown; the activity bridge reads it to find and
 * authenticate against the project's running server. Runtime artifact,
 * gitignored via `SCOPE_GITIGNORE_ENTRIES`, never committed.
 */
export function defaultServeInfoPath(scopeRoot: string): string {
  return join(scopeRoot, SKILL_MAP_DIR, SERVE_INFO_FILENAME);
}

/**
 * Live-activity artifacts directory (`<scopeRoot>/.skill-map/activity`).
 * Holds the zero-dependency bridge script `sm activity install <provider>`
 * writes and the provider hook configs reference (relative to the scope
 * root, so a committed provider config stays portable across machines).
 *
 * Gitignored, NOT committed (`spec/provider-activity.md` §Bridge
 * contract, item 6): the installer regenerates it and stamps the CLI
 * version into it, so a committed copy silently goes stale against the
 * implementation that reads it. A teammate who wants live activity runs
 * `sm activity install <provider>` once, which is also what wires their
 * own hook config.
 */
export function defaultProjectActivityDir(scopeRoot: string): string {
  return join(scopeRoot, SKILL_MAP_DIR, ACTIVITY_DIRNAME);
}

/**
 * The activity bridge script (`<scopeRoot>/.skill-map/activity/bridge.js`).
 * Contract in `spec/provider-activity.md` §Bridge contract; source
 * template in `cli/util/activity-bridge.ts`.
 */
export function defaultActivityBridgePath(scopeRoot: string): string {
  return join(scopeRoot, SKILL_MAP_DIR, ACTIVITY_DIRNAME, ACTIVITY_BRIDGE_FILENAME);
}

/**
 * The bridge path as referenced FROM provider hook configs: relative,
 * forward-slash, anchored at the scope root (`.skill-map/activity/bridge.js`).
 * Doubles as the ownership MARKER `sm activity uninstall` matches to
 * remove exactly the entries `install` added.
 */
export const ACTIVITY_BRIDGE_REL = `${SKILL_MAP_DIR}/${ACTIVITY_DIRNAME}/${ACTIVITY_BRIDGE_FILENAME}`;

/**
 * Map-views directory (`<scopeRoot>/.skill-map/views`), one committed
 * JSON file per named map view (`spec/map-views.md`). Deliberately
 * ABSENT from `SCOPE_GITIGNORE_ENTRIES`: like `settings.json` and
 * `plugins/`, view files carry human curation and are trackable by
 * default. Created lazily on the first write; an absent directory reads
 * as zero views.
 */
export function defaultProjectViewsDir(scopeRoot: string): string {
  return join(scopeRoot, SKILL_MAP_DIR, VIEWS_DIRNAME);
}

/**
 * One map-view file (`<scopeRoot>/.skill-map/views/<slug>.json`). The
 * filename IS the view's identity (`spec/map-views.md` §File location
 * and identity); callers MUST validate `slug` against the Slug rule of
 * `map-view.schema.json` before composing a path with it (the write
 * side additionally asserts containment under the views directory).
 */
export function mapViewFilePath(scopeRoot: string, slug: string): string {
  return join(defaultProjectViewsDir(scopeRoot), `${slug}.json`);
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
 * The scope ignore file (`<scopeRoot>/.skill-map/.gitignore`), the
 * committed statement of which files inside the scope directory are
 * machine-generated. Written by `ensureScopeGitignore`
 * (`core/scope-gitignore.ts`); contract in `spec/cli-contract.md`
 * §Scope ignore file. Distinct from `defaultGitignorePath` below, which
 * is the PROJECT-ROOT `.gitignore` the scan's ignore layers read.
 */
export function defaultScopeGitignorePath(scopeRoot: string): string {
  return join(scopeRoot, SKILL_MAP_DIR, SCOPE_GITIGNORE_FILENAME);
}

/**
 * Default `.gitignore` path (`<scopeRoot>/.gitignore`). The root file the
 * meta-watcher observes so editing it rebuilds the ignore filter live;
 * its content is also folded into the scan/watcher ignore layers.
 */
export function defaultGitignorePath(scopeRoot: string): string {
  return join(scopeRoot, GITIGNORE_FILENAME);
}
