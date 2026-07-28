/**
 * `localStorage` helpers for the map scope overrides. Same shape family
 * as `files-view.storage.ts`: a `sm.<surface>.<facet>` plain string key
 * and a defensive read so a corrupted entry resets to the default
 * (empty map == "show all") rather than crashing.
 *
 * Semantics: the persisted value is the OVERRIDE map of
 * `spec/cli-contract.md` §Map scope overrides, written as an ARRAY of
 * `[path, 'include' | 'exclude']` pairs with the root as the `''` key.
 * The array shape is load-bearing: the map's insertion order is the
 * selection seniority that drives the render-cap fill, and a plain
 * object cannot guarantee it (JS reorders integer-like keys, e.g. a
 * top-level folder named `2024`). An empty map is the default (fully
 * visible corpus), so a fresh project, a cleared curation, and a
 * corrupted entry all collapse to the same harmless state.
 *
 * Migrations, both one-shot reads with the old shape dying on the next
 * write: the pre-seniority OBJECT shape (`{ [path]: state }`, same key)
 * is accepted with best-effort order, and the pre-deviation-model key
 * (`sm.map.visible-paths`, a JSON array acting as an inclusion
 * whitelist) is read when the new key is absent and converted to the
 * equivalent override map (root excluded + one include per path); the
 * legacy key is removed on every write so it never resurrects a stale
 * selection.
 */

import type { TVisibilityOverride } from './map-overrides';

const OVERRIDES_STORAGE_KEY = 'sm.map.overrides';
const LEGACY_VISIBLE_PATHS_KEY = 'sm.map.visible-paths';

export function readStoredOverrides(): Map<string, TVisibilityOverride> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(OVERRIDES_STORAGE_KEY);
  } catch {
    return new Map();
  }
  if (!raw) return readLegacyWhitelist();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new Map();
  }
  if (typeof parsed !== 'object' || parsed === null) return new Map();
  const out = new Map<string, TVisibilityOverride>();
  if (Array.isArray(parsed)) {
    // Current shape: array of [path, state] pairs, order = seniority.
    for (const entry of parsed) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const [key, value] = entry as [unknown, unknown];
      if (typeof key !== 'string') continue;
      if (value === 'include' || value === 'exclude') out.set(key, value);
    }
    return out;
  }
  // Legacy object shape: best-effort order (JS reorders integer-like
  // keys); rewritten as the array shape on the next write.
  for (const [key, value] of Object.entries(parsed)) {
    if (value === 'include' || value === 'exclude') out.set(key, value);
  }
  return out;
}

/**
 * One-shot migration of the legacy inclusion whitelist: `[a, b]` meant
 * "show ONLY a and b", which in override terms is root-exclude plus one
 * include per path. An empty / absent / corrupt legacy entry is the
 * default state.
 */
function readLegacyWhitelist(): Map<string, TVisibilityOverride> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(LEGACY_VISIBLE_PATHS_KEY);
  } catch {
    return new Map();
  }
  if (!raw) return new Map();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new Map();
  }
  if (!Array.isArray(parsed)) return new Map();
  const out = new Map<string, TVisibilityOverride>();
  for (const path of parsed) {
    if (typeof path === 'string' && path.length > 0) out.set(path, 'include');
  }
  if (out.size > 0) out.set('', 'exclude');
  return out;
}

export function writeStoredOverrides(
  overrides: ReadonlyMap<string, TVisibilityOverride>,
): void {
  try {
    // The legacy key dies on every write path so it can never come back
    // as a stale selection after the migration ran.
    localStorage.removeItem(LEGACY_VISIBLE_PATHS_KEY);
    if (overrides.size === 0) {
      localStorage.removeItem(OVERRIDES_STORAGE_KEY);
      return;
    }
    localStorage.setItem(OVERRIDES_STORAGE_KEY, JSON.stringify([...overrides]));
  } catch {
    // Quota exceeded or storage blocked, ignore.
  }
}
