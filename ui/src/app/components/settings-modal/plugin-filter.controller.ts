/**
 * Search + source/kind filter state machine for `<sm-settings-plugins>`.
 * Owns the writable `searchText`, `sourceFilter` and `kindFilter`
 * signals, the persistence effects that mirror the source / kind filters
 * into localStorage, and the `filteredPlugins` derivation pipeline (lock
 * strip → pin sort → source → kind → search). Extracted from the
 * component so the view file focuses on fetch + buffered-toggle concerns.
 *
 * Mirrors the `setupExpansion` pattern: a `setupX` factory invoked from
 * a component field initializer (which runs in injection context, so
 * the inner `effect()` resolves the active `Injector` without ceremony).
 */

import { computed, effect, signal, type Signal, type WritableSignal } from '@angular/core';

import type { IPluginItemApi } from '../../../models/api';
import {
  readStoredKindFilter,
  readStoredSourceFilter,
  writeStoredKindFilter,
  writeStoredSourceFilter,
} from './settings-plugins.storage';
import {
  KIND_FILTER_CHIPS,
  SOURCE_FILTER_CHIPS,
  filterByKind,
  filterBySearch,
  filterBySource,
  sortPluginsByPin,
  stripLocked,
  type TKindFilter,
  type TSourceChip,
  type TSourceFilter,
} from './settings-plugins.utils';

export interface IPluginFilterDeps {
  /** Raw plugin list (pre-strip-locked). The controller composes the
   *  full visible pipeline on top so the component does not need to
   *  re-derive `visiblePlugins` itself. */
  plugins: Signal<readonly IPluginItemApi[]>;
}

export interface IPluginFilterHandle {
  /** Writable so the template can do `[ngModel]="searchText()"` +
   *  `(ngModelChange)="searchText.set($event)"` exactly as before. */
  searchText: WritableSignal<string>;
  searchActive: Signal<boolean>;
  /** Writable to preserve the existing legacy test path
   *  (`(cmp as unknown).kindFilter.set('analyzer')`). Programmatic
   *  updates from the component go through `setKindFilter`. */
  kindFilter: WritableSignal<TKindFilter>;
  setKindFilter(kind: TKindFilter): void;
  /** Click handler for a kind chip: select it, or toggle it back to
   *  'all' when it is already the active kind. */
  toggleKindFilter(kind: TKindFilter): void;
  isKindFilterActive(kind: TKindFilter): boolean;
  kindFilterActive: Signal<boolean>;
  kindFilterChips: typeof KIND_FILTER_CHIPS;
  /** Writable for the same legacy-test reason as `kindFilter`. */
  sourceFilter: WritableSignal<TSourceFilter>;
  setSourceFilter(source: TSourceFilter): void;
  /** Click handler for a source chip: select it, or toggle it back to
   *  'all' when it is already active. Mutually exclusive between the two
   *  source chips, independent of the kind axis. */
  toggleSourceFilter(source: TSourceChip): void;
  isSourceFilterActive(source: TSourceFilter): boolean;
  sourceFilterActive: Signal<boolean>;
  sourceFilterChips: typeof SOURCE_FILTER_CHIPS;
  /** True when neither axis is filtering. Drives the shared "All" chip. */
  allFilterActive: Signal<boolean>;
  /** Clear both axes back to 'all' (the shared "All" reset). */
  resetFilters(): void;
  /** Plugins after stripping host-locked rows and applying the pin /
   *  kind ordering. The source / kind / search filters chain off this. */
  visiblePlugins: Signal<readonly IPluginItemApi[]>;
  filteredPlugins: Signal<readonly IPluginItemApi[]>;
}

export function setupPluginFilter(deps: IPluginFilterDeps): IPluginFilterHandle {
  const searchText = signal('');
  const searchActive = computed(() => searchText().trim().length > 0);

  const kindFilter = signal<TKindFilter>(readStoredKindFilter());
  const kindFilterActive = computed(() => kindFilter() !== 'all');

  const sourceFilter = signal<TSourceFilter>(readStoredSourceFilter());
  const sourceFilterActive = computed(() => sourceFilter() !== 'all');

  const allFilterActive = computed(
    () => kindFilter() === 'all' && sourceFilter() === 'all',
  );

  // Mirror the kind / source filters into localStorage. Fires on every
  // change, including programmatic ones, so the setters do not need to
  // remember to persist.
  effect(() => writeStoredKindFilter(kindFilter()));
  effect(() => writeStoredSourceFilter(sourceFilter()));

  const visiblePlugins = computed<readonly IPluginItemApi[]>(() =>
    sortPluginsByPin(deps.plugins().flatMap(stripLocked)),
  );

  const filteredPlugins = computed<readonly IPluginItemApi[]>(() => {
    const query = searchText().trim().toLowerCase();
    const source = sourceFilter();
    const kind = kindFilter();
    let list: readonly IPluginItemApi[] = visiblePlugins();
    // Source is the coarse axis (plugin-level), narrow it first.
    if (source !== 'all') {
      list = list.flatMap((plugin) => filterBySource(plugin, source));
    }
    if (kind !== 'all') {
      list = list.flatMap((plugin) => filterByKind(plugin, kind));
    }
    if (query.length > 0) {
      list = list.flatMap((plugin) => filterBySearch(plugin, query));
    }
    return list;
  });

  const setKindFilter = (kind: TKindFilter): void => {
    kindFilter.set(kind);
  };

  const toggleKindFilter = (kind: TKindFilter): void => {
    kindFilter.set(kindFilter() === kind ? 'all' : kind);
  };

  const isKindFilterActive = (kind: TKindFilter): boolean => kindFilter() === kind;

  const setSourceFilter = (source: TSourceFilter): void => {
    sourceFilter.set(source);
  };

  const toggleSourceFilter = (source: TSourceChip): void => {
    sourceFilter.set(sourceFilter() === source ? 'all' : source);
  };

  const isSourceFilterActive = (source: TSourceFilter): boolean =>
    sourceFilter() === source;

  const resetFilters = (): void => {
    kindFilter.set('all');
    sourceFilter.set('all');
  };

  return {
    searchText,
    searchActive,
    kindFilter,
    setKindFilter,
    toggleKindFilter,
    isKindFilterActive,
    kindFilterActive,
    kindFilterChips: KIND_FILTER_CHIPS,
    sourceFilter,
    setSourceFilter,
    toggleSourceFilter,
    isSourceFilterActive,
    sourceFilterActive,
    sourceFilterChips: SOURCE_FILTER_CHIPS,
    allFilterActive,
    resetFilters,
    visiblePlugins,
    filteredPlugins,
  };
}
