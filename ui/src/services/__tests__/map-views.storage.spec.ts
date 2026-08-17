import { scopedKey } from '../scoped-storage';
import { beforeEach, describe, expect, it } from 'vitest';

import { readStoredActiveView, writeStoredActiveView } from '../map-views.storage';

/**
 * `map-views.storage.ts`: defensive read / write of the per-developer
 * active-view selection (`sm.map.active-view`). A corrupted or
 * non-slug value must read as `null` (no active view), never throw.
 */

const KEY = scopedKey('sm.map.active-view');

describe('map-views.storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips a slug and removes the key on null', () => {
    writeStoredActiveView('my-view');
    expect(localStorage.getItem(KEY)).toBe('my-view');
    expect(readStoredActiveView()).toBe('my-view');

    writeStoredActiveView(null);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(readStoredActiveView()).toBeNull();
  });

  it('an absent entry reads as null', () => {
    expect(readStoredActiveView()).toBeNull();
  });

  it.each([
    [''],
    ['-leading-hyphen'],
    ['trailing-hyphen-'],
    ['UPPER-case'],
    ['not a slug'],
    ['../traversal'],
    ['{"json":"blob"}'],
    ['x'.repeat(65)],
  ])('a corrupted value %j reads as null', (raw) => {
    localStorage.setItem(KEY, raw);
    expect(readStoredActiveView()).toBeNull();
  });

  it('accepts a maximum-length slug', () => {
    const slug = 'x'.repeat(64);
    localStorage.setItem(KEY, slug);
    expect(readStoredActiveView()).toBe(slug);
  });
});
