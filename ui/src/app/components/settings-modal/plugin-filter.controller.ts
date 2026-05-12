/**
 * Search + kind-filter state machine for `<sm-settings-plugins>`. Owns
 * the writable `searchText` and `kindFilter` signals, the persistence
 * effect that mirrors the kind filter into localStorage, and the
 * `filteredPlugins` derivation pipeline (lock strip → pin sort → kind
 * → search). Extracted from the component so the view file focuses on
 * fetch + buffered-toggle concerns.
 *
 * Mirrors the `setupExpansion` pattern: a `setupX` factory invoked from
 * a component field initializer (which runs in injection context, so
 * the inner `effect()` resolves the active `Injector` without ceremony).
 */

import { computed, effect, signal, type Signal, type WritableSignal } from '@angular/core';

import type { IPluginItemApi } from '../../../models/api';
import {
  writeStoredKindFilter,
} from './settings-plugins.storage';
import { readStoredKindFilter } from './settings-plugins.storage';
import {
  KIND_FILTER_OPTIONS,
  filterByKind,
  filterBySearch,
  sortPluginsByPin,
  stripLocked,
  type TKindFilter,
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
  isKindFilterActive(kind: TKindFilter): boolean;
  kindFilterActive: Signal<boolean>;
  kindFilterOptions: typeof KIND_FILTER_OPTIONS;
  /** Plugins after stripping host-locked rows and applying the pin /
   *  kind ordering. The kind / search filters chain off this. */
  visiblePlugins: Signal<readonly IPluginItemApi[]>;
  filteredPlugins: Signal<readonly IPluginItemApi[]>;
}

export function setupPluginFilter(deps: IPluginFilterDeps): IPluginFilterHandle {
  const searchText = signal('');
  const searchActive = computed(() => searchText().trim().length > 0);

  const kindFilter = signal<TKindFilter>(readStoredKindFilter());
  const kindFilterActive = computed(() => kindFilter() !== 'all');

  // Mirror the kind filter into localStorage. Fires on every change,
  // including programmatic ones, so `setKindFilter` does not need to
  // remember to persist.
  effect(() => writeStoredKindFilter(kindFilter()));

  const visiblePlugins = computed<readonly IPluginItemApi[]>(() =>
    sortPluginsByPin(deps.plugins().flatMap(stripLocked)),
  );

  const filteredPlugins = computed<readonly IPluginItemApi[]>(() => {
    const query = searchText().trim().toLowerCase();
    const kind = kindFilter();
    let list: readonly IPluginItemApi[] = visiblePlugins();
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

  const isKindFilterActive = (kind: TKindFilter): boolean => kindFilter() === kind;

  return {
    searchText,
    searchActive,
    kindFilter,
    setKindFilter,
    isKindFilterActive,
    kindFilterActive,
    kindFilterOptions: KIND_FILTER_OPTIONS,
    visiblePlugins,
    filteredPlugins,
  };
}
