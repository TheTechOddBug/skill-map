import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_SORT,
  defaultDirFor,
  isFilesSort,
  nextSort,
  readStoredSort,
  writeStoredSort,
  type IFilesSort,
} from '../files-view.sort';

const STORAGE_KEY = 'sm.files.sort';

describe('files-view.sort: defaults', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('reads the default (tree/asc) when no row exists', () => {
    expect(readStoredSort()).toEqual(DEFAULT_SORT);
    expect(DEFAULT_SORT).toEqual({ column: 'tree', dir: 'asc' });
  });

  it('defaultDirFor: tree -> asc, data columns -> desc', () => {
    expect(defaultDirFor('tree')).toBe('asc');
    expect(defaultDirFor('linksIn')).toBe('desc');
    expect(defaultDirFor('linksOut')).toBe('desc');
    expect(defaultDirFor('tokens')).toBe('desc');
    expect(defaultDirFor('issues')).toBe('desc');
  });
});

describe('files-view.sort: round-trip', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('persists and reads back a non-default sort', () => {
    const sort: IFilesSort = { column: 'tokens', dir: 'asc' };
    writeStoredSort(sort);
    expect(readStoredSort()).toEqual(sort);
  });

  it('does NOT persist the default (clears the row instead)', () => {
    writeStoredSort({ column: 'tokens', dir: 'desc' });
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    writeStoredSort(DEFAULT_SORT);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe('files-view.sort: malformed storage resets to default', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  for (const bad of [
    'not json',
    '"a string"',
    '42',
    'null',
    '{}',
    '{"column":"tree"}',
    '{"dir":"asc"}',
    '{"column":"ghost","dir":"asc"}',
    '{"column":"tokens","dir":"sideways"}',
    '[]',
  ]) {
    it(`falls back for ${bad}`, () => {
      localStorage.setItem(STORAGE_KEY, bad);
      expect(readStoredSort()).toEqual(DEFAULT_SORT);
    });
  }
});

describe('nextSort: header-click transitions', () => {
  it('the tree column always resets to the default, from any state', () => {
    expect(nextSort({ column: 'tokens', dir: 'asc' }, 'tree')).toEqual(DEFAULT_SORT);
    expect(nextSort({ column: 'issues', dir: 'desc' }, 'tree')).toEqual(DEFAULT_SORT);
  });

  it('activating a fresh data column opens at its default direction (desc)', () => {
    expect(nextSort(DEFAULT_SORT, 'tokens')).toEqual({ column: 'tokens', dir: 'desc' });
    expect(nextSort({ column: 'tokens', dir: 'asc' }, 'linksIn')).toEqual({
      column: 'linksIn',
      dir: 'desc',
    });
  });

  it('clicking the already-active column toggles direction', () => {
    expect(nextSort({ column: 'tokens', dir: 'desc' }, 'tokens')).toEqual({
      column: 'tokens',
      dir: 'asc',
    });
    expect(nextSort({ column: 'tokens', dir: 'asc' }, 'tokens')).toEqual({
      column: 'tokens',
      dir: 'desc',
    });
  });
});

describe('isFilesSort', () => {
  it('accepts valid shapes', () => {
    expect(isFilesSort({ column: 'linksIn', dir: 'desc' })).toBe(true);
    expect(isFilesSort({ column: 'tree', dir: 'asc' })).toBe(true);
  });

  it('rejects invalid shapes', () => {
    expect(isFilesSort(null)).toBe(false);
    expect(isFilesSort({ column: 'tokens' })).toBe(false);
    expect(isFilesSort({ column: 'x', dir: 'asc' })).toBe(false);
    expect(isFilesSort({ column: 'tokens', dir: 'x' })).toBe(false);
  });
});
