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
 *
 * The Map's INSERTION ORDER is load-bearing: it is the selection
 * seniority that drives the render-cap fill (spec §Map scope overrides
 * · Seniority fill). `compileOverridesToWire` emits includes in that
 * order, and the server fills the cap oldest-include-first, so a small
 * folder selected early keeps its nodes on the map when a later, larger
 * selection overflows the cap. The storage layer persists the order
 * (array-of-pairs shape) and every rebuild site preserves it.
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
 *
 * Seniority semantics fall out of the delete-then-append shape (user
 * decisions 2026-07-28): re-toggling a path is a NEW selection (the old
 * entry is dropped, the fresh one appends LAST, seniority lost), and
 * selecting a parent swallows its childrens' entries (rule 1), so the
 * whole subtree re-enters with the parent's newest seniority.
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
 * defensive one is dropped here the same way). INCLUDES keep the map's
 * insertion order, it is the selection seniority the server's cap fill
 * honours (spec §Map scope overrides · Seniority fill); excludes are
 * sorted (their order carries no meaning, sorting keeps the request
 * identity stable across re-toggles).
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
  exclude.sort();
  return { include, exclude, excludeRoot };
}

/**
 * Canonical serialization for change detection (the loader's fetch
 * dedupe key). Derived from the WIRE projection so the key equals the
 * request identity by construction: an include reorder (seniority
 * change) yields a new key and refetches, while an exclude re-toggle
 * (map order changed, wire identical) does not.
 */
export function overridesKey(overrides: TOverrideMap): string {
  // JSON keeps the key unambiguous whatever characters a path carries.
  return JSON.stringify(compileOverridesToWire(overrides));
}

/** Value equality for two override maps. */
export function overrideMapsEqual(a: TOverrideMap, b: TOverrideMap): boolean {
  if (a.size !== b.size) return false;
  for (const [key, kind] of a) if (b.get(key) !== kind) return false;
  return true;
}
