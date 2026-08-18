/**
 * `localStorage` helpers for `FilesFollowSelectionService`. Same shape as
 * the other preference stores (`filter-store.storage.ts`,
 * `workspace-view.storage.ts`): reads defend against missing / blocked
 * storage, writes swallow quota errors.
 */

const FILES_FOLLOW_SELECTION_KEY = 'sm.workspace.files-follow-selection';

/**
 * "Files follows the map selection" preference, read once at service
 * construction. Default ON (user decision 2026-08-18; it shipped OFF to
 * preserve the pre-feature behaviour, but following the selection is
 * the experience the operator actually wants out of the box): selecting
 * a node on the map reveals it in the tree (highlight + auto-expand +
 * scroll into view). `'0'` opts out via the rail's directions-icon
 * toggle; an absent key means the operator never chose, so the default
 * applies.
 */
export function readStoredFilesFollowSelection(): boolean {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(FILES_FOLLOW_SELECTION_KEY);
  } catch {
    return true;
  }
  return raw !== '0';
}

export function writeStoredFilesFollowSelection(value: boolean): void {
  try {
    localStorage.setItem(FILES_FOLLOW_SELECTION_KEY, value ? '1' : '0');
  } catch {
    // Quota exceeded or storage blocked, the preference just won't persist.
  }
}
