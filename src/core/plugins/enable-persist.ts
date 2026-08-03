/**
 * Enable-toggle persistence with redundant-key pruning
 * (`spec/architecture.md` §Locality, "A toggle persists only what the
 * default does not already say").
 *
 * Every enable surface (the CLI's `sm plugins enable|disable`, the BFF's
 * three `PATCH /api/plugins...` shapes) used to write
 * `plugins.<p>.extensions.<e>.enabled` unconditionally. Flipping a
 * default-on extension off and back on therefore left `enabled: true`
 * behind: a line in the committed `settings.json` that states what the
 * manifest already says, and that silently PINS the extension against a
 * future change to its installed default. Multiply by a few sessions of
 * toggling and the config becomes a wall of no-ops (which is exactly how
 * the Settings-resolution viewer surfaced it).
 *
 * The rule implemented here is "is this key redundant?", NOT "does the
 * value equal the installed default". Those differ whenever the other
 * layer has an opinion: with `settings.json` carrying `false`, a
 * `--local` toggle back to `true` MUST persist, because dropping it
 * would resolve to `false` again. So redundancy is decided against the
 * state the id would resolve to WITHOUT the key:
 *
 *     other layer's per-extension value
 *       ?? merged plugin-level `plugins.<p>.enabled`
 *       ?? installed default (manifest `stability` / `defaultEnabled`)
 *
 * mirroring `kernel/config/plugin-resolver.ts:resolveQualifiedEnabled`,
 * whose merged view this reconstructs from the two layer files. Only two
 * layers can carry the key: `defaults.json` ships `plugins: {}` and the
 * `override` layer is caller-supplied per invocation (never on disk, so
 * nothing there could be pruned anyway).
 *
 * Two deliberate scope limits:
 *
 *   - **Unknown default ⇒ never prune.** A drop-in plugin discovered but
 *     not loaded exposes no `stability` / `defaultEnabled`, so its
 *     redundancy cannot be decided; those keys are written verbatim and
 *     left alone, the pre-pruning behaviour.
 *   - **Plugin-level `plugins.<p>.enabled` is never pruned.** No toggle
 *     surface writes it; it is an operator-authored default for a whole
 *     plugin, and dropping it would rewrite a decision this pass did not
 *     make.
 *
 * The sweep covers the WHOLE target layer, not just the keys being
 * toggled, so a config that accumulated redundant keys under the old
 * always-write behaviour cleans itself up on the next toggle. It stays
 * inside the layer the caller is writing (`--local` never rewrites the
 * committed `settings.json`).
 */

import {
  applyConfigLayerPatch,
  readConfigLayer,
  type IConfigLayerPatchEntry,
  type IWriteConfigValueOpts,
} from '../config/helper.js';
import { installedDefaultEnabled } from '../../kernel/config/plugin-resolver.js';
import type { TExtensionStability } from '../../kernel/extensions/index.js';
import type { IDiscoveredPlugin } from '../../kernel/types/plugin.js';
import { qualifiedExtensionId } from '../../kernel/registry.js';
import { toEnableConfigKey } from './pair-toggle.js';

/** One requested flip, keyed by qualified `<plugin>/<ext>` id. */
export interface IEnableToggleChange {
  key: string;
  enabled: boolean;
}

/**
 * Minimal manifest projection the installed-default map needs. Both
 * `IPairEdgeSource` (built-ins + discovered) and any hand-built row
 * satisfy it structurally.
 */
export interface IInstalledDefaultSource {
  key: string;
  stability?: TExtensionStability;
  defaultEnabled?: boolean;
}

export interface IPersistEnableTogglesResult {
  /** Dot keys written (or rewritten) in the target layer. */
  written: string[];
  /** Dot keys removed because they were redundant. */
  pruned: string[];
}

/**
 * Build the qualified-id → installed-default map from projected manifest
 * rows. An id absent from the map is "default unknown" and is never
 * pruned. Shares `installedDefaultEnabled` with the resolver, so the
 * ships-disabled policy stays in one place.
 */
export function buildInstalledDefaults(
  sources: readonly IInstalledDefaultSource[],
): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const source of sources) {
    out.set(source.key, installedDefaultEnabled(source.stability, source.defaultEnabled));
  }
  return out;
}

/**
 * Project the DECLARED-but-not-imported extensions of discovered plugins
 * (`IDiscoveredPlugin.unloadedExtensions`) onto default rows.
 *
 * Load-bearing for the disable → enable round trip: enable is a
 * pre-import gate, so the moment an extension is switched off its module
 * stops being imported and it leaves `plugin.extensions`. Reading the
 * default only from loaded extensions would therefore mean "unknown
 * default" for exactly the ids a re-enable is about, and the key that
 * turned redundant would survive. `stability` / `defaultEnabled` come
 * from `extension.json` on disk, which the loader reads WITHOUT
 * importing anything, so this adds no execution.
 *
 * Kept separate from `pairEdgeSourcesFromDiscovered`: the pair toggle
 * deliberately only sees loaded extensions, and widening that is a
 * different decision from this one.
 */
export function unloadedDefaultSources(
  plugins: readonly IDiscoveredPlugin[],
): IInstalledDefaultSource[] {
  const rows: IInstalledDefaultSource[] = [];
  for (const plugin of plugins) {
    for (const ext of plugin.unloadedExtensions ?? []) {
      const row: IInstalledDefaultSource = { key: qualifiedExtensionId(plugin.id, ext.id) };
      if (ext.stability !== undefined) row.stability = ext.stability;
      if (ext.defaultEnabled !== undefined) row.defaultEnabled = ext.defaultEnabled;
      rows.push(row);
    }
  }
  return rows;
}

/**
 * Persist a batch of enable flips into one layer, pruning every
 * redundant per-extension `enabled` in that layer along the way. One
 * read-modify-write over the file (see `applyConfigLayerPatch`), so a
 * `--all` cascade cannot leave a half-applied config behind.
 *
 * `changes` carries qualified `<plugin>/<ext>` ids (bare plugin ids are
 * expanded by the callers before they get here, same as the pair
 * toggle). Keys the batch does not name are swept too, but only ever
 * REMOVED, never flipped.
 */
export function persistEnableToggles(opts: {
  changes: readonly IEnableToggleChange[];
  installedDefaults: ReadonlyMap<string, boolean>;
  target: IWriteConfigValueOpts['target'];
  cwd: string;
}): IPersistEnableTogglesResult {
  const { changes, installedDefaults, target, cwd } = opts;
  const own = readConfigLayer(target, cwd);
  const other = readConfigLayer(target === 'project' ? 'project-local' : 'project', cwd);
  const local = target === 'project-local' ? own : other;
  const project = target === 'project-local' ? other : own;

  const requested = new Map<string, boolean>();
  for (const change of changes) requested.set(change.key, change.enabled);

  // Universe = the keys this batch flips + every per-extension `enabled`
  // the target layer already carries (the sweep).
  const universe = new Set<string>([...requested.keys(), ...persistedExtensionKeys(own)]);

  const plan = planPatch(universe, (id) =>
    decideKey({
      stored: readPerExtension(own, id),
      requested: requested.get(id),
      fallback: resolveWithoutOwnKey(id, { local, project, target, installedDefaults }),
    }),
  );

  if (plan.entries.length > 0) applyConfigLayerPatch(plan.entries, { target, cwd });
  return { written: plan.written, pruned: plan.pruned };
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

/**
 * Turn per-id decisions into the config patch plus the written / pruned
 * receipts the caller reports.
 */
function planPatch(
  ids: Iterable<string>,
  decide: (id: string) => boolean | 'prune' | 'noop',
): { entries: IConfigLayerPatchEntry[]; written: string[]; pruned: string[] } {
  const entries: IConfigLayerPatchEntry[] = [];
  const written: string[] = [];
  const pruned: string[] = [];
  for (const id of ids) {
    const decision = decide(id);
    if (decision === 'noop') continue;
    const dotKey = toEnableConfigKey(id);
    entries.push({ key: dotKey, value: decision === 'prune' ? undefined : decision });
    (decision === 'prune' ? pruned : written).push(dotKey);
  }
  return { entries, written, pruned };
}

/**
 * Decide what happens to one id's key in the target layer:
 *
 *   - `'noop'`, nothing to do (a swept key with no boolean stored, or
 *     the layer already holds the value that must stay);
 *   - `'prune'`, the key is redundant and a stored one must go;
 *   - `true` / `false`, the value to persist.
 *
 * `fallback` is what the id resolves to WITHOUT the target layer's key,
 * or `undefined` when the installed default is unknown (never prune).
 */
function decideKey(ctx: {
  stored: boolean | undefined;
  requested: boolean | undefined;
  fallback: boolean | undefined;
}): boolean | 'prune' | 'noop' {
  const desired = ctx.requested ?? ctx.stored;
  // A swept key with no stored boolean cannot be reasoned about.
  if (desired === undefined) return 'noop';
  if (ctx.fallback === desired) return ctx.stored === undefined ? 'noop' : 'prune';
  return ctx.stored === desired ? 'noop' : desired;
}

/**
 * What `id` resolves to once the target layer's own per-extension key is
 * gone: the other layer's per-extension value, else the merged
 * plugin-level value (`settings.local.json` over `settings.json`), else
 * the installed default. `undefined` when the default is unknown, which
 * the caller reads as "never prune".
 */
function resolveWithoutOwnKey(
  id: string,
  ctx: {
    local: Record<string, unknown>;
    project: Record<string, unknown>;
    target: IWriteConfigValueOpts['target'];
    installedDefaults: ReadonlyMap<string, boolean>;
  },
): boolean | undefined {
  const otherLayer = ctx.target === 'project-local' ? ctx.project : ctx.local;
  const fromOther = readPerExtension(otherLayer, id);
  if (fromOther !== undefined) return fromOther;

  const slash = id.indexOf('/');
  if (slash >= 0) {
    const pluginId = id.slice(0, slash);
    const pluginLevel =
      readPluginLevel(ctx.local, pluginId) ?? readPluginLevel(ctx.project, pluginId);
    if (pluginLevel !== undefined) return pluginLevel;
  }

  return ctx.installedDefaults.get(id);
}

/** Every `<plugin>/<ext>` id whose `enabled` this layer object stores. */
function persistedExtensionKeys(layer: Record<string, unknown>): string[] {
  const out: string[] = [];
  const plugins = asRecord(layer['plugins']);
  if (!plugins) return out;
  for (const [pluginId, entry] of Object.entries(plugins)) {
    const extensions = asRecord(asRecord(entry)?.['extensions']);
    if (!extensions) continue;
    for (const [extId, ext] of Object.entries(extensions)) {
      if (typeof asRecord(ext)?.['enabled'] === 'boolean') {
        out.push(qualifiedExtensionId(pluginId, extId));
      }
    }
  }
  return out;
}

/** `plugins.<p>.extensions.<e>.enabled` off a raw layer object. */
function readPerExtension(layer: Record<string, unknown>, id: string): boolean | undefined {
  const slash = id.indexOf('/');
  if (slash < 0) return undefined;
  const plugins = asRecord(layer['plugins']);
  const entry = asRecord(plugins?.[id.slice(0, slash)]);
  const ext = asRecord(asRecord(entry?.['extensions'])?.[id.slice(slash + 1)]);
  const value = ext?.['enabled'];
  return typeof value === 'boolean' ? value : undefined;
}

/** `plugins.<p>.enabled` off a raw layer object. */
function readPluginLevel(
  layer: Record<string, unknown>,
  pluginId: string,
): boolean | undefined {
  const entry = asRecord(asRecord(layer['plugins'])?.[pluginId]);
  const value = entry?.['enabled'];
  return typeof value === 'boolean' ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}
