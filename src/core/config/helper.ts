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
 * Scope is always project-local. Writes target either the committed
 * `project` layer (`<cwd>/.skill-map/settings.json`) or the
 * gitignored `project-local` layer (`<cwd>/.skill-map/settings.local.json`).
 * The historical `user` / `user-local` targets were removed alongside
 * `-g/--global`. See `spec/cli-contract.md` §Scope is always
 * project-local.
 *
 * Lives under `src/core/config/` so both `cli/` and `server/` (BFF)
 * can import it. Receives `cwd` as an explicit parameter, the module
 * reads no `process.env` / `process.cwd()`, so the kernel-boundary
 * lint rule (`src/eslint.config.js:233`) holds.
 */

import { homedir as osHomedir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';

import { grantLocalKey, revokeLocalKey } from '../../kernel/config/local-key-grants.js';

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
import { readJsonObjectOrEmpty, writeJsonAtomic } from '../../kernel/util/atomic-write.js';

/**
 * Keys whose value EXPANDS the project's surface, the operator must opt
 * in via `--yes` (CLI) or a confirm dialog (UI) before the write goes
 * through. Two flavours of surface:
 *
 *   - disk access OUTSIDE the project root, `scan.referencePaths`
 *     (string[] of directories walked for link validation only). The
 *     "exposure" is the list of out-of-project paths the change adds.
 *   - following symlinks whose target escapes the scan roots,
 *     `scan.followExternalSymlinks` (boolean). The "exposure" is
 *     "re-enabling out-of-tree link dereference".
 *
 * The CLI wrapper (`sm config set`) and the BFF (`PATCH
 * /api/project-preferences`) consult this set + the "expanding the
 * surface?" predicate (`projectPathExposure` for the path key,
 * `projectFollowSymlinksExposure` for the symlink key) to decide whether
 * `--yes` / `confirm: true` is required. Writes that NARROW the surface
 * (removing paths, turning the toggle off) are not gated.
 */
export const PRIVACY_SENSITIVE_KEYS: ReadonlySet<string> = new Set<string>([
  'scan.referencePaths',
  'scan.followExternalSymlinks',
]);

/**
 * Thrown when `writeConfigValue` (or `removeConfigValue`) is asked to
 * write a `PROJECT_LOCAL_ONLY_KEYS` member into the committed `project`
 * layer (`<cwd>/.skill-map/settings.json`). The loader strips these
 * keys from that layer at read time, so persisting them there is a
 * silent footgun, the value would never take effect. Surfaced as a
 * directed error so the writer can re-target `project-local`
 * (`<cwd>/.skill-map/settings.local.json`, gitignored).
 */
export class ProjectLocalOnlyKeyError extends Error {
  constructor(public readonly key: string) {
    super(
      `Config key '${key}' is project-local only. ` +
        `Pass { target: 'project-local' } to write it to .skill-map/settings.local.json (gitignored).`,
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
  cwd: string;
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
   *   - `'project'`       → `<cwd>/.skill-map/settings.json`
   *   - `'project-local'` → `<cwd>/.skill-map/settings.local.json`
   *
   * Rejected (ProjectLocalOnlyKeyError) when `target === 'project'`
   * and the key is in `PROJECT_LOCAL_ONLY_KEYS`, those keys must
   * land in `project-local` so a teammate's checkout never inherits
   * per-machine state via the committed `settings.json`.
   */
  target: 'project' | 'project-local';
  cwd: string;
}

export type TRemoveConfigValueOpts = IWriteConfigValueOpts;

/**
 * Resolve a single config key. Returns the merged value across all
 * eligible layers (or `opts.default` / `undefined` when absent).
 *
 * Type discipline: the return is `T | undefined`. The helper does NOT
 * validate the runtime shape of the value against the caller's `T`,
 * AJV at the layer-load step already enforces the schema, so the
 * value's shape matches `project-config.schema.json`. Callers that
 * declare a wrong `T` get an unsound cast; that is a programming
 * error, not a runtime concern of the helper.
 */
export function readConfigValue<T>(
  key: string,
  opts: IReadConfigValueOpts<T>,
): T | undefined {
  const loaded = loadConfigForScope(opts);
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
 * Throws `ProjectLocalOnlyKeyError` when the caller asks to write a
 * project-local-only key into the committed `project` layer.
 */
/**
 * The scope has no usable filesystem anchor, so consent for a privileged
 * key cannot be recorded. Thrown instead of writing the key silently:
 * the loader would ignore it and the operator would have no idea why.
 */
export class ScopeAnchorUnavailableError extends Error {
  constructor(public readonly key: string) {
    super(`cannot record consent for '${key}': this filesystem reports no creation time for .skill-map/`);
    this.name = 'ScopeAnchorUnavailableError';
  }
}

export function writeConfigValue(
  key: string,
  value: unknown,
  opts: IWriteConfigValueOpts,
): void {
  if (PROJECT_LOCAL_ONLY_KEYS.has(key) && opts.target === 'project') {
    throw new ProjectLocalOnlyKeyError(key);
  }
  const path = targetSettingsPath(opts.target, opts.cwd);
  const merged = readJsonObjectOrEmpty(path);
  setAtPath(merged, key, value);
  validateOrThrow(merged);
  writeJsonAtomic(path, merged);

  // Record consent for the privileged keys (audit H1). Without a grant
  // the loader ignores the key, so a silent failure here would leave the
  // operator believing a setting is active while nothing reads it.
  //
  // Note what is deliberately NOT done: the whole-file read-modify-write
  // above still copies any attacker-supplied privileged key back to disk.
  // That is safe precisely because a grant covers exactly one key and one
  // value, so this write mints nothing for a key it did not touch. Adding
  // a purge step would be belt-and-braces, but the security property must
  // not depend on it.
  if (opts.target === 'project-local' && PROJECT_LOCAL_ONLY_KEYS.has(key)) {
    if (!grantLocalKey(opts.cwd, key, value)) throw new ScopeAnchorUnavailableError(key);
  }
}

/**
 * Remove `key` from the chosen layer's settings.json. Returns `true`
 * when the key existed and was removed, `false` when it was already
 * absent (no-op, no write performed). Same `ProjectLocalOnlyKeyError`
 * guard as `writeConfigValue`.
 */
export function removeConfigValue(key: string, opts: TRemoveConfigValueOpts): boolean {
  if (PROJECT_LOCAL_ONLY_KEYS.has(key) && opts.target === 'project') {
    throw new ProjectLocalOnlyKeyError(key);
  }
  const path = targetSettingsPath(opts.target, opts.cwd);
  const merged = readJsonObjectOrEmpty(path);
  const removed = deleteAtPath(merged, key);
  if (!removed) return false;
  validateOrThrow(merged);
  writeJsonAtomic(path, merged);
  // The grant goes with the key it authorised; a stale one left behind
  // would silently re-bless the key if it were ever restored by hand.
  if (opts.target === 'project-local' && PROJECT_LOCAL_ONLY_KEYS.has(key)) {
    revokeLocalKey(opts.cwd, key);
  }
  return true;
}

/**
 * One entry of an `applyConfigLayerPatch` batch. `value === undefined`
 * means DELETE the key; any other value is written verbatim.
 */
export interface IConfigLayerPatchEntry {
  key: string;
  value: unknown;
}

/**
 * Read one layer's settings file VERBATIM (no merge, no defaults, no
 * AJV). Returns `{}` when the file is absent or unreadable.
 *
 * Every ordinary read goes through `readConfigValue` (merged view). This
 * exists for the writers that must reason about what a SPECIFIC layer
 * stores, e.g. deciding whether a key that layer holds is redundant
 * against the other layer plus a code-side default (see
 * `core/plugins/enable-persist.ts`). Merged reads cannot answer that:
 * they have already collapsed the layers.
 */
export function readConfigLayer(
  target: IWriteConfigValueOpts['target'],
  cwd: string,
): Record<string, unknown> {
  return readJsonObjectOrEmpty(targetSettingsPath(target, cwd));
}

/**
 * Apply several writes / deletes to ONE layer in a single
 * read-modify-validate-write pass, and report which entries actually
 * changed the file.
 *
 * Same guards as the per-key helpers (`ProjectLocalOnlyKeyError` on a
 * committed-layer write of a project-local-only key, AJV revalidation of
 * the merged result before the atomic write), but the file is touched
 * once instead of once per key. Callers flipping a batch of related keys
 * (the plugin enable toggles: up to ~40 under `--all`) use this so a
 * crash mid-batch cannot leave a half-applied config.
 *
 * A batch whose entries are all no-ops performs no write at all.
 */
export function applyConfigLayerPatch(
  entries: readonly IConfigLayerPatchEntry[],
  opts: IWriteConfigValueOpts,
): { changed: string[] } {
  if (opts.target === 'project') assertNoProjectLocalOnlyKeys(entries);

  const path = targetSettingsPath(opts.target, opts.cwd);
  const merged = readJsonObjectOrEmpty(path);
  const changed = applyPatchEntries(merged, entries);
  if (changed.length === 0) return { changed };

  validateOrThrow(merged);
  writeJsonAtomic(path, merged);
  if (opts.target === 'project-local') syncLocalKeyGrants(entries, opts.cwd);
  return { changed };
}

/** Batch form of `writeConfigValue`'s committed-layer guard. */
function assertNoProjectLocalOnlyKeys(entries: readonly IConfigLayerPatchEntry[]): void {
  for (const entry of entries) {
    if (PROJECT_LOCAL_ONLY_KEYS.has(entry.key)) throw new ProjectLocalOnlyKeyError(entry.key);
  }
}

/** Mutate `merged` in place; return the keys the batch actually changed. */
function applyPatchEntries(
  merged: Record<string, unknown>,
  entries: readonly IConfigLayerPatchEntry[],
): string[] {
  const changed: string[] = [];
  for (const entry of entries) {
    if (entry.value === undefined) {
      if (deleteAtPath(merged, entry.key)) changed.push(entry.key);
      continue;
    }
    if (getAtPath(merged, entry.key) === entry.value) continue;
    setAtPath(merged, entry.key, entry.value);
    changed.push(entry.key);
  }
  return changed;
}

/**
 * Consent bookkeeping for the privileged keys, same contract as the
 * per-key helpers: a grant covers exactly one key + value, so it is
 * minted / revoked per entry rather than per batch.
 */
function syncLocalKeyGrants(entries: readonly IConfigLayerPatchEntry[], cwd: string): void {
  for (const entry of entries) {
    if (!PROJECT_LOCAL_ONLY_KEYS.has(entry.key)) continue;
    if (entry.value === undefined) {
      revokeLocalKey(cwd, entry.key);
      continue;
    }
    if (!grantLocalKey(cwd, entry.key, entry.value)) {
      throw new ScopeAnchorUnavailableError(entry.key);
    }
  }
}

/**
 * Return the layer that contributed the effective value for `key`, or
 * `undefined` when no layer set it (the value is the default from
 * `src/config/defaults.json` or absent entirely). Wraps `loadConfig`
 * + the `sources` map.
 */
export function getValueSource(
  key: string,
  opts: { cwd: string },
): TConfigLayer | undefined {
  const loaded = loadConfigForScope(opts);
  return loaded.sources.get(key);
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

function loadConfigForScope(
  opts: { cwd: string; strict?: boolean },
): ILoadedConfig {
  return loadConfig({
    cwd: opts.cwd,
    ...(opts.strict ? { strict: true } : {}),
  });
}

function targetSettingsPath(
  target: IWriteConfigValueOpts['target'],
  cwd: string,
): string {
  switch (target) {
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
  /** Project working directory, used to decide whether a path is in-scope. */
  cwd: string;
}

export interface IPathExposureResult {
  /**
   * `true` when the new value introduces disk access OUTSIDE the
   * project root (adding paths to `scan.referencePaths` that resolve
   * outside `cwd`). Drives the `--yes` requirement on `sm config set`.
   *
   * Writes that NARROW the surface (removing paths) return `false` so
   * the user can revert the exposure without a confirmation step.
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
 * outside `PRIVACY_SENSITIVE_KEYS`, the caller can invoke this
 * unconditionally and only branch when `expandsSurface === true`.
 *
 * `~/...` entries are expanded against `os.homedir()` here, matching
 * the runtime resolver in `core/runtime/reference-paths-walker.ts`.
 * This is an EXPLICIT user-authored read (the operator typed `~/`
 * deliberately) and therefore consistent with
 * `spec/cli-contract.md` §Scope is always project-local, which only
 * forbids IMPLICIT `$HOME` reads.
 */

export function projectPathExposure(inputs: IPathExposureInputs): IPathExposureResult {
  const empty: IPathExposureResult = { expandsSurface: false, exposedPaths: [] };
  if (!PRIVACY_SENSITIVE_KEYS.has(inputs.key)) return empty;

  // `scan.referencePaths` is list-shaped: a value is "expanding" iff
  // it adds at least one out-of-project entry that wasn't present
  // before. Other keys in `PRIVACY_SENSITIVE_KEYS` (none today, but
  // the contract stays open for future scalars) fall through to the
  // empty result.
  if (inputs.key !== 'scan.referencePaths') return empty;
  if (!Array.isArray(inputs.value)) return empty;
  const before = readConfigValue<string[]>(inputs.key, {
    cwd: inputs.cwd,
    default: [],
  }) ?? [];
  const beforeSet = new Set(before);
  const added = (inputs.value as unknown[])
    .filter((entry): entry is string => typeof entry === 'string')
    .filter((entry) => !beforeSet.has(entry));
  const exposed = added
    .map((entry) => resolveScanPathForExposure(entry, inputs.cwd))
    .filter((abs): abs is string => abs !== null && !isUnderProject(abs, inputs.cwd));
  if (exposed.length === 0) return empty;
  return { expandsSurface: true, exposedPaths: exposed };
}

/**
 * Project the disk-read-surface expansion of a `scan.followExternalSymlinks`
 * write. Returns `{ expandsSurface: true }` only when the operator is
 * turning the local opt-in ON (`value === true`) and it is not already on;
 * turning it OFF (or leaving it on) never expands the surface, so it is not
 * gated. A boolean-flip write (like the path key's list add): the "exposure"
 * is "follow symlinks whose target escapes the scan roots", so a committed,
 * hostile symlink can read arbitrary local files once it is on. Config-only
 * (no path list to enumerate, the reachable targets depend on the on-disk
 * links at scan time); the CLI / UI surface a generic confirm.
 */
export function projectFollowSymlinksExposure(inputs: {
  value: unknown;
  cwd: string;
}): { expandsSurface: boolean } {
  if (inputs.value !== true) return { expandsSurface: false };
  const before =
    readConfigValue<boolean>('scan.followExternalSymlinks', {
      cwd: inputs.cwd,
      default: false,
    }) ?? false;
  return { expandsSurface: before !== true };
}

function resolveScanPathForExposure(raw: string, cwd: string): string | null {
  if (raw.startsWith('~/')) return resolve(join(osHomedir(), raw.slice(2)));
  if (raw === '~') return resolve(osHomedir());
  if (isAbsolute(raw)) return resolve(raw);
  return resolve(cwd, raw);
}

function isUnderProject(absPath: string, cwd: string): boolean {
  const projectRoot = resolve(cwd);
  // Containment check via prefix + the platform path separator so
  // `/projectRoot2` (POSIX) and `C:\projectRoot2` (Windows) never read
  // as "under /projectRoot". The historical literal `/` lookahead
  // (audit M6) silently misclassified every Windows path because
  // `path.resolve` returns `\` there, and could be sidestepped on
  // mixed-separator strings by a hostile manual write into
  // `scan.referencePaths`.
  return absPath === projectRoot || absPath.startsWith(`${projectRoot}${sep}`);
}
