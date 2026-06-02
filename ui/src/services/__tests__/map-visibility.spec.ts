/**
 * `MapVisibilityService`, signal-backed inclusion set for the MAP
 * visibility curation feature, plus its `localStorage` persistence.
 *
 * Covers: per-leaf toggle, the tri-state `folderState`, the folder cascade
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

describe('MapVisibilityService, folderState (tri-state)', () => {
  const leaves = ['docs/a.md', 'docs/b.md', 'docs/c.md'];

  it("returns 'none' for an empty leaf list", () => {
    const service = inject();
    expect(service.folderState([])).toBe('none');
  });

  it("returns 'none' when zero of the folder's leaves are included", () => {
    const service = inject();
    service.toggleLeaf('elsewhere.md'); // unrelated to the folder
    expect(service.folderState(leaves)).toBe('none');
  });

  it("returns 'some' when only part of the folder is included", () => {
    const service = inject();
    service.toggleLeaf('docs/a.md');
    expect(service.folderState(leaves)).toBe('some');
  });

  it("returns 'all' when every leaf of the folder is included", () => {
    const service = inject();
    for (const path of leaves) service.toggleLeaf(path);
    expect(service.folderState(leaves)).toBe('all');
  });
});

describe('MapVisibilityService, toggleFolder cascade', () => {
  const leaves = ['docs/a.md', 'docs/b.md', 'docs/c.md'];

  it("cascades 'none' -> 'all' (fills every leaf)", () => {
    const service = inject();
    service.toggleFolder(leaves);
    expect(members(service.paths())).toEqual(['docs/a.md', 'docs/b.md', 'docs/c.md']);
    expect(service.folderState(leaves)).toBe('all');
  });

  it("cascades 'some' -> 'all' (fills the remaining leaves, keeps the rest)", () => {
    const service = inject();
    service.toggleLeaf('docs/a.md'); // partial
    expect(service.folderState(leaves)).toBe('some');
    service.toggleFolder(leaves);
    expect(members(service.paths())).toEqual(['docs/a.md', 'docs/b.md', 'docs/c.md']);
    expect(service.folderState(leaves)).toBe('all');
  });

  it("cascades 'all' -> 'none' (clears every leaf of the folder)", () => {
    const service = inject();
    for (const path of leaves) service.toggleLeaf(path);
    expect(service.folderState(leaves)).toBe('all');
    service.toggleFolder(leaves);
    expect(members(service.paths())).toEqual([]);
    expect(service.folderState(leaves)).toBe('none');
  });

  it('leaves paths outside the folder untouched when cascading off', () => {
    const service = inject();
    service.toggleLeaf('other/x.md');
    for (const path of leaves) service.toggleLeaf(path);
    service.toggleFolder(leaves); // all -> none for the folder only
    expect(members(service.paths())).toEqual(['other/x.md']);
  });

  it('is a no-op for an empty leaf list', () => {
    const service = inject();
    service.toggleLeaf('a.md');
    service.toggleFolder([]);
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
