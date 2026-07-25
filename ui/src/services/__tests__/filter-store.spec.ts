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
import type { TLinkKindApi } from '../../models/api';

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

/**
 * Edge-kind palette semantics. Each toggle must be an independent
 * show / hide of ONE link kind: the whole point of the sticky
 * explicit-empty flag and of passing the caller's visible universe
 * (instead of the spec-fixed `ALL_LINK_KINDS`) is that turning kinds
 * off never flips the untouched ones back on.
 */
describe('FilterStoreService link-kind toggles', () => {
  let store: FilterStoreService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(FilterStoreService);
    store.reset();
  });

  it('hides only the clicked kind when the project carries a subset of the catalog', () => {
    // Universe = kinds actually present in the scan. `points` / `mentions`
    // have no links here, so they must never enter the whitelist.
    const universe: TLinkKindApi[] = ['invokes', 'references'];
    store.toggleLinkKind('invokes', universe);
    expect(store.selectedLinkKinds()).toEqual(['references']);
    expect(store.isLinkKindActive('invokes')).toBe(false);
    expect(store.isLinkKindActive('references')).toBe(true);
  });

  it('keeps every kind hidden after the last toggle goes off', () => {
    const universe: TLinkKindApi[] = ['invokes', 'references'];
    store.toggleLinkKind('invokes', universe);
    store.toggleLinkKind('references', universe);
    expect(store.selectedLinkKinds()).toEqual([]);
    expect(store.linkKindToggleExplicitEmpty()).toBe(true);
    expect(store.isLinkKindActive('invokes')).toBe(false);
    expect(store.isLinkKindActive('references')).toBe(false);
    expect(store.isActive()).toBe(true);
  });

  it('re-activates one kind at a time out of the all-off state', () => {
    const universe: TLinkKindApi[] = ['invokes', 'references'];
    store.toggleLinkKind('invokes', universe);
    store.toggleLinkKind('references', universe);
    store.toggleLinkKind('references', universe);
    expect(store.linkKindToggleExplicitEmpty()).toBe(false);
    expect(store.selectedLinkKinds()).toEqual(['references']);
    expect(store.isLinkKindActive('invokes')).toBe(false);
    expect(store.isLinkKindActive('references')).toBe(true);
  });

  it('normalises back to "no filter" once every visible kind is on again', () => {
    const universe: TLinkKindApi[] = ['invokes', 'references'];
    store.toggleLinkKind('invokes', universe);
    store.toggleLinkKind('invokes', universe);
    expect(store.selectedLinkKinds()).toEqual([]);
    expect(store.linkKindToggleExplicitEmpty()).toBe(false);
    expect(store.isActive()).toBe(false);
  });

  it('toggles a single kind off when it is the only one in the project', () => {
    // Regression: with the spec catalog as universe this click produced
    // a 3-kind whitelist, the palette sanitiser emptied it, and the lone
    // kind came straight back on (a no-op click from the operator's side).
    const universe: TLinkKindApi[] = ['references'];
    store.toggleLinkKind('references', universe);
    expect(store.isLinkKindActive('references')).toBe(false);
    expect(store.linkKindToggleExplicitEmpty()).toBe(true);
  });

  it('setLinkKinds clears the sticky all-off state (URL / programmatic path)', () => {
    const universe: TLinkKindApi[] = ['invokes', 'references'];
    store.toggleLinkKind('invokes', universe);
    store.toggleLinkKind('references', universe);
    store.setLinkKinds(['invokes']);
    expect(store.linkKindToggleExplicitEmpty()).toBe(false);
    expect(store.isLinkKindActive('invokes')).toBe(true);
  });

  it('reset() clears the sticky all-off state', () => {
    const universe: TLinkKindApi[] = ['invokes'];
    store.toggleLinkKind('invokes', universe);
    store.reset();
    expect(store.linkKindToggleExplicitEmpty()).toBe(false);
    expect(store.isLinkKindActive('invokes')).toBe(true);
    expect(store.isActive()).toBe(false);
  });
});
