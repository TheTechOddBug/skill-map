/**
 * Pure helpers for the map scope overrides (`spec/cli-contract.md`
 * §Map scope overrides): the deviation model behind the rail
 * checkboxes. State is a `Map<path, 'include' | 'exclude'>` where the
 * ROOT is the key `''`; a node's effective state is the override of its
 * NEAREST ancestor (self included, longest matching key wins), and no
 * matching override means INCLUDED (the default is a fully visible
 * corpus). Shared by `MapVisibilityService`, the collection loader's
 * wire compilation, the demo data source's client-side mirror of the
 * server evaluation, and their specs.
 */

export type TVisibilityOverride = 'include' | 'exclude';

export type TOverrideMap = ReadonlyMap<string, TVisibilityOverride>;

/** Does override path `key` cover `path` (self or descendant)? Root covers all. */
function covers(key: string, path: string): boolean {
  return key === '' || path === key || path.startsWith(`${key}/`);
}

/**
 * Effective state of `path` under `overrides`: nearest-ancestor-wins
 * (matching keys are mutually prefix-ordered, so longest = nearest).
 * No matching override = `'include'`.
 */
export function effectiveState(overrides: TOverrideMap, path: string): TVisibilityOverride {
  let bestLen = -1;
  let best: TVisibilityOverride = 'include';
  for (const [key, kind] of overrides) {
    if (covers(key, path) && key.length > bestLen) {
      bestLen = key.length;
      best = kind;
    }
  }
  return best;
}

/**
 * The override of the nearest STRICT ancestor of `path` (what the row
 * would inherit if its own subtree carried no overrides). Root default
 * = `'include'`.
 */
export function inheritedState(overrides: TOverrideMap, path: string): TVisibilityOverride {
  let bestLen = -1;
  let best: TVisibilityOverride = 'include';
  for (const [key, kind] of overrides) {
    if (key !== path && covers(key, path) && key.length > bestLen) {
      bestLen = key.length;
      best = kind;
    }
  }
  return best;
}

/**
 * Pure form of the toggle primitive: force `path`'s whole subtree to
 * `desired`, keeping the map CANONICAL (minimal, every checkbox
 * truthful):
 *   1. Drop every override at or under `path` (for the root that is the
 *      whole map).
 *   2. Write `path -> desired` only when it differs from what the row
 *      would now inherit; toggling a row back to its inherited state
 *      deletes rather than writes.
 */
export function applySetSubtree(
  overrides: TOverrideMap,
  path: string,
  desired: TVisibilityOverride,
): TOverrideMap {
  const next = new Map<string, TVisibilityOverride>();
  for (const [key, kind] of overrides) {
    if (!covers(path, key)) next.set(key, kind);
  }
  if (inheritedState(next, path) !== desired) next.set(path, desired);
  return next;
}

/** Wire projection of an override map (`/api/branch` params). */
export interface IOverrideWire {
  include: string[];
  exclude: string[];
  excludeRoot: boolean;
}

/**
 * Split an override map into the wire lists. The root key rides the
 * `excludeRoot` boolean (a root INCLUDE override never exists in a
 * canonical map, `applySetSubtree` deletes it as redundant, but a
 * defensive one is dropped here the same way). Lists are sorted for a
 * stable request identity.
 */
export function compileOverridesToWire(overrides: TOverrideMap): IOverrideWire {
  const include: string[] = [];
  const exclude: string[] = [];
  let excludeRoot = false;
  for (const [key, kind] of overrides) {
    if (key === '') {
      excludeRoot = kind === 'exclude';
      continue;
    }
    (kind === 'include' ? include : exclude).push(key);
  }
  include.sort();
  exclude.sort();
  return { include, exclude, excludeRoot };
}

/**
 * Canonical serialization for change detection (the loader's fetch
 * dedupe key). Order-independent: entries sorted by path.
 */
export function overridesKey(overrides: TOverrideMap): string {
  return [...overrides.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, kind]) => `${kind}:${key}`)
    .join('\n');
}

/** Value equality for two override maps. */
export function overrideMapsEqual(a: TOverrideMap, b: TOverrideMap): boolean {
  if (a.size !== b.size) return false;
  for (const [key, kind] of a) if (b.get(key) !== kind) return false;
  return true;
}
