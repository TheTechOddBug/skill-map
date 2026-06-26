/**
 * Layered enabled-resolver helpers, combine the `settings.json`
 * baseline with the DB override map, and expose the per-extension
 * checks every compose helper needs.
 *
 * The resolver layer is the single place that owns the
 * "is this id enabled right now?" question; the composer / catalogs /
 * registry-update paths consume it through the helpers below so the
 * toggle model (per-extension, no plugin kill-switch) stays consistent.
 */

import type {
  IBuiltInPlugin,
  TBuiltInExtension,
} from '../../../plugins/built-ins.js';
import { loadConfig } from '../../../kernel/config/loader.js';
import {
  installedDefaultEnabled,
  makeEnabledResolver,
  type EnabledResolver,
} from '../../../kernel/config/plugin-resolver.js';
import type { TExtensionStability } from '../../../kernel/extensions/base.js';
import { qualifiedExtensionId } from '../../../kernel/registry.js';
import { resolveDbPath } from '../../paths/db-path.js';
import { tryWithSqlite } from '../../sqlite/with-sqlite.js';
import type { IRuntimeContext } from '../runtime-context.js';

/**
 * Default-enabled fall-back used when no config / DB is available.
 * Honours the caller-supplied installed default so an `experimental`
 * extension stays OFF even on a bare project with zero overrides
 * (`installedDefault` is `false` for those, see `installedDefaultEnabled`).
 */
export function defaultResolveEnabled(_id: string, installedDefault = true): boolean {
  return installedDefault;
}

/**
 * Per-extension enabled filter for built-in plugins. Honours the spec
 * promise that "no extension is privileged", every built-in is
 * removable via `config_plugins` / `settings.json`. The plugin row is a
 * presentational grouping only; the lookup key is always the qualified
 * extension id `<plugin.id>/<ext.id>`. The installed default comes from
 * the extension's `stability` (experimental ships disabled).
 */
export function isBuiltInExtensionEnabled(
  plugin: IBuiltInPlugin,
  ext: TBuiltInExtension,
  resolveEnabled: EnabledResolver,
): boolean {
  return isPluginEntryEnabled(plugin, ext.id, resolveEnabled, ext.stability);
}

/**
 * Underlying primitive, works on the plain extension `id` rather than
 * a typed extension instance, so it can be reused from manifest-side
 * filters (`filterBuiltInManifests`) where the value is `IPluginManifest`,
 * not `TBuiltInExtension`. Same toggle semantics as
 * `isBuiltInExtensionEnabled`. `stability` drives the installed default
 * (experimental ships disabled); omit it for plugin-level callers that
 * want the plain enabled-by-default.
 */
export function isPluginEntryEnabled(
  plugin: IBuiltInPlugin,
  extId: string,
  resolveEnabled: EnabledResolver,
  stability?: TExtensionStability,
): boolean {
  return resolveEnabled(qualifiedExtensionId(plugin.id, extId), installedDefaultEnabled(stability));
}

/**
 * Decide whether a loaded user-plugin extension is enabled under a
 * (possibly fresh) resolver. The lookup key is the qualified extension
 * id `<pluginId>/<extId>`, mirroring `isPluginEntryEnabled` for
 * built-ins. There is no plugin-level kill-switch anymore. The
 * extension's `stability` (when carried) drives the installed default.
 */
export function isPluginExtensionEnabled(
  ext: { pluginId: string; id: string; stability?: TExtensionStability },
  resolveEnabled: EnabledResolver,
): boolean {
  return resolveEnabled(
    qualifiedExtensionId(ext.pluginId, ext.id),
    installedDefaultEnabled(ext.stability),
  );
}

/**
 * Layered resolver inputs read once from config + DB: the enabled
 * resolver AND the raw DB override map that backs the import-trust gate.
 * Bundled so `loadPluginRuntime` builds both from a single DB read.
 */
export interface IResolverInputs {
  resolveEnabled: EnabledResolver;
  /** `config_plugins` rows, the LOCAL trust signal (never settings.json). */
  dbOverrides: Map<string, boolean>;
}

/**
 * Read config + the DB override map once and return both the enabled
 * resolver and the raw override map. The override map is the local-only
 * signal the import-trust gate consumes (`makeImportTrustResolver`).
 */
export async function buildResolverInputs(
  ctx: IRuntimeContext,
): Promise<IResolverInputs> {
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
  return { resolveEnabled: makeEnabledResolver(cfg, dbOverrides), dbOverrides };
}

/**
 * Build the layered settings.json + DB enabled-resolver. Mirrors the
 * shape of `buildResolver` in `src/cli/commands/plugins.ts` (Step 6.6)
 * to keep the resolution policy in lock-step. Any divergence between
 * `sm plugins list` and the runtime would be a confusing UX regression.
 */
export async function buildEnabledResolver(
  ctx: IRuntimeContext,
): Promise<EnabledResolver> {
  return (await buildResolverInputs(ctx)).resolveEnabled;
}
