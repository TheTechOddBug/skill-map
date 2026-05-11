/**
 * Typed read / write helper over the layered settings.json config.
 *
 * Composition pattern: this module is intentionally THIN. Every read
 * goes through `loadConfig` (the single source of truth for layer
 * merge + AJV validation + sources tracking); every write goes
 * through the `atomic-write` + `dot-path` helpers and re-validates
 * the merged file via the same AJV validators `loadConfig` uses, so
 * the disk can never end up with a config that the loader would
 * later reject.
 *
 * Key affordance — `USER_ONLY_KEYS`:
 *   Some config keys describe **user preferences** (the user is
 *   choosing how the tool behaves on their machine), not **project
 *   contracts** (the project is declaring how the tool should walk
 *   its content). `updateCheck.enabled` is the canonical example —
 *   whether to see "update available" notifications is a per-user
 *   call; switching projects shouldn't toggle it.
 *
 *   The set of user-only keys is enforced HERE, in code, not in the
 *   schema (the schema stays additive across layers so older installs
 *   that wrote the key into a project file keep validating). The
 *   helper:
 *     - forces `scope: 'global'` on reads — a project-layer override
 *       for a user-only key is silently ignored, which mirrors the
 *       intent ("this should not live in project").
 *     - rejects `target: 'project'` on writes with a directed error
 *       so `sm config set` (and any future writer) can surface a
 *       clear "rerun with -g" message.
 *
 * Lives under `src/core/config/` so both `cli/` and `server/` (BFF)
 * can import it. Receives `cwd` and `homedir` as explicit parameters
 * — the module reads no `process.env` / `process.cwd()`, so the
 * kernel-boundary lint rule (`src/eslint.config.js:233`) holds.
 */

import { isAbsolute, resolve } from 'node:path';

import {
  loadConfig,
  PROJECT_LOCAL_ONLY_KEYS,
  type ILoadedConfig,
  type TConfigLayer,
} from '../../kernel/config/loader.js';
import { loadSchemaValidators } from '../../kernel/adapters/schema-validators.js';
import { defaultLocalSettingsPath, defaultSettingsPath } from '../paths/db-path.js';
import {
  getAtPath,
  setAtPath,
  deleteAtPath,
  ForbiddenSegmentError,
} from './dot-path.js';
import { readJsonObjectOrEmpty, writeJsonAtomic } from './atomic-write.js';

/**
 * Keys that MUST live in `~/.skill-map/settings.json` (user / global
 * scope) only. Reads force `scope: 'global'` regardless of the caller's
 * option; writes reject `target: 'project'` with `UserOnlyKeyError`.
 *
 * Adding a key here is a behavior change for anyone who set it in a
 * project file before — the value gets silently ignored at read time.
 * Document the migration in the changeset that adds the entry.
 */
export const USER_ONLY_KEYS: ReadonlySet<string> = new Set<string>([
  'updateCheck.enabled',
]);

/**
 * Keys whose value can OPEN disk access outside the project root —
 * the operator must opt in via `--yes` (CLI) or a confirm dialog
 * (UI) before the write goes through. Surfaces:
 *
 *   - `scan.includeHome`: boolean toggle that adds every active
 *     Provider's `explorationDir` resolved against `~`.
 *   - `scan.extraRoots`: string[] of additional directories to scan
 *     as nodes.
 *   - `scan.referencePaths`: string[] of directories walked for link
 *     validation only.
 *
 * The CLI wrapper (`sm config set`) consults this set + the
 * "expanding the surface?" predicate to decide whether `--yes` is
 * required (writes that NARROW the surface — disabling
 * `includeHome`, removing paths — are not gated).
 */
export const PRIVACY_SENSITIVE_KEYS: ReadonlySet<string> = new Set<string>([
  'scan.includeHome',
  'scan.extraRoots',
  'scan.referencePaths',
]);

/** Thrown when `writeConfigValue` is asked to write a user-only key to project. */
export class UserOnlyKeyError extends Error {
  constructor(public readonly key: string) {
    super(
      `Config key '${key}' is user-scope only. ` +
        `Pass { target: 'user' } (or rerun the CLI with -g) to write it to ~/.skill-map/settings.json.`,
    );
    this.name = 'UserOnlyKeyError';
  }
}

/**
 * Thrown when `writeConfigValue` (or `removeConfigValue`) is asked to
 * write a `PROJECT_LOCAL_ONLY_KEYS` member into the committed `project`
 * layer (`<cwd>/.skill-map/settings.json`). The loader strips these
 * keys from that layer at read time, so persisting them there is a
 * silent footgun — the value would never take effect. Surfaced as a
 * directed error so the writer can re-target `project-local`
 * (`<cwd>/.skill-map/settings.local.json`, gitignored) or `user` /
 * `user-local` (`~/.skill-map/...`).
 */
export class ProjectLocalOnlyKeyError extends Error {
  constructor(public readonly key: string) {
    super(
      `Config key '${key}' is project-local only. ` +
        `Pass { target: 'project-local' } to write it to .skill-map/settings.local.json (gitignored), ` +
        `or use -g for the user / user-local scope.`,
    );
    this.name = 'ProjectLocalOnlyKeyError';
  }
}

// Re-export the loader-side set so single-import consumers (the CLI's
// `sm config set`, the sidecar-consent helper, the BFF's preferences
// route) can both consume the catalogue and `instanceof`-match the
// directed error against a single module path.
export { PROJECT_LOCAL_ONLY_KEYS };

export interface IReadConfigValueOpts<T> {
  /** Resolution scope. `'global'` skips project layers. `'project'` walks all six. */
  scope: 'project' | 'global';
  cwd: string;
  homedir: string;
  /** Returned when the key is absent across every layer. */
  default?: T;
  /**
   * Forwarded to `loadConfig`: when true, malformed JSON / schema
   * violations throw instead of degrading to a warning + skip. CLI
   * verbs flip this on with `--strict`; the BFF leaves it false so a
   * single bad layer never breaks the boot path.
   */
  strict?: boolean;
}

export interface IWriteConfigValueOpts {
  /**
   * Which file to mutate.
   *   - `'user'`          → `~/.skill-map/settings.json`
   *   - `'user-local'`    → `~/.skill-map/settings.local.json`
   *   - `'project'`       → `<cwd>/.skill-map/settings.json`
   *   - `'project-local'` → `<cwd>/.skill-map/settings.local.json`
   *
   * Rejected (UserOnlyKeyError) when `target === 'project'` and the
   * key is in `USER_ONLY_KEYS`.
   *
   * Rejected (ProjectLocalOnlyKeyError) when `target === 'project'`
   * and the key is in `PROJECT_LOCAL_ONLY_KEYS` — those keys must
   * land in `project-local`, `user`, or `user-local` so a teammate's
   * checkout never inherits per-machine state via the committed
   * `settings.json`.
   */
  target: 'project' | 'project-local' | 'user' | 'user-local';
  cwd: string;
  homedir: string;
}

export type IRemoveConfigValueOpts = IWriteConfigValueOpts;

/**
 * Resolve a single config key. Returns the merged value across all
 * eligible layers (or `opts.default` / `undefined` when absent).
 *
 * For `USER_ONLY_KEYS`, the scope is forced to `'global'` regardless
 * of `opts.scope` — the project file is intentionally invisible to
 * the read so a stray project-layer entry from an older install is a
 * no-op rather than a silent override.
 *
 * Type discipline: the return is `T | undefined`. The helper does NOT
 * validate the runtime shape of the value against the caller's `T` —
 * AJV at the layer-load step already enforces the schema, so the
 * value's shape matches `project-config.schema.json`. Callers that
 * declare a wrong `T` get an unsound cast; that is a programming
 * error, not a runtime concern of the helper.
 */
export function readConfigValue<T>(
  key: string,
  opts: IReadConfigValueOpts<T>,
): T | undefined {
  const scope = USER_ONLY_KEYS.has(key) ? 'global' : opts.scope;
  const loaded = loadConfigForScope(scope, opts);
  const value = getAtPath(loaded.effective as unknown, key) as T | undefined;
  if (value === undefined) return opts.default;
  return value;
}

/**
 * Persist a value under `key` to the chosen layer's settings.json.
 *
 * Pipeline: read the current layer file → mutate via `setAtPath` →
 * AJV-revalidate the merged result against `project-config.schema.json`
 * → atomic write. The validate step uses the SAME validators
 * `loadConfig` uses, so a value the helper accepts is one the loader
 * will accept the next time it boots.
 *
 * Throws `UserOnlyKeyError` when the caller asks to write a user-only
 * key into the project layer.
 */
export function writeConfigValue(
  key: string,
  value: unknown,
  opts: IWriteConfigValueOpts,
): void {
  if (USER_ONLY_KEYS.has(key) && opts.target === 'project') {
    throw new UserOnlyKeyError(key);
  }
  if (PROJECT_LOCAL_ONLY_KEYS.has(key) && opts.target === 'project') {
    throw new ProjectLocalOnlyKeyError(key);
  }
  const path = targetSettingsPath(opts.target, opts.cwd, opts.homedir);
  const merged = readJsonObjectOrEmpty(path);
  setAtPath(merged, key, value);
  validateOrThrow(merged);
  writeJsonAtomic(path, merged);
}

/**
 * Remove `key` from the chosen layer's settings.json. Returns `true`
 * when the key existed and was removed, `false` when it was already
 * absent (no-op, no write performed). Same UserOnlyKeyError guard as
 * `writeConfigValue` so a `sm config reset updateCheck.enabled`
 * (without `-g`) surfaces a directed error instead of silently
 * re-deleting a never-present project entry.
 */
export function removeConfigValue(key: string, opts: IRemoveConfigValueOpts): boolean {
  if (USER_ONLY_KEYS.has(key) && opts.target === 'project') {
    throw new UserOnlyKeyError(key);
  }
  if (PROJECT_LOCAL_ONLY_KEYS.has(key) && opts.target === 'project') {
    throw new ProjectLocalOnlyKeyError(key);
  }
  const path = targetSettingsPath(opts.target, opts.cwd, opts.homedir);
  const merged = readJsonObjectOrEmpty(path);
  const removed = deleteAtPath(merged, key);
  if (!removed) return false;
  validateOrThrow(merged);
  writeJsonAtomic(path, merged);
  return true;
}

/**
 * Return the layer that contributed the effective value for `key`, or
 * `undefined` when no layer set it (the value is the default from
 * `src/config/defaults.json` or absent entirely). Wraps `loadConfig`
 * + the `sources` map; honors the `USER_ONLY_KEYS` scope override
 * the read path uses.
 */
export function getValueSource(
  key: string,
  opts: { scope: 'project' | 'global'; cwd: string; homedir: string },
): TConfigLayer | undefined {
  const scope = USER_ONLY_KEYS.has(key) ? 'global' : opts.scope;
  const loaded = loadConfigForScope(scope, opts);
  return loaded.sources.get(key);
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

function loadConfigForScope(
  scope: 'project' | 'global',
  opts: { cwd: string; homedir: string; strict?: boolean },
): ILoadedConfig {
  return loadConfig({
    scope,
    cwd: opts.cwd,
    homedir: opts.homedir,
    ...(opts.strict ? { strict: true } : {}),
  });
}

function targetSettingsPath(
  target: IWriteConfigValueOpts['target'],
  cwd: string,
  home: string,
): string {
  switch (target) {
    case 'user':
      return defaultSettingsPath(home);
    case 'user-local':
      return defaultLocalSettingsPath(home);
    case 'project':
      return defaultSettingsPath(cwd);
    case 'project-local':
      return defaultLocalSettingsPath(cwd);
  }
}

function validateOrThrow(content: Record<string, unknown>): void {
  const validators = loadSchemaValidators();
  const result = validators.validate('project-config', content);
  if (result.ok) return;
  throw new ConfigValidationError(result.errors);
}

/**
 * Surfaces an AJV failure as a single message string. `sm config set`
 * (and any other writer) can render the message directly to the user
 * without hand-formatting the AJV `errors` array.
 */
export class ConfigValidationError extends Error {
  constructor(public readonly errors: string) {
    super(`Config validation failed: ${errors}`);
    this.name = 'ConfigValidationError';
  }
}

// Re-export the dot-path error so consumers can `instanceof` against a
// single import path (`core/config/helper`) instead of reaching into
// `core/config/dot-path`. Behavior is unchanged.
export { ForbiddenSegmentError };

// ---------------------------------------------------------------------------
// Privacy-sensitive write helpers
// ---------------------------------------------------------------------------

export interface IPathExposureInputs {
  /** The dot-path being mutated (must be a member of `PRIVACY_SENSITIVE_KEYS`). */
  key: string;
  /** New value the operator wants to write. */
  value: unknown;
  /** Project working directory — used to decide whether a path is in-scope. */
  cwd: string;
  /** User home — used to expand `~/...` entries before the in-scope check. */
  homedir: string;
}

export interface IPathExposureResult {
  /**
   * `true` when the new value introduces disk access OUTSIDE the
   * project root (toggling `scan.includeHome` `false`→`true`, or
   * adding paths to `scan.extraRoots` / `scan.referencePaths` that
   * resolve outside `cwd`). Drives the `--yes` requirement on
   * `sm config set`.
   *
   * Writes that NARROW the surface (disabling `includeHome`,
   * removing paths) return `false` so the user can revert the
   * exposure without a confirmation step.
   */
  expandsSurface: boolean;
  /**
   * Concrete absolute paths the new value will expose to the scan.
   * Empty when `expandsSurface === false`. Used by CLI / UI to
   * enumerate what the user is about to opt into.
   */
  exposedPaths: string[];
}

/**
 * Project the disk-access expansion of a privacy-sensitive write.
 * Returns `{ expandsSurface: false, exposedPaths: [] }` for keys
 * outside `PRIVACY_SENSITIVE_KEYS` — the caller can invoke this
 * unconditionally and only branch when `expandsSurface === true`.
 */
// eslint-disable-next-line complexity
export function projectPathExposure(inputs: IPathExposureInputs): IPathExposureResult {
  const empty: IPathExposureResult = { expandsSurface: false, exposedPaths: [] };
  if (!PRIVACY_SENSITIVE_KEYS.has(inputs.key)) return empty;

  // Compare against the currently persisted value to gate only on
  // expansions. Read uses `scope: 'project'` because these keys live
  // in the project layer; reads through `readConfigValue` honour the
  // `USER_ONLY_KEYS` override too (this set has no overlap with
  // user-only keys today).
  if (inputs.key === 'scan.includeHome') {
    if (inputs.value !== true) return empty;
    const before = readConfigValue<boolean>('scan.includeHome', {
      scope: 'project',
      cwd: inputs.cwd,
      homedir: inputs.homedir,
      default: false,
    });
    if (before === true) return empty;
    return {
      expandsSurface: true,
      // The CLI / UI fills this with the concrete provider HOME dirs
      // because the helper has no access to the active extension set.
      exposedPaths: ['~ (per-provider explorationDir)'],
    };
  }

  // Both list-shaped keys: a value is "expanding" iff it adds at
  // least one out-of-project entry that wasn't present before.
  if (inputs.key === 'scan.extraRoots' || inputs.key === 'scan.referencePaths') {
    if (!Array.isArray(inputs.value)) return empty;
    const before = readConfigValue<string[]>(inputs.key, {
      scope: 'project',
      cwd: inputs.cwd,
      homedir: inputs.homedir,
      default: [],
    }) ?? [];
    const beforeSet = new Set(before);
    const added = (inputs.value as unknown[])
      .filter((entry): entry is string => typeof entry === 'string')
      .filter((entry) => !beforeSet.has(entry));
    const exposed = added
      .map((entry) => resolveScanPathForExposure(entry, inputs.cwd, inputs.homedir))
      .filter((abs) => abs !== null && !isUnderProject(abs, inputs.cwd)) as string[];
    if (exposed.length === 0) return empty;
    return { expandsSurface: true, exposedPaths: exposed };
  }

  return empty;
}

function resolveScanPathForExposure(raw: string, cwd: string, homedir: string): string | null {
  // Identical resolution rules as `core/runtime/reference-paths-walker:resolveScanPath`,
  // duplicated locally to avoid a circular dep between core/config and
  // core/runtime.
  if (raw.startsWith('~/')) return resolve(`${homedir}/${raw.slice(2)}`);
  if (raw === '~') return resolve(homedir);
  if (isAbsolute(raw)) return resolve(raw);
  return resolve(cwd, raw);
}

function isUnderProject(absPath: string, cwd: string): boolean {
  const projectRoot = resolve(cwd);
  // Containment check via prefix + path separator so `/projectRoot2`
  // never reads as "under /projectRoot".
  return absPath === projectRoot || absPath.startsWith(`${projectRoot}/`);
}
