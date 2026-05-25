/**
 * Layered enabled-resolver helpers, combine the `settings.json`
 * baseline with the DB override map, and expose the per-extension
 * checks every compose helper needs.
 *
 * The resolver layer is the single place that owns the
 * "is this id enabled right now?" question; the composer / catalogs /
 * registry-update paths consume it through the helpers below so the
 * toggle model (per-extension, no bundle kill-switch) stays consistent.
 */

import type {
  IBuiltInBundle,
  TBuiltInExtension,
} from '../../../plugins/built-ins.js';
import { loadConfig } from '../../../kernel/config/loader.js';
import { makeEnabledResolver } from '../../../kernel/config/plugin-resolver.js';
import { qualifiedExtensionId } from '../../../kernel/registry.js';
import { resolveDbPath } from '../../paths/db-path.js';
import { tryWithSqlite } from '../../sqlite/with-sqlite.js';
import type { IRuntimeContext } from '../runtime-context.js';

/** Default-enabled fall-back: every id is enabled when no overrides exist. */
export function defaultResolveEnabled(_id: string): boolean {
  return true;
}

/**
 * Per-extension enabled filter for built-in bundles. Honours the spec
 * promise that "no extension is privileged", every built-in is
 * removable via `config_plugins` / `settings.json`. The bundle is a
 * presentational grouping only; the lookup key is always the qualified
 * extension id `<bundle.id>/<ext.id>`. Defaults to `true` for any id
 * without an explicit override.
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
  return resolveEnabled(qualifiedExtensionId(bundle.id, extId));
}

/**
 * Decide whether a loaded user-plugin extension is enabled under a
 * (possibly fresh) resolver. The lookup key is the qualified extension
 * id `<pluginId>/<extId>`, mirroring `isBundleEntryEnabled` for
 * built-ins. There is no bundle-level kill-switch anymore.
 */
export function isPluginExtensionEnabled(
  ext: { pluginId: string; id: string },
  resolveEnabled: (id: string) => boolean,
): boolean {
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
