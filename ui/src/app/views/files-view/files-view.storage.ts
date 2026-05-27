/**
 * `localStorage` helpers for `<sm-files-view>`. Same shape as
 * `settings-plugins.storage.ts`: `sm.<surface>.<facet>` plain string
 * key, JSON-encoded payload, every read defends against malformed
 * input so a corrupted entry resets to the default rather than
 * crashing the view.
 *
 * Semantics: the persisted set lists folders the user has explicitly
 * COLLAPSED. Default state is "all expanded", which also means folders
 * that appear after a future scan render expanded out of the box (they
 * are not in the collapsed set yet).
 */

const COLLAPSED_STORAGE_KEY = 'sm.folders.collapsed';

export function readStoredCollapsed(): Set<string> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(COLLAPSED_STORAGE_KEY);
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

export function writeStoredCollapsed(set: ReadonlySet<string>): void {
  try {
    if (set.size === 0) {
      localStorage.removeItem(COLLAPSED_STORAGE_KEY);
      return;
    }
    localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    // Quota exceeded or storage blocked, ignore.
  }
}
