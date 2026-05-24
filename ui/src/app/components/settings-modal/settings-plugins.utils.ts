/**
 * Pure transformation helpers for `<sm-settings-plugins>`. Lives
 * outside the component file so each helper is unit-testable without
 * spinning up Angular and the `.ts` file with the `@Component`
 * decorator stays focused on view binding + intent handlers.
 *
 * Includes the ordering / filtering constants the helpers consume:
 *   - `KIND_FILTER_OPTIONS`: closed segment list for the kind filter.
 *   - `PINNED_BUNDLE_ORDER`: built-in bundle pin order.
 *   - `KIND_ORDER`: per-bundle extension pipeline order.
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
  IPluginItemApi,
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

/**
 * Built-in bundles that are pinned to the top of the Settings →
 * Plugins list, in this exact order. The four shipped-with-the-CLI
 * bundles are always visible first regardless of what
 * discovered/global plugins land in the future. Within each bundle
 * the extensions are sorted by `KIND_ORDER` (see `sortPluginsByPin`
 * below). Everything outside this list falls after, alphabetically.
 */
export const PINNED_BUNDLE_ORDER: readonly string[] = [
  'claude',
  'gemini',
  'agent-skills',
  'core',
];

/**
 * Pipeline order for `granularity: 'extension'` bundles (notably
 * `core`): classify → extract → diagnose → act → format → react.
 * Mirrors the marketing-site ecosystem diagram. Kinds not in this
 * list (future additions) fall to the end, alphabetical by extension
 * id.
 */
export const KIND_ORDER: readonly string[] = [
  'provider',
  'extractor',
  'analyzer',
  'action',
  'formatter',
  'hook',
];

export function qualifiedKey(bundleId: string, extensionId: string): string {
  return `${bundleId}/${extensionId}`;
}

/**
 * Walk the plugin list and project the toggle-state map the buffered
 * modal binds to. Keys mirror the bulk endpoint's accepted shape:
 *
 *   - `granularity: 'bundle'`     → `plugin.id` AND one entry per
 *     declared extension (qualified `<bundle>/<ext>` id). The bundle
 *     row keeps its own toggle (kill-the-whole-bundle gesture) and the
 *     UI exposes per-extension toggles too (Phase 4b follow-up,
 *     commit e45d2fd).
 *   - `granularity: 'extension'`  → one entry per extension, qualified
 *     `<bundle>/<ext>` id, value from the row's `enabled` field. No
 *     bundle-level entry: the bundle has no toggle axis of its own.
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
    if (plugin.granularity === 'bundle') {
      out.set(plugin.id, plugin.status === 'enabled');
    }
    if (plugin.extensions) {
      for (const ext of plugin.extensions) {
        out.set(qualifiedKey(plugin.id, ext.id), ext.enabled);
      }
    }
  }
  return out;
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
 * when the bundle hits (id OR description; passes through with the
 * original extensions), `[plugin']` (with the extensions array
 * narrowed to the matching ones) when the bundle misses but one or
 * more extensions hit, or `[]` when nothing matches.
 *
 * Match axes (any of):
 *   - bundle.id includes query
 *   - bundle.description includes query
 *   - extension.id includes query (only for granularity=extension bundles)
 *   - extension.description includes query (same constraint)
 */
export function filterBySearch(plugin: IPluginItemApi, query: string): IPluginItemApi[] {
  if (bundleHits(plugin, query)) return [plugin];
  if (plugin.granularity !== 'extension' || !plugin.extensions) return [];
  const matchingExtensions = plugin.extensions.filter((ext) => extensionHits(ext, query));
  if (matchingExtensions.length === 0) return [];
  return [{ ...plugin, extensions: matchingExtensions }];
}

/**
 * Narrow `plugin` to the picked kind:
 *
 *   - **granularity=bundle**: keep the row when `plugin.kinds`
 *     includes the picked kind. Bundle rows don't expose an
 *     `extensions` array on the wire, so we match on the aggregated
 *     `kinds` field the BFF stamps from the underlying extension
 *     list. This is what keeps the three vendor provider bundles
 *     (`claude`, `gemini`, `agent-skills`) visible under the
 *     "Provider" filter.
 *   - **granularity=extension**: drop the bundle if none of its
 *     extensions match; otherwise keep the bundle with only the
 *     matching extensions.
 *
 * Returns `[]` when nothing matches so the caller can simply `flatMap`.
 */
export function filterByKind(
  plugin: IPluginItemApi,
  kind: TExtensionKindForTint,
): IPluginItemApi[] {
  if (plugin.granularity === 'bundle') {
    return plugin.kinds.some((k) => k.toLowerCase() === kind) ? [plugin] : [];
  }
  if (!plugin.extensions) return [];
  const matchingExtensions = plugin.extensions.filter(
    (ext) => ext.kind.toLowerCase() === kind,
  );
  if (matchingExtensions.length === 0) return [];
  return [{ ...plugin, extensions: matchingExtensions }];
}

/**
 * Strip host-locked rows from the listing:
 *
 *   - bundle-level lock (`plugin.locked`) → drop the row entirely.
 *   - granularity=extension bundle: drop locked extensions; if the
 *     bundle ends up with zero extensions, drop the bundle row too
 *     (it has no toggle of its own and no children to show).
 */
export function stripLocked(plugin: IPluginItemApi): IPluginItemApi[] {
  if (plugin.locked) return [];
  if (plugin.granularity !== 'extension' || !plugin.extensions) {
    return [plugin];
  }
  const visibleExtensions = plugin.extensions.filter((ext) => !ext.locked);
  if (visibleExtensions.length === 0) return [];
  return [{ ...plugin, extensions: visibleExtensions }];
}

/**
 * Canonical Settings → Plugins ordering:
 *
 *   1. `PINNED_BUNDLE_ORDER` first in that exact sequence.
 *   2. Everything else after, alphabetical by bundle id.
 *   3. For `granularity: 'extension'` bundles, inner extensions are
 *      sorted by `KIND_ORDER`. Same-kind ties break alphabetically by
 *      extension id.
 *
 * The unknown-bundle / unknown-kind buckets fall to the end so a new
 * built-in or a third-party plugin lands in a predictable slot
 * without needing this file to know about it.
 */
export function sortPluginsByPin(plugins: IPluginItemApi[]): IPluginItemApi[] {
  const sortedTop = plugins.slice().sort((a, b) => {
    const aIdx = PINNED_BUNDLE_ORDER.indexOf(a.id);
    const bIdx = PINNED_BUNDLE_ORDER.indexOf(b.id);
    const aKey = aIdx >= 0 ? aIdx : PINNED_BUNDLE_ORDER.length;
    const bKey = bIdx >= 0 ? bIdx : PINNED_BUNDLE_ORDER.length;
    if (aKey !== bKey) return aKey - bKey;
    return a.id.localeCompare(b.id);
  });
  return sortedTop.map((plugin) => {
    if (plugin.granularity !== 'extension' || !plugin.extensions) return plugin;
    const sortedExtensions = plugin.extensions.slice().sort((ea, eb) => {
      const aKindIdx = KIND_ORDER.indexOf(ea.kind.toLowerCase());
      const bKindIdx = KIND_ORDER.indexOf(eb.kind.toLowerCase());
      const aKey = aKindIdx >= 0 ? aKindIdx : KIND_ORDER.length;
      const bKey = bKindIdx >= 0 ? bKindIdx : KIND_ORDER.length;
      if (aKey !== bKey) return aKey - bKey;
      return ea.id.localeCompare(eb.id);
    });
    return { ...plugin, extensions: sortedExtensions };
  });
}

function bundleHits(plugin: IPluginItemApi, query: string): boolean {
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
