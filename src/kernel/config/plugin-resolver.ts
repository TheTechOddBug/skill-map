/**
 * Decide whether a plugin is enabled, given the layered inputs.
 *
 * Decision (recorded against the option-3 vote in the plan):
 *
 *   `.skill-map/settings.json#/plugins/<id>/enabled` is the **team-shared
 *   baseline** committed to the repo; `config_plugins.enabled` in the DB
 *   is the **user override** that takes precedence locally without
 *   requiring a commit.
 *
 * Effective order (highest precedence first):
 *
 *   1. DB override     (`config_plugins` row, if present)
 *   2. settings.json   (`cfg.plugins[id].enabled`, if defined)
 *   3. installed default, supplied by the caller (`true` for ordinary
 *      extensions, `false` for `experimental` ones, see
 *      `installedDefaultEnabled`)
 *
 * The same precedence applies whether the scope is `project` or
 * `global`; the caller picks which scope's DB to read.
 */

import type { TExtensionStability } from '../extensions/base.js';
import type { IEffectiveConfig } from './loader.js';
import { isPluginLocked } from './locked-plugins.js';

/**
 * Resolver signature consumed across the runtime. The optional
 * `installedDefault` is the value returned when neither the DB nor
 * `settings.json` carries an explicit override for the id; it lets the
 * caller (which holds the extension manifest) push the per-extension
 * default down without the resolver having to know the manifest catalog.
 * Omitted == `true`, the historical "everything enabled until told
 * otherwise" behaviour used by plugin-level (bare id) lookups.
 */
export type EnabledResolver = (id: string, installedDefault?: boolean) => boolean;

/**
 * Lifecycle labels whose extensions ship DISABLED by default:
 * `experimental` (not ready yet, opt in to try) and `deprecated` (on
 * its way out, opt in to keep using during the transition). Both
 * require an explicit enable to run; `beta` / `stable` / undefined stay
 * enabled.
 */
const SHIPS_DISABLED: ReadonlySet<TExtensionStability> = new Set([
  'experimental',
  'deprecated',
]);

/**
 * Installed default-enabled state for an extension given its declared
 * `stability`. `experimental` and `deprecated` ship OFF (the operator
 * opts in via the Settings toggle / `sm plugins enable`); every other
 * value (`beta`, `stable`, or undefined) ships ON. This is the ONLY
 * place the ships-disabled policy lives; the resolver stays
 * manifest-agnostic and consumes the boolean this returns.
 */
export function installedDefaultEnabled(stability?: TExtensionStability): boolean {
  return stability === undefined || !SHIPS_DISABLED.has(stability);
}

export function resolvePluginEnabled(
  pluginId: string,
  cfg: Pick<IEffectiveConfig, 'plugins'>,
  dbOverrides: Map<string, boolean>,
  installedDefault = true,
): boolean {
  // Defense in depth, the host lock-list (`./locked-plugins.ts`) is
  // policy. Both the CLI (`sm plugins enable|disable`) and the BFF
  // (`PATCH /api/plugins/...`) reject writes against locked ids up
  // front, but if a stale `config_plugins` row or a hand-edited
  // `settings.json` ever slips one through, the resolver overrides it
  // and returns enabled. This makes "lock" unbreakable at runtime
  // regardless of persisted state. (Nothing experimental is lockable, so
  // the lock arm intentionally ignores `installedDefault`.)
  if (isPluginLocked(pluginId)) return true;
  if (dbOverrides.has(pluginId)) return dbOverrides.get(pluginId) === true;
  const settingsEntry = cfg.plugins[pluginId];
  if (settingsEntry?.enabled !== undefined) return settingsEntry.enabled;
  return installedDefault;
}

/**
 * Build a closure suitable for `IPluginLoaderOptions.resolveEnabled`.
 * Captures the layered settings and DB override map once so the
 * loader can ask per-plugin without re-reading anything. Forwards the
 * caller-supplied `installedDefault` (per-extension experimental gate)
 * straight through to `resolvePluginEnabled`.
 */
export function makeEnabledResolver(
  cfg: Pick<IEffectiveConfig, 'plugins'>,
  dbOverrides: Map<string, boolean>,
): EnabledResolver {
  return (pluginId, installedDefault) =>
    resolvePluginEnabled(pluginId, cfg, dbOverrides, installedDefault);
}
