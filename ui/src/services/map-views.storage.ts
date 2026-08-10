/**
 * `localStorage` helper for the active map-view selection. Which view
 * is active is PER-DEVELOPER local state and never travels
 * (`spec/map-views.md` §Apply semantics), so it lives next to the other
 * `sm.map.*` keys rather than in the committed view files.
 *
 * Defensive read (same posture as `map-visibility.storage.ts`): a
 * missing, blocked, or corrupted entry reads as `null` (no active
 * view), and a value that does not match the Slug rule of
 * `map-view.schema.json` is treated as corrupt rather than trusted.
 */

const ACTIVE_VIEW_STORAGE_KEY = 'sm.map.active-view';

/** Slug rule of `map-view.schema.json` `$defs.Slug`. */
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export function readStoredActiveView(): string | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(ACTIVE_VIEW_STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  return SLUG_RE.test(raw) ? raw : null;
}

export function writeStoredActiveView(slug: string | null): void {
  try {
    if (slug === null) {
      localStorage.removeItem(ACTIVE_VIEW_STORAGE_KEY);
      return;
    }
    localStorage.setItem(ACTIVE_VIEW_STORAGE_KEY, slug);
  } catch {
    // Quota exceeded or storage blocked, ignore.
  }
}
