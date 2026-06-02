/**
 * `localStorage` helpers for the map visibility curation set. Same shape
 * as `files-view.storage.ts`: a `sm.<surface>.<facet>` plain string key,
 * a JSON-encoded array of node paths, and a defensive read so a corrupted
 * entry resets to the default (empty == "show all") rather than crashing.
 *
 * Semantics: the persisted set is an INCLUSION whitelist of node paths the
 * user wants visible on the map. Empty set is the default and means "show
 * everything" (subject to facet filters), so a fresh project, a cleared
 * curation, and a corrupted entry all collapse to the same harmless state.
 */

const VISIBLE_PATHS_STORAGE_KEY = 'sm.map.visible-paths';

export function readStoredVisiblePaths(): Set<string> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(VISIBLE_PATHS_STORAGE_KEY);
  } catch {
    return new Set();
  }
  if (!raw) return new Set();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new Set();
  }
  if (!Array.isArray(parsed)) return new Set();
  const out = new Set<string>();
  for (const path of parsed) {
    if (typeof path === 'string' && path.length > 0) out.add(path);
  }
  return out;
}

export function writeStoredVisiblePaths(set: ReadonlySet<string>): void {
  try {
    if (set.size === 0) {
      localStorage.removeItem(VISIBLE_PATHS_STORAGE_KEY);
      return;
    }
    localStorage.setItem(VISIBLE_PATHS_STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    // Quota exceeded or storage blocked, ignore.
  }
}
