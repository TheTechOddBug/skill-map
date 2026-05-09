/**
 * Spec for the click-on-tag filter behaviour on `FilterStoreService`.
 *
 * The store carries a single-tag filter (`tagFilter` signal) whose
 * lifecycle drives the annotations-panel chip "selected" state and
 * the graph / list `apply()` filter pass. Toggle semantics: clicking
 * the same chip again clears; clicking a different chip swaps. The
 * `apply()` function honours the dual-source split (`'author'` /
 * `'user'`) and the union (`'any'`) modes.
 */

import { TestBed } from '@angular/core/testing';
import { FilterStoreService } from './filter-store';
import type { INodeView, TFrontmatter } from '../models/node';

describe('FilterStoreService — tag filter', () => {
  let store: FilterStoreService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    store = TestBed.inject(FilterStoreService);
  });

  it('starts with no tag filter active', () => {
    expect(store.tagFilter()).toBeNull();
    expect(store.isActive()).toBe(false);
  });

  it('toggleTagFilter sets the filter on first click', () => {
    store.toggleTagFilter('urgent', 'author');
    expect(store.tagFilter()).toEqual({ tag: 'urgent', source: 'author' });
    expect(store.isActive()).toBe(true);
  });

  it('toggleTagFilter clears when the same (tag, source) is clicked twice', () => {
    store.toggleTagFilter('urgent', 'author');
    store.toggleTagFilter('urgent', 'author');
    expect(store.tagFilter()).toBeNull();
    expect(store.isActive()).toBe(false);
  });

  it('toggleTagFilter swaps to a different tag', () => {
    store.toggleTagFilter('urgent', 'author');
    store.toggleTagFilter('docs', 'author');
    expect(store.tagFilter()).toEqual({ tag: 'docs', source: 'author' });
  });

  it('toggleTagFilter swaps when the source changes for the same tag', () => {
    store.toggleTagFilter('urgent', 'author');
    store.toggleTagFilter('urgent', 'user');
    expect(store.tagFilter()).toEqual({ tag: 'urgent', source: 'user' });
  });

  it('clearTagFilter resets the filter to null', () => {
    store.toggleTagFilter('urgent', 'author');
    store.clearTagFilter();
    expect(store.tagFilter()).toBeNull();
  });

  it('reset() clears the tag filter alongside everything else', () => {
    store.toggleTagFilter('urgent', 'author');
    store.reset();
    expect(store.tagFilter()).toBeNull();
  });
});

describe('FilterStoreService — apply() dual-source tag filter', () => {
  let store: FilterStoreService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    store = TestBed.inject(FilterStoreService);
  });

  function makeNode(
    path: string,
    byAuthor: readonly string[],
    byUser: readonly string[],
  ): INodeView {
    const frontmatter: TFrontmatter = { name: path, description: '' };
    const node: INodeView = { path, kind: 'markdown', frontmatter };
    if (byAuthor.length > 0 || byUser.length > 0) {
      node.tags = { byAuthor, byUser };
    }
    return node;
  }

  it('source=author matches only author tags', () => {
    const nodes = [
      makeNode('a.md', ['urgent'], []),
      makeNode('b.md', [], ['urgent']),
      makeNode('c.md', [], []),
    ];
    store.setTagFilter({ tag: 'urgent', source: 'author' });
    const out = store.apply(nodes).map((n) => n.path);
    expect(out).toEqual(['a.md']);
  });

  it('source=user matches only user tags', () => {
    const nodes = [
      makeNode('a.md', ['urgent'], []),
      makeNode('b.md', [], ['urgent']),
    ];
    store.setTagFilter({ tag: 'urgent', source: 'user' });
    const out = store.apply(nodes).map((n) => n.path);
    expect(out).toEqual(['b.md']);
  });

  it('source=any matches the union (author OR user)', () => {
    const nodes = [
      makeNode('a.md', ['urgent'], []),
      makeNode('b.md', [], ['urgent']),
      makeNode('c.md', [], ['other']),
    ];
    store.setTagFilter({ tag: 'urgent', source: 'any' });
    const out = store.apply(nodes).map((n) => n.path);
    expect(out).toEqual(['a.md', 'b.md']);
  });

  it('drops nodes whose tags projection is missing entirely', () => {
    const nodes = [
      makeNode('a.md', ['urgent'], []),
      makeNode('b.md', [], []), // no tags object on the view
    ];
    store.setTagFilter({ tag: 'urgent', source: 'any' });
    const out = store.apply(nodes).map((n) => n.path);
    expect(out).toEqual(['a.md']);
  });

  it('absent tag filter is allow-all for the tag dimension', () => {
    const nodes = [makeNode('a.md', ['urgent'], []), makeNode('b.md', [], [])];
    expect(store.tagFilter()).toBeNull();
    expect(store.apply(nodes).length).toBe(2);
  });
});
