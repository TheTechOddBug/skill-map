/**
 * Pure transformation helpers for `<sm-settings-plugins>`. Lives
 * outside the component file so each helper is unit-testable without
 * spinning up Angular and the `.ts` file with the `@Component`
 * decorator stays focused on view binding + intent handlers.
 *
 * Includes the ordering / filtering constants the helpers consume:
 *   - `KIND_FILTER_OPTIONS`: closed segment list for the kind filter.
 *   - `PINNED_PLUGIN_ORDER`: built-in plugin pin order.
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
export const PINNED_PLUGIN_ORDER: readonly string[] = [
  'core',
  'claude',
  'antigravity',
  'openai',
  'agent-skills',
];

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
 * Canonical Settings → Plugins ordering:
 *
 *   1. `PINNED_PLUGIN_ORDER` first in that exact sequence.
 *   2. Everything else after, alphabetical by plugin id.
 *   3. Inner extensions are sorted alphabetically by extension id.
 *
 * The unknown-plugin bucket falls to the end so a new built-in or a
 * third-party plugin lands in a predictable slot without needing this
 * file to know about it.
 */
export function sortPluginsByPin(plugins: IPluginItemApi[]): IPluginItemApi[] {
  const sortedTop = plugins.slice().sort((a, b) => {
    const aIdx = PINNED_PLUGIN_ORDER.indexOf(a.id);
    const bIdx = PINNED_PLUGIN_ORDER.indexOf(b.id);
    const aKey = aIdx >= 0 ? aIdx : PINNED_PLUGIN_ORDER.length;
    const bKey = bIdx >= 0 ? bIdx : PINNED_PLUGIN_ORDER.length;
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
