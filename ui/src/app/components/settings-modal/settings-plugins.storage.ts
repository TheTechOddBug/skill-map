/**
 * `localStorage` helpers for `<sm-settings-plugins>`. Same shape as
 * the `sm.graph.*` keys in `graph-view.ts` — `sm.<surface>.<facet>`
 * plain strings, JSON-encoded values, every read defends against
 * malformed payloads so a corrupted entry just resets to the default
 * rather than crashing the section.
 *
 * We intentionally do NOT persist `searchText`: a sticky search query
 * would surprise the user on reopen ("why is the list filtered?"),
 * and the BFF already paints the full list within the same modal
 * session.
 */

import { KIND_FILTER_OPTIONS, type TKindFilter } from './settings-plugins.utils';

const COLLAPSED_STORAGE_KEY = 'sm.settings.plugins.collapsed';
const KIND_FILTER_STORAGE_KEY = 'sm.settings.plugins.kind-filter';

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
  for (const id of parsed) {
    if (typeof id === 'string' && id.length > 0) out.add(id);
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
    // Quota exceeded or storage blocked — ignore.
  }
}

export function readStoredKindFilter(): TKindFilter {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KIND_FILTER_STORAGE_KEY);
  } catch {
    return 'all';
  }
  if (!raw) return 'all';
  // Validate against the closed set so a stale entry from a prior
  // schema (e.g. a kind that was renamed) falls back to the safe
  // default rather than rendering as a phantom segment.
  return KIND_FILTER_OPTIONS.includes(raw as TKindFilter)
    ? (raw as TKindFilter)
    : 'all';
}

export function writeStoredKindFilter(kind: TKindFilter): void {
  try {
    if (kind === 'all') {
      localStorage.removeItem(KIND_FILTER_STORAGE_KEY);
      return;
    }
    localStorage.setItem(KIND_FILTER_STORAGE_KEY, kind);
  } catch {
    // Quota exceeded or storage blocked — ignore.
  }
}
