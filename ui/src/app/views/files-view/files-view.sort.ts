/**
 * Sort state + `localStorage` persistence for `<sm-files-view>`.
 *
 * Mirrors `files-view.storage.ts` (defensive parse, `removeItem` on the
 * default) and the closed-catalog / type-guard style of
 * `services/graph-preferences.ts`. The two fields travel together so
 * the payload is a JSON object, not a bare string; a malformed or
 * legacy blob resets to `DEFAULT_SORT` rather than crashing the view.
 *
 * Semantics:
 *   - `column: 'tree'` is the default and renders the folder tree.
 *   - any other column flattens the table into a sorted file listing.
 */

const SORT_STORAGE_KEY = 'sm.files.sort';

/** The structural `tree` column plus the sortable data columns. */
export const SORT_COLUMNS = ['tree', 'linksIn', 'linksOut', 'tokens', 'issues', 'modified'] as const;
export type TSortColumn = (typeof SORT_COLUMNS)[number];

export const SORT_DIRS = ['asc', 'desc'] as const;
export type TSortDir = (typeof SORT_DIRS)[number];

export interface IFilesSort {
  readonly column: TSortColumn;
  readonly dir: TSortDir;
}

/** Tree, ascending, the folder-structure view the page boots into. */
export const DEFAULT_SORT: IFilesSort = { column: 'tree', dir: 'asc' };

/**
 * Direction applied the FIRST time a column is activated. The tree
 * only has one meaningful order (alphabetical), so it is `asc`; the
 * numeric / severity columns open `desc` because clicking a magnitude
 * header reads as "show me the biggest / most-problematic first".
 */
export function defaultDirFor(column: TSortColumn): TSortDir {
  return column === 'tree' ? 'asc' : 'desc';
}

/**
 * State transition for a column-header click. The `tree` column resets
 * to the folder view; clicking the already-active column flips the
 * direction; clicking a fresh column activates it with its default
 * direction (`defaultDirFor`). Pure so the toggle logic is testable
 * without a component harness; the view method is a thin wrapper.
 */
export function nextSort(current: IFilesSort, column: TSortColumn): IFilesSort {
  if (column === 'tree') return DEFAULT_SORT;
  if (current.column === column) {
    return { column, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  }
  return { column, dir: defaultDirFor(column) };
}

function isSortColumn(value: unknown): value is TSortColumn {
  return typeof value === 'string' && (SORT_COLUMNS as readonly string[]).includes(value);
}

function isSortDir(value: unknown): value is TSortDir {
  return typeof value === 'string' && (SORT_DIRS as readonly string[]).includes(value);
}

export function isFilesSort(value: unknown): value is IFilesSort {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { column?: unknown; dir?: unknown };
  return isSortColumn(candidate.column) && isSortDir(candidate.dir);
}

export function readStoredSort(): IFilesSort {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SORT_STORAGE_KEY);
  } catch {
    return DEFAULT_SORT;
  }
  if (!raw) return DEFAULT_SORT;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_SORT;
  }
  if (!isFilesSort(parsed)) return DEFAULT_SORT;
  return { column: parsed.column, dir: parsed.dir };
}

export function writeStoredSort(sort: IFilesSort): void {
  try {
    if (sort.column === DEFAULT_SORT.column && sort.dir === DEFAULT_SORT.dir) {
      localStorage.removeItem(SORT_STORAGE_KEY);
      return;
    }
    localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify({ column: sort.column, dir: sort.dir }));
  } catch {
    // Quota exceeded or storage blocked, ignore.
  }
}
