/**
 * Pure transformation helpers for `<sm-settings-plugins>`. Lives
 * outside the component file so each helper is unit-testable without
 * spinning up Angular and the `.ts` file with the `@Component`
 * decorator stays focused on view binding + intent handlers.
 *
 * Includes the ordering / filtering constants the helpers consume:
 *   - `KIND_FILTER_OPTIONS`: closed segment list for the kind filter.
 *   - wire `order` (stamped by the BFF listing) drives the plugin sort.
 *
 * Storage helpers live in `./settings-plugins.storage.ts` so this
 * file has zero `localStorage` access, every function here is a
 * pure projection over its inputs.
 */

import { SETTINGS_TEXTS } from '../../../i18n/settings.texts';
import {
  EXTENSION_KIND_TINTS,
  type TExtensionKindForTint,
} from '../../../services/extension-kind-tints';
import { DataSourceError } from '../../../services/data-source/data-source.port';
import type {
  IPluginExtensionApi,
  IPluginExtensionSettingApi,
  IPluginItemApi,
  TSettingValueApi,
} from '../../../models/api';

/**
 * Strongly-typed alias for the Settings i18n catalogue. Label resolvers
 * below accept it as an argument instead of importing the singleton so
 * tests can swap in fixture text bags.
 */
export type TSettingsTexts = typeof SETTINGS_TEXTS;

/** Sentinel for the "show every kind" segment of the kind filter. */
export type TKindFilter = 'all' | TExtensionKindForTint;

/** Order matches the spec's `IExtensionBase.kind` enum and the
 *  marketing site's ecosystem diagram (provider → extractor →
 *  analyzer → action → formatter → hook). 'all' renders first as the
 *  neutral default. */
export const KIND_FILTER_OPTIONS: readonly TKindFilter[] = [
  'all',
  ...(Object.keys(EXTENSION_KIND_TINTS) as TExtensionKindForTint[]),
] as const;

/** Kind chips rendered in the unified filter bar (the kinds, no 'all';
 *  the bar carries a single shared "All" reset that clears both axes). */
export const KIND_FILTER_CHIPS: readonly TExtensionKindForTint[] =
  Object.keys(EXTENSION_KIND_TINTS) as TExtensionKindForTint[];

/** Sentinel for the "show every source" segment of the source filter:
 *  'all' plus the spec's plugin source enum ('built-in' | 'project'). */
export type TSourceFilter = 'all' | IPluginItemApi['source'];

/** The two real source values. Mutually exclusive between themselves and
 *  independent of the kind axis. */
export type TSourceChip = Exclude<TSourceFilter, 'all'>;

/** Full source-filter domain, used to validate the persisted value. */
export const SOURCE_FILTER_OPTIONS: readonly TSourceFilter[] = [
  'all',
  'built-in',
  'project',
] as const;

/** Source chips rendered in the unified filter bar (no 'all'; the shared
 *  "All" chip handles the neutral reset). */
export const SOURCE_FILTER_CHIPS: readonly TSourceChip[] = ['built-in', 'project'];

/**
 * Built-in plugins that are pinned to the top of the Settings →
 * Plugins list, in this exact order. `core` leads because it carries
 * the universal extractors / analyzers / formatters the user reaches
 * for the most; the vendor plugins follow in the same order
 * `built-ins.ts` declares them so the runtime + presentation pin lists
 * stay aligned. Within each plugin the extensions are sorted
 * alphabetically by extension id (see `sortPluginsByPin` below).
 * Drop-in / future built-ins outside this list fall after,
 * alphabetically.
 *
 * Why hardcoded vs sourced from `built-ins.ts`: the runtime array is
 * driven by `core/markdown` needing terminal position in the provider
 * iteration order (see `spec/architecture.md` §"core/markdown is the
 * universal fallback"); presentation has the opposite intuition (the
 * thing the user touches first should be at the top of the list).
 * Keeping the two lists separate makes the asymmetry explicit.
 */

export function qualifiedKey(pluginId: string, extensionId: string): string {
  return `${pluginId}/${extensionId}`;
}

/**
 * Walk the plugin list and project the toggle-state map the buffered
 * modal binds to. Every extension is independently toggle-able; the
 * plugin has no toggle axis of its own. One entry per extension keyed
 * by the qualified `<plugin>/<ext>` id.
 *
 * Failure rows (`invalid-manifest` / `load-error` / `incompatible-spec`
 * / `id-collision`) carry no toggle axis and are excluded; the template
 * renders them inert anyway.
 */
export function buildStateFromPlugins(
  plugins: readonly IPluginItemApi[],
): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const plugin of plugins) {
    if (isFailureStatus(plugin.status)) continue;
    if (plugin.extensions) {
      for (const ext of plugin.extensions) {
        out.set(qualifiedKey(plugin.id, ext.id), ext.enabled);
      }
    }
  }
  return out;
}

/**
 * A single extension's editable settings buffer: settingId -> value.
 * Mirrors the resolved `settingValues` shape, with secrets carried as a
 * plain string (`''` = blank = unchanged). One of these per extension
 * that declares settings, keyed by the qualified `<plugin>/<ext>` id.
 */
export type TSettingsBuffer = Map<string, Record<string, TSettingValueApi>>;

/**
 * Seed the editable settings buffer for one extension from its declared
 * settings + the resolved `settingValues` the GET shipped. Each setting
 * starts at: the resolved effective value when present, else the
 * declaration `default`, else a type-appropriate blank. Secrets ALWAYS
 * start blank (their value never crosses the wire); the "set" / "empty"
 * hint is driven separately by `secretSettingsSet`, and a blank secret
 * on apply means "leave unchanged".
 */
export function seedExtensionSettings(
  ext: IPluginExtensionApi,
): Record<string, TSettingValueApi> {
  const out: Record<string, TSettingValueApi> = {};
  for (const decl of ext.settings ?? []) {
    out[decl.id] = seedSettingValue(decl, ext.settingValues?.[decl.id]);
  }
  return out;
}

/**
 * Resolve the seed value for a single setting: prefer the resolved
 * effective value (coerced into the declared shape), fall back to the
 * declaration `default`, finally a type-appropriate blank. Secret values
 * are never seeded from `resolved` (they are stripped on the wire), so
 * they always start blank.
 */
function seedSettingValue(
  decl: IPluginExtensionSettingApi,
  resolved: unknown,
): TSettingValueApi {
  if (decl.type === 'secret') return '';
  if (resolved !== undefined) return coerceToDeclared(decl, resolved);
  if (decl.default !== undefined) return coerceToDeclared(decl, decl.default);
  return blankForType(decl);
}

/** Type-appropriate empty value for a setting with no seed and no default. */
function blankForType(decl: IPluginExtensionSettingApi): TSettingValueApi {
  switch (decl.type) {
    case 'boolean-flag':
      return false;
    case 'string-list':
    case 'enum-multipick':
      return [];
    case 'key-value-list':
      return [];
    case 'path-glob':
      return decl.multiple ? [] : '';
    case 'integer':
    case 'number':
      // No numeric blank exists; the control treats `''` as "unset" and
      // the buffer round-trips it as not-sent (see `changedSettings`).
      return '';
    default:
      return '';
  }
}

/**
 * Coerce an arbitrary JSON value (from `settingValues` or a `default`)
 * into the runtime shape the control + buffer expect for the declared
 * type. Defensive: a wire value of the wrong shape degrades to the
 * type's blank rather than throwing.
 */
export function coerceToDeclared(
  decl: IPluginExtensionSettingApi,
  raw: unknown,
): TSettingValueApi {
  switch (decl.type) {
    case 'boolean-flag':
      return raw === true;
    case 'integer':
    case 'number':
      return typeof raw === 'number' && Number.isFinite(raw) ? raw : '';
    case 'string-list':
    case 'enum-multipick':
      return Array.isArray(raw) ? raw.filter((e): e is string => typeof e === 'string') : [];
    case 'path-glob':
      if (decl.multiple) {
        return Array.isArray(raw) ? raw.filter((e): e is string => typeof e === 'string') : [];
      }
      return typeof raw === 'string' ? raw : '';
    case 'key-value-list':
      return Array.isArray(raw)
        ? raw
            .filter(
              (e): e is { key: unknown; value: unknown } =>
                typeof e === 'object' && e !== null && 'key' in e && 'value' in e,
            )
            .map((e) => ({ key: String(e.key ?? ''), value: String(e.value ?? '') }))
        : [];
    default:
      // single-string / enum-pick / regex / secret
      return typeof raw === 'string' ? raw : '';
  }
}

/**
 * Build the full settings buffer (one entry per extension that declares
 * settings) for the whole plugin list. Failure rows are skipped (same as
 * the toggle state). Keyed by qualified `<plugin>/<ext>` id.
 */
export function buildSettingsFromPlugins(
  plugins: readonly IPluginItemApi[],
): TSettingsBuffer {
  const out: TSettingsBuffer = new Map();
  for (const plugin of plugins) {
    if (isFailureStatus(plugin.status)) continue;
    for (const ext of plugin.extensions ?? []) {
      if (!ext.settings || ext.settings.length === 0) continue;
      out.set(qualifiedKey(plugin.id, ext.id), seedExtensionSettings(ext));
    }
  }
  return out;
}

/**
 * Compute the per-setting patch to ship for one extension: the keys
 * whose pending value differs from the original snapshot. Returns
 * `null` when nothing changed (so the caller can skip the `settings`
 * field entirely).
 *
 * Secret semantics: a blank pending value (`''`) is "unchanged", so it
 * is NEVER included (even though the original was also blank). A typed
 * secret value is always a change.
 *
 * Numeric "unset" (`''`) is dropped to avoid shipping an empty string
 * where a number is expected; clearing a number to re-derive the default
 * is out of scope (the operator types a value to change it).
 */
export function changedSettings(
  declarations: readonly IPluginExtensionSettingApi[] | undefined,
  original: Record<string, TSettingValueApi> | undefined,
  pending: Record<string, TSettingValueApi> | undefined,
): Record<string, TSettingValueApi> | null {
  if (!declarations || declarations.length === 0) return null;
  if (!pending) return null;
  const patch: Record<string, TSettingValueApi> = {};
  for (const decl of declarations) {
    const id = decl.id;
    const next = pending[id];
    if (decl.type === 'secret') {
      // Blank secret = leave unchanged; only ship a typed value.
      if (typeof next === 'string' && next.length > 0) patch[id] = next;
      continue;
    }
    // Numeric "unset" sentinel never ships.
    if ((decl.type === 'integer' || decl.type === 'number') && next === '') continue;
    const prev = original?.[id];
    if (!settingValuesEqual(prev, next)) patch[id] = next as TSettingValueApi;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * Whether one extension's settings buffer is dirty (any non-secret value
 * changed, or any secret carries a typed value). Drives the per-row
 * dirty dot alongside the toggle diff.
 */
export function extensionSettingsDirty(
  declarations: readonly IPluginExtensionSettingApi[] | undefined,
  original: Record<string, TSettingValueApi> | undefined,
  pending: Record<string, TSettingValueApi> | undefined,
): boolean {
  return changedSettings(declarations, original, pending) !== null;
}

/**
 * Structural equality for two setting values. Arrays compare element-wise
 * (order-sensitive, matching how the UI presents them); key-value rows
 * compare by `(key, value)` pairs; scalars compare by `===`. Used by the
 * dirty diff so a no-op edit (typing then deleting) clears the marker.
 */
export function settingValuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((el, i) => settingValuesEqual(el, b[i]));
  }
  if (
    typeof a === 'object' && a !== null &&
    typeof b === 'object' && b !== null &&
    'key' in a && 'value' in a && 'key' in b && 'value' in b
  ) {
    const ra = a as { key: unknown; value: unknown };
    const rb = b as { key: unknown; value: unknown };
    return ra.key === rb.key && ra.value === rb.value;
  }
  return false;
}

/**
 * True when the user clicked on (or inside) an interactive child of
 * the row, the toggle, the expand chevron, or anything else with
 * its own click handler. Used by the row / subrow click listeners to
 * back off so we never double-fire (the inner control already did
 * its job and called `stopPropagation` where it mattered, but this
 * guard is defence in depth, `closest('label, button, [role=switch]')`
 * covers the PrimeNG ToggleSwitch root and the chevron button
 * without us having to hard-code a class list).
 */
export function clickedInteractive(event: Event): boolean {
  const target = event.target as Element | null;
  if (!target || typeof target.closest !== 'function') return false;
  return target.closest('label, button, input, [role="switch"], p-toggleswitch') !== null;
}

/**
 * Match `plugin` against the lower-cased query. Returns `[plugin]`
 * unchanged when the plugin id or description hits, `[plugin']` with
 * the extensions array narrowed when only inner extensions hit, or
 * `[]` when nothing matches.
 *
 * Match axes (any of):
 *   - plugin.id includes query
 *   - plugin.description includes query
 *   - extension.id includes query
 *   - extension.description includes query
 */
export function filterBySearch(plugin: IPluginItemApi, query: string): IPluginItemApi[] {
  if (pluginHits(plugin, query)) return [plugin];
  if (!plugin.extensions) return [];
  const matchingExtensions = plugin.extensions.filter((ext) => extensionHits(ext, query));
  if (matchingExtensions.length === 0) return [];
  return [{ ...plugin, extensions: matchingExtensions }];
}

/**
 * Narrow `plugin` to the picked kind: drop the plugin if none of its
 * extensions match the kind; otherwise keep the plugin with only the
 * matching extensions. The plugin row stays as a header (the user
 * sees the grouping) but its expanded sublist only shows the picked
 * kind. Returns `[]` when nothing matches so the caller can simply
 * `flatMap`.
 *
 * Replaces the previous granularity-aware branch: the plugin is now
 * always a presentational grouping, never a toggle target, so the
 * matching surface is the underlying extensions in every case (this
 * is what fixes the "click provider, see extractors too" bug).
 */
export function filterByKind(
  plugin: IPluginItemApi,
  kind: TExtensionKindForTint,
): IPluginItemApi[] {
  if (!plugin.extensions) return [];
  const matchingExtensions = plugin.extensions.filter(
    (ext) => ext.kind.toLowerCase() === kind,
  );
  if (matchingExtensions.length === 0) return [];
  return [{ ...plugin, extensions: matchingExtensions }];
}

/**
 * Narrow the listing to the picked source. 'all' keeps every plugin;
 * otherwise keep the plugin whole only when `plugin.source` matches.
 * Unlike `filterByKind`, source is a plugin-level axis so the extension
 * sublist is never narrowed, the plugin is either in or out. Returns
 * `[]` when the source does not match so the caller can `flatMap`.
 */
export function filterBySource(
  plugin: IPluginItemApi,
  source: TSourceFilter,
): IPluginItemApi[] {
  if (source === 'all') return [plugin];
  return plugin.source === source ? [plugin] : [];
}

/**
 * Strip host-locked rows from the listing:
 *
 *   - plugin-level lock (`plugin.locked`) → drop the row entirely.
 *   - drop locked extensions inside the plugin; if the plugin ends
 *     up with zero extensions, drop the plugin row too (no children
 *     left to show).
 */
export function stripLocked(plugin: IPluginItemApi): IPluginItemApi[] {
  if (plugin.locked) return [];
  if (!plugin.extensions) return [plugin];
  const visibleExtensions = plugin.extensions.filter((ext) => !ext.locked);
  if (visibleExtensions.length === 0) return [];
  return [{ ...plugin, extensions: visibleExtensions }];
}

/**
 * The Settings headline for a plugin: the friendly lens label of the
 * plugin's provider, so the plugins list mirrors the active-lens selector
 * ("Anthropic's Claude", "OpenAI's Codex", ...). Falls back to the plugin
 * id when the plugin has no lens provider (e.g. `core`, whose only
 * provider is the non-lens `markdown` base) or when the provider has no
 * registry entry. `lensLabelFor` returns the label ONLY for a provider
 * that is a selectable lens (`isLens`), `null` otherwise, so the
 * non-gated base never lends its name to a plugin row.
 */
export function pluginDisplayName(
  plugin: IPluginItemApi,
  lensLabelFor: (providerId: string) => string | null,
): string {
  const provider = plugin.extensions?.find((e) => e.kind === 'provider');
  if (provider) {
    const label = lensLabelFor(provider.id);
    if (label) return label;
  }
  return plugin.id;
}

/**
 * Canonical Settings → Plugins ordering:
 *
 *   1. The wire `order` stamped by the BFF (built-ins first in the
 *      canonical presentation order, then drop-ins).
 *   2. Items without the field after, alphabetical by plugin id.
 *   3. Inner extensions are sorted alphabetically by extension id.
 *
 * The unknown-plugin bucket falls to the end so a new built-in or a
 * third-party plugin lands in a predictable slot without needing this
 * file to know about it.
 */
export function sortPluginsByPin(plugins: IPluginItemApi[]): IPluginItemApi[] {
  // The BFF stamps each item's presentation `order` (single source:
  // `src/plugins/presentation-order.ts`); the SPA keeps NO pinned twin
  // (kernel-agnosticism sweep 2026-07-23). Items without the field
  // (older fixtures) fall to the end, alphabetical.
  const sortedTop = plugins.slice().sort((a, b) => {
    const aKey = a.order ?? Number.MAX_SAFE_INTEGER;
    const bKey = b.order ?? Number.MAX_SAFE_INTEGER;
    if (aKey !== bKey) return aKey - bKey;
    return a.id.localeCompare(b.id);
  });
  return sortedTop.map((plugin) => {
    if (!plugin.extensions) return plugin;
    const sortedExtensions = plugin.extensions
      .slice()
      .sort((ea, eb) => ea.id.localeCompare(eb.id));
    return { ...plugin, extensions: sortedExtensions };
  });
}

function pluginHits(plugin: IPluginItemApi, query: string): boolean {
  if (plugin.id.toLowerCase().includes(query)) return true;
  if (plugin.description && plugin.description.toLowerCase().includes(query)) return true;
  return false;
}

function extensionHits(ext: IPluginExtensionApi, query: string): boolean {
  if (ext.id.toLowerCase().includes(query)) return true;
  if (ext.description && ext.description.toLowerCase().includes(query)) return true;
  return false;
}

export function isFailureStatus(status: IPluginItemApi['status']): boolean {
  return (
    status === 'incompatible-spec' ||
    status === 'invalid-manifest' ||
    status === 'load-error' ||
    status === 'id-collision'
  );
}

export function formatErr(err: unknown): string {
  if (err instanceof DataSourceError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Human label for a plugin row's status cell. Failure statuses route
 * through the per-code map; the toggleable statuses collapse to a plain
 * "Enabled" / "Disabled" string. Unknown failure codes fall back to the
 * raw status so the surface still says something.
 */
export function statusLabel(plugin: IPluginItemApi, texts: TSettingsTexts): string {
  if (isFailureStatus(plugin.status)) {
    return texts.statusFailure[plugin.status] ?? plugin.status;
  }
  return plugin.status === 'enabled'
    ? texts.enabledLabel
    : texts.disabledLabel;
}

/**
 * Human label for the plugin's source field. The switch is exhaustive
 * over the spec's source enum, so the return type stays `string` rather
 * than `string | undefined`.
 */
export function sourceLabel(
  source: IPluginItemApi['source'],
  texts: TSettingsTexts,
): string {
  switch (source) {
    case 'built-in':
      return texts.sourceBuiltIn;
    case 'project':
      return texts.sourceProject;
  }
}
