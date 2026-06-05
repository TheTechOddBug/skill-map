/**
 * Persisted, per-section collapse state for the inspector.
 *
 * Replaces the earlier reset-on-navigation model: every inspector
 * section (Definition, Annotations, Connections, Findings, Metadata,
 * Plugins, View contributions, Body) can be collapsed/expanded,
 * and the state is remembered in `localStorage` (global, not per-node)
 * so it survives navigation between nodes and full reloads. Sections the
 * user has never touched default to expanded.
 *
 * Mirrors the `inspector-bump-controller` / `inspector-body-state`
 * pattern: a `setupX` factory returns a typed handle the component holds.
 */

import { assertInInjectionContext, effect, signal } from '@angular/core';

export type TInspectorSectionId =
  | 'definition'
  | 'annotations'
  | 'connections'
  | 'findings'
  | 'metadata'
  | 'plugins'
  | 'viewContributions'
  | 'body';

const STORAGE_KEY = 'skill-map.ui.inspector.sections';

export interface ISectionCollapseHandle {
  /** True when the section is expanded (the default for unseen sections). */
  expanded(id: TInspectorSectionId): boolean;
  /** Flip a section's expanded state and persist the new map. */
  toggle(id: TInspectorSectionId): void;
}

export function setupSectionCollapse(): ISectionCollapseHandle {
  // The persist effect below runs in the component's reactive context.
  assertInInjectionContext(setupSectionCollapse);

  const state = signal<Record<string, boolean>>(loadState());

  // Persist on every change. Runs once on init (writes the loaded state
  // straight back, a harmless no-op) and again after every toggle.
  effect(() => {
    saveState(state());
  });

  return {
    expanded: (id) => state()[id] ?? true,
    toggle: (id) => state.update((s) => ({ ...s, [id]: !(s[id] ?? true) })),
  };
}

function loadState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'boolean') out[key] = value;
    }
    return out;
  } catch {
    // Corrupt JSON or storage unavailable; fall back to all-expanded.
    return {};
  }
}

function saveState(state: Record<string, boolean>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable / over quota; collapse state is non-critical.
  }
}
