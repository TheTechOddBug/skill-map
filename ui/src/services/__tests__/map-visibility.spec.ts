/**
 * `MapVisibilityService`, signal-backed MAP selection set (folder
 * PREFIXES + exact leaf paths), plus its `localStorage` persistence.
 *
 * Covers: per-leaf toggle, the single-prefix folder toggle
 * (`toggleFolder`), `setOnly` / `clear`, `prune` (drop-and-no-op), the
 * `isActive` / `count` derivations, and the localStorage round-trip read
 * via `readStoredVisiblePaths`.
 *
 * The service is `providedIn: 'root'` and writes through an `effect`, so it
 * is exercised through `TestBed.inject` (mirrors `graph-preferences.spec.ts`)
 * and `TestBed.tick()` flushes the persistence effect (mirrors
 * `expansion.controller.spec.ts`).
 * Plain `localStorage` here, the SqliteStorageAdapter `:memory:` caveat does
 * NOT apply.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { MapVisibilityService } from '../map-visibility';
import { readStoredVisiblePaths } from '../map-visibility.storage';

const STORAGE_KEY = 'sm.map.visible-paths';

function inject(): MapVisibilityService {
  return TestBed.inject(MapVisibilityService);
}

/** Sorted member array, so set assertions are order-independent. */
function members(set: ReadonlySet<string>): string[] {
  return [...set].sort();
}

beforeEach(() => {
  localStorage.clear();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});
});

afterEach(() => {
  localStorage.clear();
});

describe('MapVisibilityService, defaults', () => {
  it('starts empty (show-all) with no storage row', () => {
    const service = inject();
    expect(members(service.paths())).toEqual([]);
    expect(service.isActive()).toBe(false);
    expect(service.count()).toBe(0);
  });
});

describe('MapVisibilityService, toggleLeaf', () => {
  it('adds then removes a single leaf', () => {
    const service = inject();
    service.toggleLeaf('a.md');
    expect(members(service.paths())).toEqual(['a.md']);
    expect(service.isActive()).toBe(true);
    expect(service.count()).toBe(1);

    service.toggleLeaf('a.md');
    expect(members(service.paths())).toEqual([]);
    expect(service.isActive()).toBe(false);
    expect(service.count()).toBe(0);
  });

  it('toggling two distinct leaves accumulates both', () => {
    const service = inject();
    service.toggleLeaf('a.md');
    service.toggleLeaf('b.md');
    expect(members(service.paths())).toEqual(['a.md', 'b.md']);
    expect(service.count()).toBe(2);
  });
});

describe('MapVisibilityService, toggleFolder (single prefix)', () => {
  it('adds the folder prefix when absent', () => {
    const service = inject();
    service.toggleFolder('docs');
    expect(members(service.paths())).toEqual(['docs']);
    expect(service.isActive()).toBe(true);
  });

  it('removes the folder prefix when already present', () => {
    const service = inject();
    service.toggleFolder('docs');
    service.toggleFolder('docs');
    expect(members(service.paths())).toEqual([]);
    expect(service.isActive()).toBe(false);
  });

  it('accumulates sibling prefixes for a union selection', () => {
    const service = inject();
    service.toggleFolder('src');
    service.toggleFolder('docs');
    expect(members(service.paths())).toEqual(['docs', 'src']);
    expect(service.count()).toBe(2);
  });

  it('toggling one prefix off leaves the other selected prefixes untouched', () => {
    const service = inject();
    service.toggleFolder('src');
    service.toggleFolder('docs');
    service.toggleFolder('src'); // remove only src
    expect(members(service.paths())).toEqual(['docs']);
  });

  it('coexists with exact leaf paths in the selection', () => {
    const service = inject();
    service.toggleLeaf('readme.md');
    service.toggleFolder('docs');
    expect(members(service.paths())).toEqual(['docs', 'readme.md']);
  });

  it('is a no-op for the empty (root) prefix', () => {
    const service = inject();
    service.toggleLeaf('a.md');
    service.toggleFolder('');
    expect(members(service.paths())).toEqual(['a.md']);
  });
});

describe('MapVisibilityService, setOnly / clear', () => {
  it('setOnly replaces the whole set', () => {
    const service = inject();
    service.toggleLeaf('old.md');
    service.setOnly(['x.md', 'y.md']);
    expect(members(service.paths())).toEqual(['x.md', 'y.md']);
    expect(service.count()).toBe(2);
  });

  it('setOnly with an empty iterable empties the set', () => {
    const service = inject();
    service.toggleLeaf('old.md');
    service.setOnly([]);
    expect(members(service.paths())).toEqual([]);
    expect(service.isActive()).toBe(false);
  });

  it('clear empties a populated set', () => {
    const service = inject();
    service.setOnly(['a.md', 'b.md']);
    service.clear();
    expect(members(service.paths())).toEqual([]);
    expect(service.isActive()).toBe(false);
  });

  it('clear is a no-op identity-stable swap on an already-empty set', () => {
    const service = inject();
    const before = service.paths();
    service.clear();
    expect(service.paths()).toBe(before); // same Set reference, no spurious re-render
  });
});

describe('MapVisibilityService, isolate toggle', () => {
  it('narrows to the neighborhood, then a re-isolate of the same node restores show-all', () => {
    const service = inject();

    const first = service.isolate('a.md', ['a.md', 'b.md']);
    expect(first).toBe('isolated');
    expect(members(service.paths())).toEqual(['a.md', 'b.md']);

    const second = service.isolate('a.md', ['a.md', 'b.md']);
    expect(second).toBe('restored');
    expect(members(service.paths())).toEqual([]); // back to the pre-isolate (empty) state
    expect(service.isActive()).toBe(false);
  });

  it('restores a non-empty curated set that was active before the isolate', () => {
    const service = inject();
    service.setOnly(['x.md', 'y.md', 'z.md']); // hand-curated baseline

    service.isolate('a.md', ['a.md', 'b.md']);
    expect(members(service.paths())).toEqual(['a.md', 'b.md']);

    expect(service.isolate('a.md', ['a.md', 'b.md'])).toBe('restored');
    expect(members(service.paths())).toEqual(['x.md', 'y.md', 'z.md']);
  });

  it('isolating a different node is a fresh isolate, not a restore', () => {
    const service = inject();
    service.isolate('a.md', ['a.md', 'b.md']);

    const outcome = service.isolate('b.md', ['b.md', 'c.md']);
    expect(outcome).toBe('isolated');
    expect(members(service.paths())).toEqual(['b.md', 'c.md']);

    // ...and re-isolating b now toggles back to a's neighborhood (the state
    // captured right before b's isolate).
    expect(service.isolate('b.md', ['b.md', 'c.md'])).toBe('restored');
    expect(members(service.paths())).toEqual(['a.md', 'b.md']);
  });

  it('treats a re-isolate as fresh when curation was edited in between', () => {
    const service = inject();
    service.isolate('a.md', ['a.md', 'b.md']);
    service.toggleLeaf('c.md'); // the live set no longer matches a's neighborhood

    const outcome = service.isolate('a.md', ['a.md', 'b.md']);
    expect(outcome).toBe('isolated'); // strict toggle: not a blind restore
    expect(members(service.paths())).toEqual(['a.md', 'b.md']);
  });

  it('the restore reference differs from the snapshot so signal consumers re-run', () => {
    const service = inject();
    service.setOnly(['x.md']);
    const snapshot = service.paths();
    service.isolate('a.md', ['a.md', 'b.md']);
    service.isolate('a.md', ['a.md', 'b.md']); // restore

    expect(members(service.paths())).toEqual(['x.md']);
    expect(service.paths()).not.toBe(snapshot); // fresh Set, identity changed
  });
});

describe('MapVisibilityService, prune', () => {
  it('drops paths absent from the valid set', () => {
    const service = inject();
    service.setOnly(['a.md', 'gone.md', 'b.md']);
    service.prune(new Set(['a.md', 'b.md']));
    expect(members(service.paths())).toEqual(['a.md', 'b.md']);
  });

  it('falls back to show-all when pruning empties the set', () => {
    const service = inject();
    service.setOnly(['gone.md']);
    service.prune(new Set(['still-here.md']));
    expect(members(service.paths())).toEqual([]);
    expect(service.isActive()).toBe(false);
  });

  it('is an identity-stable no-op when every path is still valid', () => {
    const service = inject();
    service.setOnly(['a.md', 'b.md']);
    const before = service.paths();
    service.prune(new Set(['a.md', 'b.md', 'extra.md']));
    expect(service.paths()).toBe(before); // unchanged reference, nothing dropped
    expect(members(service.paths())).toEqual(['a.md', 'b.md']);
  });

  it('is a no-op on an empty set', () => {
    const service = inject();
    const before = service.paths();
    service.prune(new Set(['anything.md']));
    expect(service.paths()).toBe(before);
  });

  it('keeps a folder prefix while it still has a descendant node, drops an empty one', () => {
    const service = inject();
    // The selection holds folder PREFIXES (never themselves node paths).
    service.setOnly(['skills', 'gone-folder']);
    service.prune(new Set(['skills/a.md', 'skills/b.md', 'other/c.md']));
    // 'skills' survives (has descendants); 'gone-folder' is dropped (none).
    expect(members(service.paths())).toEqual(['skills']);
  });
});

describe('MapVisibilityService, isActive / count', () => {
  it('reflect the live size of the set', () => {
    const service = inject();
    expect(service.isActive()).toBe(false);
    expect(service.count()).toBe(0);

    service.setOnly(['a.md', 'b.md', 'c.md']);
    expect(service.isActive()).toBe(true);
    expect(service.count()).toBe(3);

    service.clear();
    expect(service.isActive()).toBe(false);
    expect(service.count()).toBe(0);
  });
});

describe('MapVisibilityService, localStorage persistence round-trip', () => {
  it('writes the set so readStoredVisiblePaths reads it back', () => {
    const service = inject();
    service.setOnly(['a.md', 'b.md']);
    // The write happens via an effect; a CD tick flushes it.
    TestBed.tick();
    expect(members(readStoredVisiblePaths())).toEqual(['a.md', 'b.md']);
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it('removes the storage row when the set is cleared (empty == show-all)', () => {
    const service = inject();
    service.setOnly(['a.md']);
    TestBed.tick();
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();

    service.clear();
    TestBed.tick();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(members(readStoredVisiblePaths())).toEqual([]);
  });

  it('rehydrates a fresh service instance from a seeded storage row', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['seeded/x.md', 'seeded/y.md']));
    const service = inject();
    expect(members(service.paths())).toEqual(['seeded/x.md', 'seeded/y.md']);
    expect(service.isActive()).toBe(true);
  });
});

describe('MapVisibilityService.inScope', () => {
  it('is true for every path while curation is inactive (empty set)', () => {
    const service = inject();
    expect(service.isActive()).toBe(false);
    expect(service.inScope('anything.md')).toBe(true);
    expect(service.inScope('docs/deep/x.md')).toBe(true);
  });

  it('restricts to the curated paths once active', () => {
    const service = inject();
    service.setOnly(['a.md', 'docs/b.md']);
    expect(service.inScope('a.md')).toBe(true);
    expect(service.inScope('docs/b.md')).toBe(true);
    expect(service.inScope('c.md')).toBe(false);
  });

  it('returns to all-in-scope after clear', () => {
    const service = inject();
    service.setOnly(['a.md']);
    expect(service.inScope('b.md')).toBe(false);
    service.clear();
    expect(service.inScope('b.md')).toBe(true);
  });
});
