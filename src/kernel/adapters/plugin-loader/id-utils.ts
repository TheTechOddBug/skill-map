/**
 * Shared id / path / type-guard helpers used across the loader's
 * validation pipeline. Kept tiny and dependency-free so every sibling
 * module (`validation.ts`, `import-helpers.ts`, `storage-schemas.ts`,
 * `index.ts`) can import without dragging in unrelated state.
 */

import { isAbsolute, relative, resolve } from 'node:path';

import type { IDiscoveredPlugin, TPluginLoadStatus } from '../../types/plugin.js';
import { PLUGIN_LOADER_TEXTS } from '../../i18n/plugin-loader.texts.js';
import { tx } from '../../util/tx.js';

/**
 * Helper that builds the bare failure shape every error path returns.
 * Callers that have a parsed manifest layer it back on top via spread.
 */
export function fail(
  path: string,
  id: string,
  status: TPluginLoadStatus,
  reason: string,
): IDiscoveredPlugin {
  return { path, id, status, reason };
}

/**
 * Check that a manifest-declared relative path stays inside the plugin
 * tree once resolved. Rejects absolute paths and any value whose
 * resolved form lies above (or beside) the plugin root via `..`
 * components. Returns `null` when safe; otherwise the resolved
 * absolute path is returned for diagnostics.
 *
 * Closes the lane where one plugin directory references another
 * plugin's source (or arbitrary files on disk) by way of
 * `extensions: ["../foo/index.js"]` or `storage.schema:
 * "../bar.schema.json"`.
 */
export function isInsidePlugin(pluginPath: string, relEntry: string): boolean {
  if (isAbsolute(relEntry)) return false;
  const abs = resolve(pluginPath, relEntry);
  const rel = relative(pluginPath, abs);
  if (rel === '') return true;
  if (rel.startsWith('..')) return false;
  if (isAbsolute(rel)) return false;
  return true;
}

export function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return String(err);
  } catch {
    return 'unknown error';
  }
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Fall-back plugin id derived from directory name when the manifest is unreadable. */
export function pathId(p: string): string {
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] ?? p;
}

/**
 * The closed set of plugin ids the generated `src/plugins/built-ins.ts`
 * stamps onto its extensions. Frozen the same way
 * `kernel/scan/parsers/index.ts` freezes its built-in parser ids: a
 * hardcoded kernel-side list, because the loader must not import the
 * built-ins registry (that would pull every bundled extension module
 * into the discovery path, inverting the layering).
 *
 * Drift is caught at CI time by a guard test that compares this set
 * against the live `builtIns()` output, so adding a built-in plugin
 * without updating this list fails the suite instead of silently
 * reopening the shadowing lane below.
 *
 * NOTE: deliberately NOT shared with `cli/telemetry/usage-collector.ts`'s
 * same-named constant. That one is an allow-list governing what may
 * leave the machine; conflating the two would let a change made for
 * loader reasons widen a privacy surface.
 */
export const BUILT_IN_PLUGIN_IDS: ReadonlySet<string> = new Set([
  'agent-skills',
  'antigravity',
  'claude',
  'codex',
  'core',
  'github',
  'opencode',
  'test-plugin',
]);

/**
 * Built-in id shadowing pass. A drop-in plugin directory whose name
 * matches a built-in plugin id is blocked with status `id-collision`,
 * the same treatment (and the same spec-frozen status, see
 * `plugins-registry.schema.json`) two colliding drop-in directories
 * get.
 *
 * Why it matters: several kernel surfaces key by bare `pluginId` in a
 * FLAT namespace shared by built-ins and drop-ins, `ctx.store`
 * (`core/runtime/plugin-stores.ts`) being the sharpest example, yet
 * built-ins never appear in `IDiscoveredPlugin[]`, so
 * `applyIdCollisions` structurally cannot see them. A directory named
 * `core` would therefore own the `core` KV slot with no diagnostic at
 * all. No built-in uses `ctx.store` today, which is what keeps the
 * impact at zero and this at a latent confused-deputy rather than a
 * live bug; blocking it now means the first built-in that DOES adopt
 * KV storage inherits a closed door instead of an open one.
 *
 * Runs BEFORE `applyIdCollisions` so a shadowing plugin is already
 * stripped of its extensions when the cross-root pass groups by id.
 */
export function applyBuiltInIdShadowing(plugins: IDiscoveredPlugin[]): IDiscoveredPlugin[] {
  if (!plugins.some(isBuiltInShadow)) return plugins;
  return plugins.map((p) => {
    if (!isBuiltInShadow(p)) return p;
    const next: IDiscoveredPlugin = {
      ...p,
      status: 'id-collision',
      reason: tx(PLUGIN_LOADER_TEXTS.builtInIdShadowed, { id: p.id, path: p.path }),
    };
    // Same posture as the cross-root pass: a blocked plugin's
    // extensions are inert, strip them so a careless caller cannot
    // register them anyway. The manifest stays for diagnostics.
    delete next.extensions;
    return next;
  });
}

/**
 * A discovered plugin shadows a built-in when its manifest parsed (so
 * the directory-derived id is trusted) and that id is reserved.
 */
function isBuiltInShadow(plugin: IDiscoveredPlugin): boolean {
  return Boolean(plugin.manifest) && BUILT_IN_PLUGIN_IDS.has(plugin.id);
}

/**
 * Cross-root id-collision pass. Group survivors (plugins whose individual
 * load reached a status that exposes a trusted id) by id, and for any
 * group of size ≥ 2 rewrite every member's status to `id-collision` with
 * a reason naming the other path(s).
 *
 * Trusted id since the structure-as-truth refactor: the plugin id IS the
 * directory name (`pathId(pluginPath)`) computed at discovery; the manifest
 * no longer carries the field. We only consider plugins whose `manifest`
 * loaded successfully (`enabled`, `disabled`, `incompatible-spec`), so a
 * plugin that failed to parse its `plugin.json` is excluded from the
 * collision check, and a collision warning would be misleading there
 * ("rename your plugin to fix your neighbour's broken JSON" is bad
 * guidance).
 */
// eslint-disable-next-line complexity
export function applyIdCollisions(plugins: IDiscoveredPlugin[]): IDiscoveredPlugin[] {
  const buckets = new Map<string, IDiscoveredPlugin[]>();
  for (const p of plugins) {
    if (!p.manifest) continue; // skip path-fall-back ids (untrusted)
    const id = p.id;
    const bucket = buckets.get(id);
    if (bucket) bucket.push(p);
    else buckets.set(id, [p]);
  }

  const collidingPaths = new Set<string>();
  const collisionReason = new Map<string, string>();
  for (const [id, bucket] of buckets) {
    if (bucket.length < 2) continue;
    // Stable order so the rendered "collides with" list is deterministic
    // across runs, essential for snapshot tests and CI output diffs.
    const sorted = [...bucket].sort((a, b) => a.path.localeCompare(b.path));
    for (const member of sorted) {
      collidingPaths.add(member.path);
      const others = sorted.filter((p) => p.path !== member.path).map((p) => p.path);
      // Reason names the FIRST other path explicitly (matches the spec
      // suggestion) and lists the rest (if any) for the rare 3-way case.
      const pathB = others.length === 1 ? others[0]! : others.join(', ');
      collisionReason.set(
        member.path,
        tx(PLUGIN_LOADER_TEXTS.idCollision, { id, pathA: member.path, pathB }),
      );
    }
  }

  if (collidingPaths.size === 0) return plugins;

  return plugins.map((p) => {
    if (!collidingPaths.has(p.path)) return p;
    const next: IDiscoveredPlugin = {
      ...p,
      status: 'id-collision',
      reason: collisionReason.get(p.path) ?? p.reason ?? '',
    };
    // A colliding plugin's extensions are inert, strip them so a
    // careless caller cannot register them anyway. Manifest is kept
    // for diagnostics (`sm plugins list/show` shows version, author).
    delete next.extensions;
    return next;
  });
}
