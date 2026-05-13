/**
 * Bundle-row collapse state for the Plugins section of the Settings
 * modal.
 *
 * Owns the set of bundle ids the user has explicitly collapsed, plus
 * the localStorage mirror so the layout persists across sessions.
 * Granularity=extension bundles render a chevron and default to
 * expanded; collapsing flips a row into the set, expanding removes
 * it. Bundle-granularity rows never render a chevron and never enter
 * the set.
 *
 * Mirrors the `plugin-state.controller` / `plugin-filter.controller`
 * pattern: a `setupX` factory returns a typed handle the component
 * holds.
 */

import { assertInInjectionContext, effect, signal, type Signal } from '@angular/core';

import {
  readStoredCollapsed,
  writeStoredCollapsed,
} from './settings-plugins.storage';

export interface IPluginCollapseHandle {
  /**
   * Bundle ids currently in the collapsed set. Exposed read-only so the
   * template can branch on it (`@if (collapsed().has(id))`); the
   * imperative entry points below own mutation.
   */
  readonly collapsed: Signal<ReadonlySet<string>>;
  toggleExpanded(id: string): void;
  isExpanded(id: string): boolean;
}

export function setupPluginCollapse(): IPluginCollapseHandle {
  // The persistence effect below subscribes to the collapsed signal,
  // so the helper must run in an Angular injection context.
  assertInInjectionContext(setupPluginCollapse);

  const collapsed = signal<Set<string>>(readStoredCollapsed());

  // Mirror the set into localStorage. The kind-filter mirror lives in
  // the filter controller; `searchText` is intentionally not persisted
  // (a sticky query surprises the user on reopen).
  effect(() => writeStoredCollapsed(collapsed()));

  const toggleExpanded = (id: string): void => {
    const next = new Set(collapsed());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    collapsed.set(next);
  };

  /**
   * Whether the bundle row is currently expanded. `collapsed` is the
   * only state input: rows the user explicitly collapsed via the
   * chevron live there (persisted to localStorage); every other row
   * defaults to expanded.
   *
   * Earlier versions also consulted a `forcedExpand` set that
   * auto-expanded bundles with filter matches. That broke the
   * chevron, once a filter was active, clicking the chevron added the
   * row to `collapsed` but `forcedExpand` overrode the verdict here,
   * so the row stayed expanded and the click felt unresponsive. User
   * choice has to win for the chevron icon to match reality.
   * Trade-off: a filter no longer auto-expands a previously-collapsed
   * bundle to surface matches, the user clicks the chevron to see
   * them. Acceptable because the chevron now actually works.
   */
  const isExpanded = (id: string): boolean => !collapsed().has(id);

  return {
    collapsed: collapsed.asReadonly(),
    toggleExpanded,
    isExpanded,
  };
}
