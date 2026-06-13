/**
 * Extension settings resolver.
 *
 * Plugin extensions declare user-configurable `settings` in their
 * manifest (`IExtensionBase.settings`, per-extension, see
 * `spec/plugin-author-guide.md` §Settings). The operator's values live
 * in the merged project config under
 * `plugins.<pluginId>.extensions.<extId>.settings.<settingId>` and flow
 * through the same layered merge as any other config key.
 *
 * This module is the kernel-side resolver `spec/architecture.md`
 * §Extension settings resolution describes: for each declared setting it
 *
 *   1. takes the manifest `default`,
 *   2. overlays the merged config value (when present),
 *   3. validates the result against the input-type's per-value rules.
 *
 * A value that fails validation falls back to the manifest default and
 * emits a warning, the scan must NEVER crash on a bad setting. An
 * extension that declares no `settings` resolves to `{}`.
 *
 * Why a hand-rolled per-type validator rather than AJV: the spec's
 * `input-types.schema.json` describes the DECLARATION shape (the author
 * side), not the runtime VALUE shape. The per-type value rules
 * (string-list → `string[]`, integer → safe integer, regex →
 * compilable, enum-pick → one of `options.value`, ...) are encoded once
 * here, keyed off the discriminant `declaration.type`.
 *
 * Lives under `src/core/config/` so both `cli/` (the `sm plugins config`
 * verb) and the scan composer / runtime can import it. `secret`-typed
 * settings are resolved the same as any string; the routing of a secret
 * VALUE to `settings.local.json` is a write-time concern owned by the
 * CLI verb, not the resolver.
 */

import { log } from '../../kernel/util/logger.js';
import type { TSettingDeclaration } from '../../kernel/types/view-catalog.js';
import type { IEffectiveConfig } from '../../kernel/config/loader.js';

/**
 * Minimal manifest descriptor the resolver needs: the owning plugin id,
 * the extension's leaf id, and the declared `settings` map. Every
 * runtime extension instance (`IExtensionBase`) satisfies this, but
 * narrowing the input keeps the resolver decoupled from the full
 * extension surface and trivial to unit-test with a literal.
 */
export interface ISettingsManifestRef {
  pluginId: string;
  id: string;
  settings?: Record<string, TSettingDeclaration>;
}

/**
 * Config slice the resolver reads. Accepts the full `IEffectiveConfig`
 * or any object carrying the `plugins` tree, so the scan-runner and the
 * watcher can pass their already-loaded merged config verbatim.
 */
export interface ISettingsConfigRef {
  plugins?: IEffectiveConfig['plugins'];
}

/**
 * Optional warning sink. Defaults to the kernel logger. Tests pass a
 * collector so they can assert that a bad value degraded to the default
 * with exactly one warning instead of throwing.
 */
export type TSettingsWarn = (message: string) => void;

const defaultWarn: TSettingsWarn = (message) => log.warn(message);

/**
 * Resolve the runtime `ctx.settings` object for a single extension.
 * Returns `{}` when the extension declares no settings. Never throws:
 * a value that fails its per-type validation falls back to the manifest
 * default and emits one warning.
 */
export function resolveExtensionSettings(
  manifest: ISettingsManifestRef,
  config: ISettingsConfigRef,
  onWarn: TSettingsWarn = defaultWarn,
): Record<string, unknown> {
  const declarations = manifest.settings;
  if (!declarations || Object.keys(declarations).length === 0) return {};

  const overrides = readSettingsOverrides(config, manifest.pluginId, manifest.id);
  const resolved: Record<string, unknown> = {};

  for (const [settingId, declaration] of Object.entries(declarations)) {
    const outcome = resolveOneSetting(manifest, settingId, declaration, overrides, onWarn);
    // Omit the key entirely when there is no value (no override and no
    // declared default) so `ctx.settings.<id>` reads `undefined` rather
    // than a stray entry.
    if (outcome.hasValue) resolved[settingId] = outcome.value;
  }

  return resolved;
}

/**
 * Resolve a single setting: prefer a valid override, else the manifest
 * default. An invalid override degrades to the default and emits one
 * warning, never throwing. Returns `hasValue: false` when neither an
 * override nor a default exists (`secret` with no stored value).
 */
function resolveOneSetting(
  manifest: ISettingsManifestRef,
  settingId: string,
  declaration: TSettingDeclaration,
  overrides: Record<string, unknown>,
  onWarn: TSettingsWarn,
): { hasValue: boolean; value?: unknown } {
  const fallback = declarationDefault(declaration);
  const toFallback = (): { hasValue: boolean; value?: unknown } =>
    fallback !== undefined ? { hasValue: true, value: fallback } : { hasValue: false };

  if (!Object.prototype.hasOwnProperty.call(overrides, settingId)) return toFallback();

  const candidate = overrides[settingId];
  const check = validateSettingValue(declaration, candidate);
  if (check.ok) return { hasValue: true, value: candidate };

  // Bad operator value: degrade to the default + warn, never throw.
  onWarn(
    `Setting '${settingId}' for extension '${manifest.pluginId}/${manifest.id}' ` +
      `is invalid (${check.reason}); falling back to the declared default.`,
  );
  return toFallback();
}

/**
 * Build a closure over the merged config that resolves settings for any
 * extension. Threaded into `composeScanExtensions` so every composed
 * extension gets its `resolvedSettings` populated from one config load.
 */
export function buildSettingsResolver(
  config: ISettingsConfigRef,
  onWarn: TSettingsWarn = defaultWarn,
): (ext: ISettingsManifestRef) => Record<string, unknown> {
  return (ext) => resolveExtensionSettings(ext, config, onWarn);
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

/**
 * Read the manifest-declared default for a setting. `secret` declares no
 * `default` (a token must never ship a baked-in value), so it has no
 * fallback: the resolver omits the key when no override is set. Every
 * other type exposes an optional `default`.
 */
function declarationDefault(declaration: TSettingDeclaration): unknown {
  return 'default' in declaration ? declaration.default : undefined;
}

function readSettingsOverrides(
  config: ISettingsConfigRef,
  pluginId: string,
  extId: string,
): Record<string, unknown> {
  const entry = config.plugins?.[pluginId];
  const ext = entry?.extensions?.[extId];
  const settings = ext?.settings;
  if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
    return settings as Record<string, unknown>;
  }
  return {};
}

interface IValueCheck {
  ok: boolean;
  /** Short machine-readable reason, surfaced in the warning. */
  reason: string;
}

const OK: IValueCheck = { ok: true, reason: '' };

function fail(reason: string): IValueCheck {
  return { ok: false, reason };
}

/**
 * Validate a runtime value against the per-type rules of its declared
 * input-type. The discriminant `declaration.type` IS the dispatch
 * table; splitting per type would scatter the catalog without making
 * the algorithm clearer.
 */
// eslint-disable-next-line complexity
function validateSettingValue(
  declaration: TSettingDeclaration,
  value: unknown,
): IValueCheck {
  switch (declaration.type) {
    case 'string-list':
      return validateStringList(value, declaration.min, declaration.max, declaration.itemMaxLength);
    case 'single-string':
      return validateSingleString(value, declaration.minLength, declaration.maxLength, declaration.pattern);
    case 'boolean-flag':
      return typeof value === 'boolean' ? OK : fail('expected a boolean');
    case 'integer':
      return validateInteger(value, declaration.min, declaration.max);
    case 'number':
      return validateNumber(value, declaration.min, declaration.max);
    case 'enum-pick':
      return validateEnumPick(value, declaration.options.map((o) => o.value));
    case 'enum-multipick':
      return validateEnumMultipick(value, declaration.options.map((o) => o.value), declaration.min, declaration.max);
    case 'path-glob':
      return validatePathGlob(value, declaration.multiple === true);
    case 'regex':
      return validateRegex(value, declaration.flags);
    case 'secret':
      return typeof value === 'string' ? OK : fail('expected a string');
    case 'key-value-list':
      return validateKeyValueList(value, declaration.min, declaration.max);
    default: {
      const _exhaustive: never = declaration;
      return fail(`unknown input-type: ${String((_exhaustive as { type?: string }).type)}`);
    }
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function validateStringList(
  value: unknown,
  min: number | undefined,
  max: number | undefined,
  itemMaxLength: number | undefined,
): IValueCheck {
  if (!isStringArray(value)) return fail('expected an array of strings');
  if (min !== undefined && value.length < min) return fail(`expected at least ${min} item(s)`);
  if (max !== undefined && value.length > max) return fail(`expected at most ${max} item(s)`);
  const cap = itemMaxLength ?? 256;
  if (value.some((item) => item.length > cap)) return fail(`item exceeds ${cap} characters`);
  return OK;
}

function validateSingleString(
  value: unknown,
  minLength: number | undefined,
  maxLength: number | undefined,
  pattern: string | undefined,
): IValueCheck {
  if (typeof value !== 'string') return fail('expected a string');
  if (minLength !== undefined && value.length < minLength) return fail(`expected at least ${minLength} characters`);
  if (maxLength !== undefined && value.length > maxLength) return fail(`expected at most ${maxLength} characters`);
  return matchesPattern(value, pattern);
}

function matchesPattern(value: string, pattern: string | undefined): IValueCheck {
  if (pattern === undefined) return OK;
  let re: RegExp;
  try {
    re = new RegExp(pattern);
  } catch {
    // A bad author-side pattern is not the operator's fault; treat the
    // value as valid rather than rejecting on an uncompilable rule.
    return OK;
  }
  return re.test(value) ? OK : fail(`does not match pattern ${pattern}`);
}

function validateInteger(value: unknown, min: number | undefined, max: number | undefined): IValueCheck {
  if (typeof value !== 'number' || !Number.isInteger(value)) return fail('expected an integer');
  if (!Number.isSafeInteger(value)) return fail('integer out of safe range');
  if (min !== undefined && value < min) return fail(`expected >= ${min}`);
  if (max !== undefined && value > max) return fail(`expected <= ${max}`);
  return OK;
}

function validateNumber(value: unknown, min: number | undefined, max: number | undefined): IValueCheck {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fail('expected a finite number');
  if (min !== undefined && value < min) return fail(`expected >= ${min}`);
  if (max !== undefined && value > max) return fail(`expected <= ${max}`);
  return OK;
}

function validateEnumPick(value: unknown, allowed: string[]): IValueCheck {
  if (typeof value !== 'string') return fail('expected a string');
  if (!allowed.includes(value)) return fail(`expected one of: ${allowed.join(', ')}`);
  return OK;
}

function validateEnumMultipick(
  value: unknown,
  allowed: string[],
  min: number | undefined,
  max: number | undefined,
): IValueCheck {
  if (!isStringArray(value)) return fail('expected an array of strings');
  const allowedSet = new Set(allowed);
  if (value.some((v) => !allowedSet.has(v))) return fail(`every entry must be one of: ${allowed.join(', ')}`);
  if (min !== undefined && value.length < min) return fail(`expected at least ${min} selection(s)`);
  if (max !== undefined && value.length > max) return fail(`expected at most ${max} selection(s)`);
  return OK;
}

function validatePathGlob(value: unknown, multiple: boolean): IValueCheck {
  if (multiple) {
    return isStringArray(value) ? OK : fail('expected an array of glob strings');
  }
  return typeof value === 'string' ? OK : fail('expected a glob string');
}

function validateRegex(value: unknown, flags: string | undefined): IValueCheck {
  if (typeof value !== 'string') return fail('expected a string');
  try {
    // Compile with the author-declared flags so the value is checked
    // exactly the way the runtime will use it.
    new RegExp(value, flags ?? '');
  } catch (err) {
    return fail(`is not a compilable regex (${err instanceof Error ? err.message : String(err)})`);
  }
  return OK;
}

function validateKeyValueList(value: unknown, min: number | undefined, max: number | undefined): IValueCheck {
  if (!Array.isArray(value)) return fail('expected an array of { key, value } entries');
  const wellShaped = value.every(
    (entry) =>
      entry !== null &&
      typeof entry === 'object' &&
      typeof (entry as { key?: unknown }).key === 'string' &&
      typeof (entry as { value?: unknown }).value === 'string',
  );
  if (!wellShaped) return fail('every entry must be { key: string, value: string }');
  if (min !== undefined && value.length < min) return fail(`expected at least ${min} entr(y/ies)`);
  if (max !== undefined && value.length > max) return fail(`expected at most ${max} entr(y/ies)`);
  return OK;
}
