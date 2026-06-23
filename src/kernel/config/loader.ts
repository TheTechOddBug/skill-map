/**
 * Layered config loader for `.skill-map/settings.json`. Walks the four
 * canonical layers (defaults → project → project-local → overrides),
 * deep-merges per key, validates each layer against the
 * `project-config` JSON schema, and skips offending keys (warning) or
 * fails fast (strict). The effective config plus a per-key sources map
 * are returned so `sm config show --source` can answer who set what.
 *
 * Layer semantics (low → high precedence):
 *   1. `defaults`       , `src/config/defaults.json`, shipped in bundle.
 *   2. `project`        , `<cwd>/.skill-map/settings.json`.
 *   3. `project-local`  , `<cwd>/.skill-map/settings.local.json`.
 *   4. `override`       , caller-supplied object (env vars / CLI flags).
 *
 * Scope is always project-local. The historical `user` / `user-local`
 * layers (`~/.skill-map/settings.json` / `settings.local.json`) were
 * removed alongside `-g/--global`. See `spec/cli-contract.md` §Scope
 * is always project-local.
 *
 * Failure modes:
 *   - missing file       → silent skip (the layer is optional).
 *   - malformed JSON     → warning + skip whole layer (or throw if strict).
 *   - schema violation   → strip the offending key + warning (or throw
 *                          if strict). Per-key resilience: a single bad
 *                          value never invalidates the rest of the file.
 */

import { existsSync, readFileSync } from 'node:fs';

import { loadSchemaValidators, type ISchemaValidators } from '../adapters/schema-validators.js';
import { CONFIG_LOADER_TEXTS } from '../i18n/config-loader.texts.js';
import { formatErrorMessage } from '../util/format-error.js';
import {
  kernelLocalSettingsPath,
  kernelSettingsPath,
} from '../util/skill-map-paths.js';
import { FORBIDDEN_KEYS } from '../util/strip-prototype-pollution.js';
import { tx } from '../util/tx.js';

import DEFAULTS_RAW from '../../config/defaults.json' with { type: 'json' };

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

export interface IRetentionConfig {
  completed: number | null;
  failed: number | null;
}

export interface IJobsConfig {
  ttlSeconds: number;
  graceMultiplier: number;
  minimumTtlSeconds: number;
  perActionTtl: Record<string, number>;
  perActionPriority: Record<string, number>;
  retention: IRetentionConfig;
}

export interface IPluginConfigEntry {
  enabled?: boolean;
  /**
   * Per-extension overrides keyed by extension id (the leaf folder
   * name, NOT the qualified `<plugin>/<ext>` id, the plugin is already
   * the parent key). Today only `settings`; mirrors
   * `project-config.schema.json#/properties/plugins/.../extensions`.
   */
  extensions?: Record<string, IPluginExtensionConfigEntry>;
}

export interface IPluginExtensionConfigEntry {
  /**
   * Operator-supplied values for the extension's declared settings,
   * keyed by `settingId`. Intentionally permissive (`unknown` value):
   * the static schema cannot know which input-type a given `settingId`
   * picked, so per-value validation is the settings resolver's job
   * (`core/config/plugin-settings.ts`), not AJV's.
   */
  settings?: Record<string, unknown>;
}

export interface IScanWatchConfig {
  debounceMs: number;
}

export interface IScanConfig {
  tokenize: boolean;
  strict: boolean;
  maxFileSizeBytes: number;
  /**
   * Scan corpus ceiling. Hard cap on the number of files the scan
   * accepts after `.skillmapignore` filtering, before extractors run.
   * Default 50000. The scan walks, parses, analyzes, and
   * reference-validates every file up to this ceiling; that full
   * corpus is what link resolution checks against, so references
   * resolve across the whole project regardless of how many nodes the
   * map renders. When the walker reaches the ceiling, extra files are
   * dropped in stable provider-walker order and `scan_meta` records
   * the ceiling + actual count so the UI can raise a persistent banner
   * pointing at the `.skillmapignore` editor in Settings → Project.
   * Override per invocation with `--max-scan N` on `sm scan` /
   * `sm watch` / `sm serve`, bidirectional (raises OR lowers).
   */
  maxScan: number;
  /**
   * Map render cap. Maximum number of nodes the graph view projects
   * onto the canvas at once. Default 256. Does NOT bound the scan (the
   * full corpus is walked + validated up to `maxScan`, and the folders
   * tree shows all of it); this only limits the Foblex projection so a
   * large project stays readable. When a selected folder branch
   * exceeds the cap, the map renders the branch's first N nodes and
   * raises an in-view banner. Override per invocation with
   * `--max-nodes N`; the value persists in `scan_meta` and is read by
   * the UI when the map renders.
   */
  maxNodes: number;
  watch: IScanWatchConfig;
  /**
   * **Privacy-sensitive when entries point outside the project**
   * (per `project-config.schema.json` §scan.referencePaths). Default
   * `[]`. Directories walked in parallel by the scan to collect
   * existing absolute paths into a side set. Files there are NOT
   * parsed and NOT indexed as nodes, the only effect is suppressing
   * `core/reference-broken` warnings for targets that exist on disk but
   * fall outside the indexed graph. The kernel passes the set to
   * rules via `IAnalyzerContext.referenceablePaths`.
   */
  referencePaths: string[];
}

export interface IEffectiveConfig {
  schemaVersion: 1;
  /**
   * **Project-local only** (per `PROJECT_LOCAL_ONLY_KEYS`). Grants this
   * project permission to create / modify `.sm` annotation sidecars
   * next to source files. Default `false`. The first time a verb or
   * BFF route attempts a `.sm` write while this is `false`, the kernel
   * raises `EConsentRequiredError`. The CLI surfaces it as an
   * interactive `confirm()` prompt (or `--yes` bypass); the BFF
   * returns 412 `confirm-required`. On accept the flag is persisted
   * to `<cwd>/.skill-map/settings.local.json` (gitignored,
   * per-checkout). Stripped with a warning when found in the
   * committed `project` layer, each developer consents
   * independently.
   */
  allowEditSmFiles: boolean;
  /**
   * **Project policy, team-shared** (committed in the `project` layer,
   * NOT project-local). Default `true`. When `false`, every extension
   * whose manifest declares `writes: ['sidecar']` is dropped from the
   * scan composer (so its `inspector.action.button` never projects) and
   * the sidecar store refuses the write with
   * `ESidecarWritersForbiddenError`. HARD gate: it wins over the
   * per-machine `allowEditSmFiles` consent and is not bypassable with
   * `--yes`. Reads of existing `.sm` sidecars are unaffected, the policy
   * governs writes / generation only.
   */
  allowSidecarWriters: boolean;
  tokenizer: string;
  roots: string[];
  ignore: string[];
  scan: IScanConfig;
  plugins: Record<string, IPluginConfigEntry>;
  jobs: IJobsConfig;
}

/**
 * Dot-paths that MUST NOT be loaded from the committed `project`
 * layer (`<cwd>/.skill-map/settings.json`). They remain valid in
 * `defaults`, `project-local`, and `override`. When the loader finds
 * one in the project file, it strips the key (warning) before the
 * deep-merge runs, so a shared checkout cannot leak `~/...` exposure
 * to every teammate.
 *
 * Keep in lock-step with the descriptions in
 * `spec/schemas/project-config.schema.json` (every entry here carries
 * a `Privacy-sensitive, project-local only` marker on its spec
 * description).
 */
export const PROJECT_LOCAL_ONLY_KEYS: ReadonlySet<string> = new Set<string>([
  'allowEditSmFiles',
  'scan.referencePaths',
]);

export type TConfigLayer =
  | 'defaults'
  | 'project'
  | 'project-local'
  | 'override';

export interface ILoadConfigOptions {
  /** Working directory used to resolve project-scoped config files. */
  cwd: string;
  /** Top layer applied after every file layer. Translates env vars / CLI flags into config keys. */
  overrides?: Record<string, unknown>;
  /** When true, every warning is thrown as an `Error` instead of being collected. */
  strict?: boolean;
}

export interface ILoadedConfig {
  effective: IEffectiveConfig;
  /** Maps dot-path keys (e.g. `"scan.strict"`) to the layer that last wrote them. */
  sources: Map<string, TConfigLayer>;
  /** Accumulated warnings about malformed JSON, schema violations, or invalid values. */
  warnings: string[];
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

const DEFAULTS = DEFAULTS_RAW as unknown as IEffectiveConfig;

export function loadConfig(opts: ILoadConfigOptions): ILoadedConfig {
  const cwd = opts.cwd;
  const strict = opts.strict ?? false;
  const warnings: string[] = [];
  const sources = new Map<string, TConfigLayer>();
  const validators = loadSchemaValidators();

  let effective = structuredClone(DEFAULTS);
  recordSources('', effective, sources, 'defaults');

  const filePairs: Array<{ path: string; layer: TConfigLayer }> = [
    { path: kernelSettingsPath(cwd), layer: 'project' },
    { path: kernelLocalSettingsPath(cwd), layer: 'project-local' },
  ];

  for (const { path, layer } of filePairs) {
    if (!existsSync(path)) continue;
    const partial = readJsonSafe(path, layer, warnings, strict);
    if (partial === null) continue;
    const cleaned = validateAndStrip(validators, partial, layer, warnings, strict);
    // Strip `PROJECT_LOCAL_ONLY_KEYS` from every layer EXCEPT
    // `project-local`, that is the only legitimate home for them.
    // See `stripProjectLocalOnlyKeys` for the security rationale.
    if (layer !== 'project-local') {
      stripProjectLocalOnlyKeys(cleaned, layer, warnings, strict);
    }
    effective = deepMerge(effective as unknown as Record<string, unknown>, cleaned) as unknown as IEffectiveConfig;
    recordSources('', cleaned, sources, layer);
  }

  if (opts.overrides && Object.keys(opts.overrides).length > 0) {
    const cleaned = validateAndStrip(validators, opts.overrides, 'override', warnings, strict);
    stripProjectLocalOnlyKeys(cleaned, 'override', warnings, strict);
    effective = deepMerge(effective as unknown as Record<string, unknown>, cleaned) as unknown as IEffectiveConfig;
    recordSources('', cleaned, sources, 'override');
  }

  return { effective, sources, warnings };
}

// -----------------------------------------------------------------------------
// Internals
// -----------------------------------------------------------------------------

function readJsonSafe(
  path: string,
  layer: TConfigLayer,
  warnings: string[],
  strict: boolean,
): unknown | null {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    return reportAndSkip(
      tx(CONFIG_LOADER_TEXTS.readFailure, { layer, path, message: formatErrorMessage(err) }),
      warnings,
      strict,
    );
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    return reportAndSkip(
      tx(CONFIG_LOADER_TEXTS.invalidJson, { layer, path, message: formatErrorMessage(err) }),
      warnings,
      strict,
    );
  }
}

function reportAndSkip(msg: string, warnings: string[], strict: boolean): null {
  if (strict) throw new Error(msg);
  warnings.push(msg);
  return null;
}

/**
 * Validate `raw` against the project-config schema and return a copy with
 * any offending keys removed. Errors are accumulated as warnings (or thrown
 * in strict mode). Continues per-key so a single bad value never invalidates
 * the rest of the file.
 */
function validateAndStrip(
  validators: ISchemaValidators,
  raw: unknown,
  layer: TConfigLayer,
  warnings: string[],
  strict: boolean,
): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    const msg = tx(CONFIG_LOADER_TEXTS.expectedObject, { layer, type: describeJsonType(raw) });
    if (strict) throw new Error(msg);
    warnings.push(msg);
    return {};
  }

  const cloned = structuredClone(raw) as Record<string, unknown>;
  const validator = validators.getValidator('project-config');
  if (validator(cloned)) return cloned;

  for (const err of validator.errors ?? []) {
    applyValidationError(cloned, err, layer, warnings, strict);
  }
  return cloned;
}

/**
 * Apply one AJV error to the cloned config object: drop the offending
 * key (additionalProperties or invalid-value), then either throw (in
 * strict mode) or push a human-readable warning. Mutates `cloned` and
 * `warnings` in place.
 */
function applyValidationError(
  cloned: Record<string, unknown>,
  err: { instancePath?: string; keyword: string; message?: string; params?: unknown },
  layer: TConfigLayer,
  warnings: string[],
  strict: boolean,
): void {
  const path = err.instancePath ?? '';
  if (err.keyword === 'additionalProperties') {
    const extra = (err.params as { additionalProperty: string }).additionalProperty;
    deleteAtPath(cloned, path, extra);
    const msg = tx(CONFIG_LOADER_TEXTS.unknownKey, { layer, key: joinSegments(path, extra) });
    if (strict) throw new Error(msg);
    warnings.push(msg);
    return;
  }
  const segments = path.split('/').filter(Boolean);
  if (segments.length > 0) {
    const last = segments.pop() as string;
    deleteAtPath(cloned, '/' + segments.join('/'), last);
  }
  const msg = tx(CONFIG_LOADER_TEXTS.invalidValue, {
    layer,
    path: path || '(root)',
    message: err.message ?? err.keyword,
  });
  if (strict) throw new Error(msg);
  warnings.push(msg);
}

function describeJsonType(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

// `FORBIDDEN_KEYS` is the shared closed set from `kernel/util/strip-prototype-pollution.ts`;
// this module consults it inside the merge primitive (skip-on-key) and inside
// `containsForbidden` to also reject pollution-via-AJV-instancePath.

function deleteAtPath(root: Record<string, unknown>, parentPath: string, key: string): void {
  if (containsForbidden(parentPath, key)) return;
  const segments = parentPath.split('/').filter(Boolean);
  let cur: unknown = root;
  for (const seg of segments) {
    if (!isPlainObject(cur)) return;
    cur = cur[seg];
  }
  if (isPlainObject(cur)) delete cur[key];
}

/**
 * Walk every `PROJECT_LOCAL_ONLY_KEYS` dot-path against `cloned` and
 * delete the leaf when present. Pushes a per-stripped-key warning
 * (or throws in strict mode). Invoked for every layer except
 * `project-local` (the only legitimate home for these keys).
 *
 * Why every non-project-local layer: the spec analyzer says
 * `allowEditSmFiles` and `scan.referencePaths` are per-checkout. A
 * value in the committed `project` layer would
 * leak across teammates, so the loader strips it. The same strip
 * applies to `override` (env vars / CLI flags) to keep the rule
 * symmetric and to surface the misconfiguration eagerly.
 */
function stripProjectLocalOnlyKeys(
  cloned: Record<string, unknown>,
  layer: TConfigLayer,
  warnings: string[],
  strict: boolean,
): void {
  for (const dotKey of PROJECT_LOCAL_ONLY_KEYS) {
    const segments = dotKey.split('.').filter(Boolean);
    if (segments.length === 0) continue;
    const leaf = segments.pop() as string;
    if (!keyPresentAtPath(cloned, segments, leaf)) continue;
    const parentPath = '/' + segments.join('/');
    deleteAtPath(cloned, parentPath, leaf);
    const msg = tx(CONFIG_LOADER_TEXTS.projectLocalOnlyStripped, {
      layer,
      key: dotKey,
    });
    if (strict) throw new Error(msg);
    warnings.push(msg);
  }
}

function keyPresentAtPath(
  root: Record<string, unknown>,
  parentSegments: string[],
  leaf: string,
): boolean {
  let cur: unknown = root;
  for (const seg of parentSegments) {
    if (!isPlainObject(cur)) return false;
    cur = cur[seg];
  }
  return isPlainObject(cur) && Object.prototype.hasOwnProperty.call(cur, leaf);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function containsForbidden(parentPath: string, leaf: string): boolean {
  if (FORBIDDEN_KEYS.has(leaf)) return true;
  for (const seg of parentPath.split('/')) {
    if (FORBIDDEN_KEYS.has(seg)) return true;
  }
  return false;
}

function joinSegments(instancePath: string, leaf: string): string {
  const segments = instancePath.split('/').filter(Boolean);
  return [...segments, leaf].join('.');
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target };
  for (const [k, v] of Object.entries(source)) {
    if (FORBIDDEN_KEYS.has(k)) continue;
    out[k] = mergeValue(out[k], v);
  }
  return out;
}

function mergeValue(target: unknown, source: unknown): unknown {
  if (source === null || typeof source !== 'object' || Array.isArray(source)) {
    return source;
  }
  // When the source is a plain object, recurse even if the target slot
  // is empty, so nested `__proto__` / `constructor` / `prototype` keys
  // are filtered. Skipping the recursion in the empty-target case
  // (early version of the H1 fix) leaked pollution keys verbatim into
  // the merged config.
  const targetSlot =
    target !== null && typeof target === 'object' && !Array.isArray(target)
      ? (target as Record<string, unknown>)
      : {};
  return deepMerge(targetSlot, source as Record<string, unknown>);
}

// Recursive descent over the layered config, recording the source
// layer of each leaf into a flat map. Primitive / array / object /
// null branches are the type discriminator. Per `context/lint.md`
// category 7 (recursive type-discriminator walkers).
// eslint-disable-next-line complexity
function recordSources(
  prefix: string,
  value: unknown,
  map: Map<string, TConfigLayer>,
  layer: TConfigLayer,
): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    if (prefix) map.set(prefix, layer);
    return;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0 && prefix) {
    map.set(prefix, layer);
    return;
  }
  for (const [k, v] of entries) {
    const next = prefix ? `${prefix}.${k}` : k;
    recordSources(next, v, map, layer);
  }
}
