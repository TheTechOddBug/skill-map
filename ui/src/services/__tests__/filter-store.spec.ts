/**
 * Coverage for `FilterStoreService.apply()`'s search → map decoupling
 * (`opts.includeSearch`) and the persisted `searchAffectsMap`
 * preference behind the rail's toggle. The rest of the filter chain is
 * exercised end-to-end by the URL-sync and view specs; these tests pin
 * the contract the graph view relies on to keep the map intact while
 * the files rail narrows on the same query.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { FilterStoreService } from '../filter-store';
import type { INodeView } from '../../models/node';

const SEARCH_AFFECTS_MAP_KEY = 'sm.workspace.search-affects-map';

function mockNode(over: Partial<INodeView>): INodeView {
  return {
    path: 'docs/a.md',
    kind: 'skill',
    provider: 'claude',
    frontmatter: {},
    ...over,
  } as INodeView;
}

describe('FilterStoreService search → map decoupling', () => {
  let store: FilterStoreService;

  beforeEach(() => {
    localStorage.removeItem(SEARCH_AFFECTS_MAP_KEY);
    TestBed.configureTestingModule({});
    store = TestBed.inject(FilterStoreService);
    store.reset();
  });

  it('apply() includes the text search by default', () => {
    store.setSearchText('alpha');
    const nodes = [
      mockNode({ path: 'docs/alpha.md' }),
      mockNode({ path: 'docs/beta.md' }),
    ];
    const out = store.apply(nodes);
    expect(out.map((n) => n.path)).toEqual(['docs/alpha.md']);
  });

  it('apply({ includeSearch: false }) ignores the query but keeps the other filters', () => {
    store.setSearchText('alpha');
    store.setFavoritesOnly(true);
    const nodes = [
      mockNode({ path: 'docs/alpha.md', isFavorite: false }),
      mockNode({ path: 'docs/beta.md', isFavorite: true }),
    ];
    const out = store.apply(nodes, undefined, { includeSearch: false });
    // The query would have dropped beta.md; the favorites filter still ran.
    expect(out.map((n) => n.path)).toEqual(['docs/beta.md']);
  });

  it('searchAffectsMap defaults to false (the search filters only the files rail)', () => {
    expect(store.searchAffectsMap()).toBe(false);
  });

  it('toggleSearchAffectsMap flips the signal and persists the choice', () => {
    store.toggleSearchAffectsMap();
    expect(store.searchAffectsMap()).toBe(true);
    expect(localStorage.getItem(SEARCH_AFFECTS_MAP_KEY)).toBe('1');
    store.toggleSearchAffectsMap();
    expect(store.searchAffectsMap()).toBe(false);
    expect(localStorage.getItem(SEARCH_AFFECTS_MAP_KEY)).toBe('0');
  });

  it('reset() clears the query but leaves the preference alone', () => {
    store.toggleSearchAffectsMap();
    store.setSearchText('alpha');
    store.reset();
    expect(store.searchText()).toBe('');
    expect(store.searchAffectsMap()).toBe(true);
  });
});
