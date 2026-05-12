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
 * Cross-root id-collision pass. Group survivors (plugins whose individual
 * load reached a status that exposes a *trusted* `manifest.id`) by id, and
 * for any group of size ≥ 2 rewrite every member's status to
 * `id-collision` with a reason naming the other path(s).
 *
 * "Trusted id" means the manifest parsed and validated. The eligible
 * statuses are therefore `enabled`, `disabled`, and `incompatible-spec`
 * (each of those keeps `manifest` populated). The remaining failure
 * modes — `invalid-manifest` and `load-error` — either never reached the
 * id-trust point (`invalid-manifest`) or carry a manifest that's still
 * structurally fine; we treat them inclusively. Pragmatically, the only
 * status whose `id` is a path fall-back is `invalid-manifest` from a
 * manifest that failed to parse — and those are excluded because the
 * fall-back id is the directory name, which by the same-root pigeonhole
 * cannot collide with another fall-back id (and a collision against a
 * real id would be misleading noise: "rename your plugin to fix your
 * neighbour's broken JSON" is bad guidance).
 *
 * Concretely we only consider plugins that have a `manifest` populated.
 */
// eslint-disable-next-line complexity
export function applyIdCollisions(plugins: IDiscoveredPlugin[]): IDiscoveredPlugin[] {
  const buckets = new Map<string, IDiscoveredPlugin[]>();
  for (const p of plugins) {
    if (!p.manifest) continue; // skip path-fall-back ids (untrusted)
    const id = p.manifest.id;
    const bucket = buckets.get(id);
    if (bucket) bucket.push(p);
    else buckets.set(id, [p]);
  }

  const collidingPaths = new Set<string>();
  const collisionReason = new Map<string, string>();
  for (const [id, bucket] of buckets) {
    if (bucket.length < 2) continue;
    // Stable order so the rendered "collides with" list is deterministic
    // across runs — essential for snapshot tests and CI output diffs.
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
    // A colliding plugin's extensions are inert — strip them so a
    // careless caller cannot register them anyway. Manifest is kept
    // for diagnostics (`sm plugins list/show` shows version, author).
    delete next.extensions;
    return next;
  });
}
