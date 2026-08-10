/**
 * Pure helpers for the map-views feature (`spec/map-views.md`): slug
 * derivation, dead-reference counting, and pin-set equality. No Angular
 * imports; shared by `MapViewsService`, the switcher component, and
 * their specs.
 */

import type { IMapViewApi, IMapViewPointApi } from '../models/api';

/** Slug rule of `map-view.schema.json` `$defs.Slug`: 1-64 chars. */
export const MAP_VIEW_SLUG_MAX_LENGTH = 64;

/**
 * Derive the filename slug from a display name, once, at creation
 * (`spec/map-views.md` §File location and identity: renaming never
 * re-derives). Lowercases, strips diacritics (NFKD + combining-mark
 * removal), collapses every non-alphanumeric run into a single hyphen,
 * trims leading / trailing hyphens, and clamps to 64 chars (re-trimming
 * a hyphen the clamp may expose). Returns `''` when nothing survives;
 * callers treat that as "not a saveable name".
 */
export function slugify(name: string): string {
  const stripped = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const collapsed = stripped.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const trimmed = collapsed.replace(/^-+/, '').replace(/-+$/, '');
  return trimmed.slice(0, MAP_VIEW_SLUG_MAX_LENGTH).replace(/-+$/, '');
}

/** True when at least one path in `validPaths` is a descendant of `prefix`. */
function hasDescendant(validPaths: ReadonlySet<string>, prefix: string): boolean {
  const needle = `${prefix}/`;
  for (const p of validPaths) if (p.startsWith(needle)) return true;
  return false;
}

/**
 * A view reference is LIVE when it is itself a scanned node path or a
 * folder prefix with at least one scanned descendant (same idiom as
 * `MapVisibilityService.prune`; folder prefixes are never node paths
 * themselves).
 */
function isLiveRef(path: string, validPaths: ReadonlySet<string>): boolean {
  return validPaths.has(path) || hasDescendant(validPaths, path);
}

/**
 * Count the DEAD references of a view against the current corpus:
 * override keys (the root `''` always resolves, so it never counts),
 * pin keys, and group members that no longer resolve to a scanned node
 * or a folder prefix with a surviving descendant. Dead references are
 * legal (`spec/map-views.md` §Apply semantics): apply ignores them and
 * the UI surfaces this count, never rewrites the file.
 */
export function brokenRefCount(
  view: IMapViewApi,
  validPaths: ReadonlySet<string>,
): number {
  let count = 0;
  for (const [key] of view.overrides) {
    if (key === '') continue;
    if (!isLiveRef(key, validPaths)) count++;
  }
  for (const key of Object.keys(view.pins)) {
    if (!isLiveRef(key, validPaths)) count++;
  }
  for (const group of view.groups ?? []) {
    for (const member of group.members) {
      if (!isLiveRef(member, validPaths)) count++;
    }
  }
  return count;
}

/**
 * Value equality for two pin sets (`{ [nodePath]: {x, y} }`). Key order
 * is irrelevant here: the canonical byte-sorted serialization is the
 * SERVER's writer concern, the client only needs "same pins, same
 * coordinates" for the dirty computation.
 */
export function pinsEqual(
  a: Readonly<Record<string, IMapViewPointApi>>,
  b: Readonly<Record<string, IMapViewPointApi>>,
): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  for (const key of aKeys) {
    const other = b[key];
    if (other === undefined) return false;
    const own = a[key];
    if (own === undefined || own.x !== other.x || own.y !== other.y) return false;
  }
  return true;
}
