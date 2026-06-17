/**
 * Persisted, per-section collapse state for the inspector.
 *
 * Replaces the earlier reset-on-navigation model: every inspector
 * section (Definition, Actions, Annotations, Connections, Findings,
 * Metadata, Plugins, View contributions, Body) can be collapsed/expanded,
 * and the state is remembered in `localStorage` (global, not per-node)
 * so it survives navigation between nodes and full reloads. Sections the
 * user has never touched fall back to `SECTION_DEFAULT_EXPANDED`: a fresh
 * inspector (empty `localStorage`) opens every section collapsed EXCEPT
 * the body, which starts expanded so the file content is visible without
 * a click. Once the user toggles a section, the explicit choice is
 * persisted and wins over the default.
 *
 * Mirrors the `inspector-bump-controller` / `inspector-body-state`
 * pattern: a `setupX` factory returns a typed handle the component holds.
 */

import { assertInInjectionContext, effect, signal } from '@angular/core';

export type TInspectorSectionId =
  | 'definition'
  | 'actions'
  | 'annotations'
  | 'connections'
  | 'findings'
  | 'metadata'
  | 'plugins'
  | 'body';

const STORAGE_KEY = 'skill-map.ui.inspector.sections';

/**
 * Default expanded state for a section the user has never toggled.
 * Everything collapses by default except:
 *   - `body`: so the markdown content shows immediately on selecting a node.
 *   - `findings`: so issues are visible without a click WHEN they exist
 *     (the section only renders when `issues.length > 0`, so this default
 *     never opens an empty section).
 *   - `actions`: so the action buttons stay reachable without a click,
 *     matching the always-visible toolbar it replaced (the section only
 *     renders when the node has `inspector.action.button` contributions,
 *     so this default never opens an empty section).
 *   - `connections`: so a node's incoming / outgoing links are visible
 *     immediately, the primary thing an operator inspects on a node.
 * Any id not listed here falls back to `false` (collapsed) via
 * `defaultExpanded`. Once the user toggles a section, the persisted
 * choice wins over these defaults.
 */
const SECTION_DEFAULT_EXPANDED: Partial<Record<TInspectorSectionId, boolean>> = {
  body: true,
  findings: true,
  actions: true,
  connections: true,
};

function defaultExpanded(id: TInspectorSectionId): boolean {
  return SECTION_DEFAULT_EXPANDED[id] ?? false;
}

export interface ISectionCollapseHandle {
  /** True when the section is expanded. Unseen sections default to collapsed. */
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
    expanded: (id) => state()[id] ?? defaultExpanded(id),
    toggle: (id) =>
      state.update((s) => ({ ...s, [id]: !(s[id] ?? defaultExpanded(id)) })),
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
    // Corrupt JSON or storage unavailable; fall back to all-collapsed.
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
