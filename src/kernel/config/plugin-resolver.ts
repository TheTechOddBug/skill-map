/**
 * Two orthogonal axes for a project-local plugin, resolved here.
 *
 *   - **Enabled** (operational, shareable). Is this plugin / extension
 *     part of the project? Lives in the config layers
 *     (`plugins.<id>.enabled` / `plugins.<id>.extensions.<ext>.enabled`
 *     in `settings.json` committed, `settings.local.json` per-checkout).
 *     `resolvePluginEnabled` / `makeEnabledResolver` own this question.
 *
 *   - **Trusted** (security, LOCAL, per-machine). Does THIS machine's
 *     operator consent to importing the plugin's code? Lives in the DB
 *     (`config_plugins` trust store, written by `sm plugins trust <id>`
 *     or `sm plugins trust --all`). `makeTrustResolver` owns this question.
 *
 * A project-local plugin's code is imported iff it is **enabled** (config)
 * AND it is **trusted** (DB). Per-extension enable is applied AFTER import,
 * at registration.
 *
 * The two axes are deliberately split: a committed `settings.json` can
 * mark a plugin enabled (team-shared "this is part of the project") but
 * can NEVER grant import trust, since the DB never travels in a commit.
 * A fresh clone has no DB trust row, so its project-local plugins are
 * discovered but never executed.
 */

import type { TExtensionStability } from '../extensions/base.js';
import type { IEffectiveConfig } from './loader.js';

/**
 * Host-locked qualified extension ids. The kernel does NOT know which
 * ids are locked (it must stay plugin-agnostic, decision 2026-07-23):
 * the set is DERIVED from the manifests' `locked` flag by
 * `src/plugins/locked-built-ins.ts` and threaded in by each resolver
 * construction site. An empty set (the default) means no lock arm.
 */
export type TLockedIds = ReadonlySet<string>;

const NO_LOCKS: TLockedIds = new Set();

/**
 * Resolver signature consumed across the runtime. The optional
 * `installedDefault` is the value returned when neither the per-extension
 * nor the plugin-level config carries an explicit override for the id; it
 * lets the caller (which holds the extension manifest) push the
 * per-extension default down without the resolver having to know the
 * manifest catalog. Omitted == `true`, the historical "everything enabled
 * until told otherwise" behaviour used by plugin-level (bare id) lookups.
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
 * Installed default-enabled state for an extension. The manifest's
 * `defaultEnabled` override wins when declared (orthogonal axis, spec
 * `base.schema.json#/properties/defaultEnabled`: a `stable` extension
 * can ship as a deliberate opt-in without mislabeling its maturity);
 * otherwise `stability` decides: `experimental` and `deprecated` ship
 * OFF (the operator opts in via the Settings toggle / `sm plugins
 * enable`), every other value (`beta`, `stable`, or undefined) ships
 * ON. This is the ONLY place the ships-disabled policy lives; the
 * resolver stays manifest-agnostic and consumes the boolean this
 * returns.
 */
export function installedDefaultEnabled(
  stability?: TExtensionStability,
  defaultEnabled?: boolean,
): boolean {
  if (defaultEnabled !== undefined) return defaultEnabled;
  return stability === undefined || !SHIPS_DISABLED.has(stability);
}

/**
 * Decide whether a plugin / extension is **enabled** (operational axis)
 * under the layered config. Enable lives entirely in the config layers
 * now (the DB no longer carries it); trust is a separate axis resolved
 * by `makeTrustResolver`.
 *
 * Two id shapes resolve here:
 *
 *   - **bare** `<plugin>`: `cfg.plugins[id]?.enabled ?? installedDefault`.
 *   - **qualified** `<plugin>/<ext>`: the per-extension override
 *     (`cfg.plugins[p]?.extensions?.[e]?.enabled`) wins; else the
 *     plugin-level override (`cfg.plugins[p]?.enabled`); else
 *     `installedDefault`.
 *
 * The qualified-id walk is load-bearing: the registration filters in
 * `composer.ts` / `resolver.ts` call it with qualified ids.
 */
export function resolvePluginEnabled(
  pluginId: string,
  cfg: Pick<IEffectiveConfig, 'plugins'>,
  installedDefault = true,
  lockedIds: TLockedIds = NO_LOCKS,
): boolean {
  // Defense in depth, the manifest-declared lock is policy. Both the
  // CLI (`sm plugins enable|disable`) and the BFF
  // (`PATCH /api/plugins/...`) reject writes against locked ids up
  // front, but if a hand-edited `settings.json` ever slips one through,
  // the resolver overrides it and returns enabled. This makes "lock"
  // unbreakable at runtime regardless of persisted state. (Nothing
  // experimental is lockable, so the lock arm intentionally ignores
  // `installedDefault`.) Membership is qualified-id only; the caller
  // derives the set from the manifests (`locked-built-ins.ts`).
  if (lockedIds.has(pluginId)) return true;

  const slash = pluginId.indexOf('/');
  if (slash >= 0) {
    return resolveQualifiedEnabled(
      pluginId.slice(0, slash),
      pluginId.slice(slash + 1),
      cfg,
      installedDefault,
    );
  }

  const settingsEntry = cfg.plugins[pluginId];
  if (settingsEntry?.enabled !== undefined) return settingsEntry.enabled;
  return installedDefault;
}

/**
 * Qualified-id enable walk: per-extension override wins, then the
 * plugin-level override, then the installed default. Split out of
 * `resolvePluginEnabled` so the entry point stays within the complexity
 * budget; the nested optional reads live here.
 */
function resolveQualifiedEnabled(
  plugin: string,
  ext: string,
  cfg: Pick<IEffectiveConfig, 'plugins'>,
  installedDefault: boolean,
): boolean {
  const pluginEntry = cfg.plugins[plugin];
  const perExt = pluginEntry?.extensions?.[ext]?.enabled;
  if (perExt !== undefined) return perExt;
  if (pluginEntry?.enabled !== undefined) return pluginEntry.enabled;
  return installedDefault;
}

/**
 * Build a closure suitable for `IPluginLoaderOptions.resolveEnabled`.
 * Captures the layered settings once so the loader can ask per-plugin
 * without re-reading anything. Forwards the caller-supplied
 * `installedDefault` (per-extension experimental gate) straight through
 * to `resolvePluginEnabled`.
 */
export function makeEnabledResolver(
  cfg: Pick<IEffectiveConfig, 'plugins'>,
  lockedIds: TLockedIds = NO_LOCKS,
): EnabledResolver {
  return (pluginId, installedDefault) =>
    resolvePluginEnabled(pluginId, cfg, installedDefault, lockedIds);
}

/**
 * Build the loader's import-trust gate (security boundary): may a
 * project-local disk plugin's code be imported AT ALL?
 *
 * A plugin is trusted when the per-machine `config_plugins` trust store
 * carries a `trusted = true` row for its bare id (written by
 * `sm plugins trust <id>`, or `sm plugins trust --all` for every
 * discovered drop-in at once). The store is LOCAL: the DB never travels
 * in a commit and is not a config layer, so a cloned repo's committed
 * `settings.json` can never auto-execute its own plugins on the victim's
 * first scan.
 *
 * `trustMap` is keyed by BARE plugin id (trust is per-plugin); the loader
 * calls `resolveImportTrust(pluginId)` with a bare id, so shapes match.
 *
 * Locked host extensions (built-ins) are always trusted, they never
 * reach the disk loader, but the arm keeps the gate total. Membership
 * is the same manifest-derived set the enable arm consumes.
 */
export function makeTrustResolver(
  trustMap: Map<string, boolean>,
  lockedIds: TLockedIds = NO_LOCKS,
): (pluginId: string) => boolean {
  return (pluginId) => lockedIds.has(pluginId) || trustMap.get(pluginId) === true;
}
