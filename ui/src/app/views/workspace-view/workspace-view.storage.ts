/**
 * `localStorage` helpers for `<sm-workspace-view>` (the files-rail
 * chrome: drag-resized width + collapse preference). Same shape as
 * `graph-view.storage.ts` / `files-view.storage.ts`: every read defends
 * against missing or malformed storage, every write swallows quota
 * errors so a full disk never crashes the view.
 */

const RAIL_WIDTH_KEY = 'sm.workspace.rail-width';
const RAIL_COLLAPSED_KEY = 'sm.workspace.rail-collapsed';
const RAIL_SECTION_KEY = 'sm.workspace.rail-section';

/** Which panel the rail shows: the files navigator or the job queue. */
export type TWorkspaceSection = 'files' | 'queue';

export function readStoredRailWidth(): number | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(RAIL_WIDTH_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function writeStoredRailWidth(width: number): void {
  try {
    localStorage.setItem(RAIL_WIDTH_KEY, String(width));
  } catch {
    // Quota exceeded or storage blocked, the width just won't persist.
  }
}

/**
 * Files rail collapse preference. `'1'` collapsed, `'0'` open, absent
 * key (or blocked storage) is `null`: no saved choice, the caller falls
 * back to the collapsed default plus the corpus-size auto-open.
 */
export function readStoredRailCollapsed(): boolean | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(RAIL_COLLAPSED_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  return raw === '1';
}

export function writeStoredRailCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(RAIL_COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    // Quota exceeded or storage blocked, the preference just won't persist.
  }
}

/**
 * Which panel the rail shows (`'files'` navigator or `'queue'`
 * inspector). `null` when the user has never switched (or storage is
 * blocked / malformed): the caller falls back to the files default.
 */
export function readStoredActiveSection(): TWorkspaceSection | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(RAIL_SECTION_KEY);
  } catch {
    return null;
  }
  return raw === 'files' || raw === 'queue' ? raw : null;
}

export function writeStoredActiveSection(section: TWorkspaceSection): void {
  try {
    localStorage.setItem(RAIL_SECTION_KEY, section);
  } catch {
    // Quota exceeded or storage blocked, the preference just won't persist.
  }
}
