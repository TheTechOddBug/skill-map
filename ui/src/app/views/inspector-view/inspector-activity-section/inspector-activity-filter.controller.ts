/**
 * Persisted provenance filter for the inspector's Activity timeline
 * (user decision 2026-07-17): the merged timeline interleaves the
 * ephemeral runtime executions and skill-map's own AI-run history, and
 * a three-state control (all / runtime / AI runs) narrows what shows.
 *
 * The choice is an INSPECTOR-level view preference, not per-node state:
 * it persists in `localStorage` (sibling key of the section-collapse
 * map) and applies to every node the inspector visits. Mirrors the
 * `inspector-section-collapse.controller` pattern: a `setupX` factory
 * returns a typed handle the component holds, with an `effect` that
 * writes every change back to storage.
 */

import { assertInInjectionContext, effect, signal } from '@angular/core';

export type TActivityProvenanceFilter = 'all' | 'runtime' | 'ai';

const STORAGE_KEY = 'skill-map.ui.inspector.activityFilter';
const DEFAULT_FILTER: TActivityProvenanceFilter = 'all';

export interface IActivityFilterHandle {
  /** The active provenance filter (default `all`). */
  filter(): TActivityProvenanceFilter;
  /** Set the filter and persist it. Unknown values fall back to `all`. */
  set(value: TActivityProvenanceFilter): void;
}

export function setupActivityFilter(): IActivityFilterHandle {
  // The persist effect below runs in the component's reactive context.
  assertInInjectionContext(setupActivityFilter);

  const state = signal<TActivityProvenanceFilter>(loadFilter());

  // Persist on every change. Runs once on init (writes the loaded value
  // straight back, a harmless no-op) and again after every set.
  effect(() => {
    saveFilter(state());
  });

  return {
    filter: () => state(),
    set: (value) => state.set(parseFilter(value)),
  };
}

/** Defensive parse: anything but a known filter id falls back to `all`. */
function parseFilter(raw: unknown): TActivityProvenanceFilter {
  return raw === 'all' || raw === 'runtime' || raw === 'ai' ? raw : DEFAULT_FILTER;
}

function loadFilter(): TActivityProvenanceFilter {
  try {
    return parseFilter(localStorage.getItem(STORAGE_KEY));
  } catch {
    // Storage unavailable; the in-session default is fine.
    return DEFAULT_FILTER;
  }
}

function saveFilter(value: TActivityProvenanceFilter): void {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Storage unavailable / over quota; the filter is non-critical.
  }
}
