/**
 * Layered enabled-resolver helpers, combine the `settings.json`
 * baseline with the DB override map, and expose the per-extension /
 * per-bundle granularity checks every compose helper needs.
 *
 * The resolver layer is the single place that owns the
 * "is this id enabled right now?" question; the composer / catalogs /
 * registry-update paths consume it through the helpers below so the
 * granularity model (bundle vs extension) stays consistent.
 */

import type {
  IBuiltInBundle,
  TBuiltInExtension,
} from '../../../plugins/built-ins.js';
import { loadConfig } from '../../../kernel/config/loader.js';
import { makeEnabledResolver } from '../../../kernel/config/plugin-resolver.js';
import { qualifiedExtensionId } from '../../../kernel/registry.js';
import type {
  IDiscoveredPlugin,
  TGranularity,
} from '../../../kernel/types/plugin.js';
import { resolveDbPath } from '../../paths/db-path.js';
import { tryWithSqlite } from '../../sqlite/with-sqlite.js';
import type { IRuntimeContext } from '../runtime-context.js';

/** Default-enabled fall-back: every id is enabled when no overrides exist. */
export function defaultResolveEnabled(_id: string): boolean {
  return true;
}

/**
 * Granularity-aware filter for built-in bundles. Honours the spec
 * promise that "no extension is privileged", every built-in is
 * removable via `config_plugins` / `settings.json`.
 *
 * Resolution rules (mirror `kernel/config/plugin-resolver.ts`):
 *
 *   - bundle granularity (`claude`): the user toggles the namespace
 *     once; the lookup key is `<bundle.id>`, every extension in the
 *     bundle follows. A user-set DB / settings entry under
 *     `<bundle.id>/<ext.id>` is silently ignored (the granularity says
 *     "this bundle is one knob"); the validation that catches that as
 *     a CLI input error happens upstream in `sm plugins enable/disable`.
 *   - extension granularity (`core`): the lookup key is the qualified
 *     id `<bundle.id>/<ext.id>`. Each extension is independently
 *     toggle-able.
 *
 * Defaults to `true` for any id without an explicit override.
 */
export function isBuiltInExtensionEnabled(
  bundle: IBuiltInBundle,
  ext: TBuiltInExtension,
  resolveEnabled: (id: string) => boolean,
): boolean {
  return isBundleEntryEnabled(bundle, ext.id, resolveEnabled);
}

/**
 * Underlying primitive, works on the plain extension `id` rather than
 * a typed extension instance, so it can be reused from manifest-side
 * filters (`filterBuiltInManifests`) where the value is `IPluginManifest`,
 * not `TBuiltInExtension`. Same toggle semantics as
 * `isBuiltInExtensionEnabled`.
 */
export function isBundleEntryEnabled(
  bundle: IBuiltInBundle,
  extId: string,
  resolveEnabled: (id: string) => boolean,
): boolean {
  if (bundle.granularity === 'bundle') {
    return resolveEnabled(bundle.id);
  }
  return resolveEnabled(qualifiedExtensionId(bundle.id, extId));
}

/**
 * Per-plugin granularity lookup used by the user-extension filter in
 * `composeScanExtensions` / `composeFormatters` / `registerEnabledExtensions`.
 *
 * Built from `pluginRuntime.discovered` once per compose call; each entry
 * maps a plugin id to its declared `granularity` (`'bundle'` is the
 * spec default when the manifest omits the field). The compose helpers
 * use this map to pick the correct resolver key per extension,
 * `<pluginId>` for bundle-granularity bundles, `qualifiedExtensionId(...)`
 * for extension-granularity bundles, so a fresh `resolveEnabled` can
 * silence an already-loaded plugin without restarting `sm serve`.
 */
export function buildGranularityMap(
  discovered: readonly IDiscoveredPlugin[],
): Map<string, TGranularity> {
  const out = new Map<string, TGranularity>();
  for (const plugin of discovered) {
    out.set(plugin.id, plugin.granularity ?? 'bundle');
  }
  return out;
}

/**
 * Decide whether a loaded user-plugin extension is enabled under a
 * (possibly fresh) resolver. Mirrors `isBundleEntryEnabled` for
 * built-ins: bundle-granularity bundles toggle as one (the lookup key
 * is the bundle id); extension-granularity bundles toggle per
 * extension (qualified id).
 *
 * The `granularityMap` is built once per compose call to avoid an O(N)
 * `discovered.find(...)` per extension.
 *
 * Unknown plugin ids (the granularity map lookup fails) default to
 * `bundle`, the spec default for missing `granularity` on a manifest.
 * This should never fire in practice because every extension in
 * `bundle.extensions.*` came from a `discovered` plugin that was
 * granularity-stamped at load time, but the fall-through keeps the
 * helper safe to share with future call sites.
 */
export function isPluginExtensionEnabled(
  ext: { pluginId: string; id: string },
  granularityMap: Map<string, TGranularity>,
  resolveEnabled: (id: string) => boolean,
): boolean {
  const granularity = granularityMap.get(ext.pluginId) ?? 'bundle';
  if (granularity === 'bundle') return resolveEnabled(ext.pluginId);
  return resolveEnabled(qualifiedExtensionId(ext.pluginId, ext.id));
}

/**
 * Build the layered settings.json + DB enabled-resolver. Mirrors the
 * shape of `buildResolver` in `src/cli/commands/plugins.ts` (Step 6.6)
 * to keep the resolution policy in lock-step. Any divergence between
 * `sm plugins list` and the runtime would be a confusing UX regression.
 */
export async function buildEnabledResolver(
  ctx: IRuntimeContext,
): Promise<(id: string) => boolean> {
  const { effective: cfg } = loadConfig({ ...ctx });
  const dbPath = resolveDbPath({
    db: undefined,
    ...ctx,
  });
  const dbOverrides =
    (await tryWithSqlite(
      { databasePath: dbPath, autoBackup: false },
      (adapter) => adapter.pluginConfig.loadOverrideMap(),
    )) ?? new Map<string, boolean>();
  return makeEnabledResolver(cfg, dbOverrides);
}
