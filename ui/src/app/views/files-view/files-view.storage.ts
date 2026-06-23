/**
 * `localStorage` helpers for `<sm-files-view>`. Same shape as
 * `settings-plugins.storage.ts`: `sm.<surface>.<facet>` plain string
 * key, JSON-encoded payload, every read defends against malformed
 * input so a corrupted entry resets to the default rather than
 * crashing the view.
 *
 * Semantics: the persisted set lists folders the user has explicitly
 * EXPANDED. Default state is "all collapsed", so the tree opens light
 * (only top-level folders visible) and the user expands what they need;
 * folders that appear after a future scan also render collapsed out of
 * the box (they are not in the expanded set yet). A dedicated key
 * (`sm.folders.expanded`, distinct from the retired
 * `sm.folders.collapsed`) avoids reading a stale collapsed-set under the
 * inverted meaning.
 */

const EXPANDED_STORAGE_KEY = 'sm.folders.expanded';

export function readStoredExpanded(): Set<string> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(EXPANDED_STORAGE_KEY);
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

export function writeStoredExpanded(set: ReadonlySet<string>): void {
  try {
    if (set.size === 0) {
      localStorage.removeItem(EXPANDED_STORAGE_KEY);
      return;
    }
    localStorage.setItem(EXPANDED_STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    // Quota exceeded or storage blocked, ignore.
  }
}
