/**
 * `localStorage` helpers for `FilterStoreService`. Same shape as the
 * per-view `*.storage.ts` modules (`graph-view.storage.ts`,
 * `workspace-view.storage.ts`): reads defend against missing / blocked
 * storage, writes swallow quota errors.
 */

const SEARCH_AFFECTS_MAP_KEY = 'sm.workspace.search-affects-map';

/**
 * Search -> map coupling preference, read once at store construction.
 * Default OFF: searching narrows ONLY the files rail, leaving the map's
 * full layout intact, so a query reshapes the tree without disturbing
 * the canvas. `'1'` opts into the coupled mode where the search also
 * filters the map (set via the rail's map-icon toggle); an absent key
 * means the operator never chose, so the default applies.
 */
export function readStoredSearchAffectsMap(): boolean {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SEARCH_AFFECTS_MAP_KEY);
  } catch {
    return false;
  }
  if (raw === null) return false;
  return raw === '1';
}

export function writeStoredSearchAffectsMap(value: boolean): void {
  try {
    localStorage.setItem(SEARCH_AFFECTS_MAP_KEY, value ? '1' : '0');
  } catch {
    // Quota exceeded or storage blocked, the preference just won't persist.
  }
}
