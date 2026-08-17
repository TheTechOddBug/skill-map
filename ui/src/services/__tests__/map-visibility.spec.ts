/**
 * `MapVisibilityService`, the signal-backed map scope overrides
 * (`spec/cli-contract.md` §Map scope overrides), plus its `localStorage`
 * persistence and the legacy-whitelist migration.
 *
 * Covers: `setSubtree` canonicalization (subtree-clearing, redundant
 * deletes), `effectiveState` nearest-ancestor-wins, `setOnly` /
 * `setOverrides` / `clear`, the isolate toggle-back over maps, `prune`
 * (drop, no-op, dead-scope fallback), the `isActive` derivation, and
 * the localStorage round-trip incl. migration from the legacy
 * `sm.map.visible-paths` array.
 *
 * The service is `providedIn: 'root'` and writes through an `effect`, so it
 * is exercised through `TestBed.inject` (mirrors `graph-preferences.spec.ts`)
 * and `TestBed.tick()` flushes the persistence effect (mirrors
 * `expansion.controller.spec.ts`).
 * Plain `localStorage` here, the SqliteStorageAdapter `:memory:` caveat does
 * NOT apply.
 */

import { scopedKey } from '../scoped-storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { MapVisibilityService } from '../map-visibility';
import { readStoredOverrides } from '../map-visibility.storage';

const STORAGE_KEY = scopedKey('sm.map.overrides');
// Bare BY DESIGN: the migration reads the pre-namespace spelling.
const LEGACY_KEY = 'sm.map.visible-paths';

function inject(): MapVisibilityService {
  return TestBed.inject(MapVisibilityService);
}

/** Sorted `kind:path` entries, so map assertions are order-independent. */
function entries(service: MapVisibilityService): string[] {
  return [...service.overrides().entries()].map(([k, v]) => `${v}:${k}`).sort();
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
  it('starts with no overrides (everything visible) and inactive', () => {
    const service = inject();
    expect(entries(service)).toEqual([]);
    expect(service.isActive()).toBe(false);
    expect(service.effectiveState('any/path.md')).toBe('include');
  });
});

describe('MapVisibilityService, setSubtree', () => {
  it('excluding a folder writes one exclude override', () => {
    const service = inject();
    service.setSubtree('app/legacy', 'exclude');
    expect(entries(service)).toEqual(['exclude:app/legacy']);
    expect(service.effectiveState('app/legacy/old.md')).toBe('exclude');
    expect(service.effectiveState('app/one.md')).toBe('include');
    expect(service.isActive()).toBe(true);
  });

  it('re-including the same folder deletes the override (canonical, back to empty)', () => {
    const service = inject();
    service.setSubtree('app/legacy', 'exclude');
    service.setSubtree('app/legacy', 'include');
    expect(entries(service)).toEqual([]);
    expect(service.isActive()).toBe(false);
  });

  it('a deeper include rescues part of an excluded subtree (nearest ancestor wins)', () => {
    const service = inject();
    service.setSubtree('app', 'exclude');
    service.setSubtree('app/keep', 'include');
    expect(entries(service)).toEqual(['exclude:app', 'include:app/keep']);
    expect(service.effectiveState('app/keep/gem.md')).toBe('include');
    expect(service.effectiveState('app/other.md')).toBe('exclude');
  });

  it('toggling a parent clears the overrides its subtree carried', () => {
    const service = inject();
    service.setSubtree('app/a', 'exclude');
    service.setSubtree('app/b', 'exclude');
    service.setSubtree('app', 'exclude');
    expect(entries(service)).toEqual(['exclude:app']);
  });

  it('the root path toggles the whole corpus (master checkbox)', () => {
    const service = inject();
    service.setSubtree('', 'exclude');
    expect(entries(service)).toEqual(['exclude:']);
    expect(service.effectiveState('anything.md')).toBe('exclude');
    service.setSubtree('', 'include');
    expect(entries(service)).toEqual([]);
  });

  it('a leaf toggle under an excluded ancestor writes a deeper include', () => {
    const service = inject();
    service.setSubtree('docs', 'exclude');
    service.setSubtree('docs/keep.md', 'include');
    expect(service.effectiveState('docs/keep.md')).toBe('include');
    expect(service.effectiveState('docs/other.md')).toBe('exclude');
  });
});

describe('MapVisibilityService, setOnly / setOverrides / clear', () => {
  it('setOnly builds root-exclude + includes (show only these)', () => {
    const service = inject();
    service.setOnly(['a.md', 'sub/b.md']);
    expect(entries(service)).toEqual(['exclude:', 'include:a.md', 'include:sub/b.md']);
    expect(service.effectiveState('a.md')).toBe('include');
    expect(service.effectiveState('c.md')).toBe('exclude');
  });

  it('setOnly with an empty iterable clears to show-all', () => {
    const service = inject();
    service.setSubtree('app', 'exclude');
    service.setOnly([]);
    expect(entries(service)).toEqual([]);
  });

  it('setOverrides restores a snapshot verbatim', () => {
    const service = inject();
    const snapshot = new Map<string, 'include' | 'exclude'>([['app', 'exclude']]);
    service.setOverrides(snapshot);
    expect(entries(service)).toEqual(['exclude:app']);
    // The restore is a copy: mutating the source map later changes nothing.
    snapshot.set('docs', 'exclude');
    expect(entries(service)).toEqual(['exclude:app']);
  });

  it('clear drops every override and is identity-stable when already empty', () => {
    const service = inject();
    const before = service.overrides();
    service.clear();
    expect(service.overrides()).toBe(before);
    service.setSubtree('app', 'exclude');
    service.clear();
    expect(entries(service)).toEqual([]);
  });
});

describe('MapVisibilityService, isolate toggle', () => {
  it('isolates to the neighborhood and restores the prior overrides on re-isolate', () => {
    const service = inject();
    service.setSubtree('noise', 'exclude');
    expect(service.isolate('a.md', ['a.md', 'b.md'])).toBe('isolated');
    expect(entries(service)).toEqual(['exclude:', 'include:a.md', 'include:b.md']);
    expect(service.isolate('a.md', ['a.md', 'b.md'])).toBe('restored');
    expect(entries(service)).toEqual(['exclude:noise']);
  });

  it('a different origin starts a fresh isolate instead of restoring', () => {
    const service = inject();
    service.isolate('a.md', ['a.md', 'b.md']);
    expect(service.isolate('c.md', ['c.md'])).toBe('isolated');
    expect(entries(service)).toEqual(['exclude:', 'include:c.md']);
  });

  it('curation edited in between forces a fresh isolate', () => {
    const service = inject();
    service.isolate('a.md', ['a.md']);
    // A REAL edit under the isolate scope: rescuing another node. (An
    // exclude would be canonicalized away, everything outside the
    // isolate is already excluded via the root override.)
    service.setSubtree('extra.md', 'include');
    expect(service.isolate('a.md', ['a.md'])).toBe('isolated');
  });
});

describe('MapVisibilityService, prune', () => {
  it('drops overrides whose path died, keeps folder prefixes with descendants', () => {
    const service = inject();
    service.setSubtree('gone/old.md', 'exclude');
    service.setSubtree('folder', 'exclude');
    service.prune(new Set(['folder/child.md', 'other.md']));
    expect(entries(service)).toEqual(['exclude:folder']);
  });

  it('is an identity-stable no-op when everything is still valid', () => {
    const service = inject();
    service.setSubtree('app', 'exclude');
    const before = service.overrides();
    service.prune(new Set(['app/one.md']));
    expect(service.overrides()).toBe(before);
  });

  it('keeps the root override (it has no path to die)', () => {
    const service = inject();
    service.setOnly(['app/one.md']);
    service.prune(new Set(['app/one.md']));
    expect(entries(service)).toEqual(['exclude:', 'include:app/one.md']);
  });

  it('falls back to show-all when the scope dies wholesale (root excluded, includes gone)', () => {
    const service = inject();
    service.setOnly(['gone.md']);
    service.prune(new Set(['other.md']));
    expect(entries(service)).toEqual([]);
    expect(service.isActive()).toBe(false);
  });
});

describe('MapVisibilityService, localStorage persistence', () => {
  it('persists the override map and rehydrates a fresh instance from it', () => {
    const service = inject();
    service.setSubtree('app', 'exclude');
    service.setSubtree('app/keep', 'include');
    TestBed.tick();
    expect(readStoredOverrides().get('app')).toBe('exclude');

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const fresh = inject();
    expect(entries(fresh)).toEqual(['exclude:app', 'include:app/keep']);
  });

  it('removes the storage row when the map clears', () => {
    const service = inject();
    service.setSubtree('app', 'exclude');
    TestBed.tick();
    service.clear();
    TestBed.tick();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('migrates the legacy inclusion whitelist to root-exclude + includes', () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(['src', 'docs/a.md']));
    const service = inject();
    expect(entries(service)).toEqual(['exclude:', 'include:docs/a.md', 'include:src']);
    // The visible set is preserved: only the whitelisted paths show.
    expect(service.effectiveState('src/x.md')).toBe('include');
    expect(service.effectiveState('other.md')).toBe('exclude');
    // The first persistence pass removes the legacy key.
    service.setSubtree('extra', 'exclude');
    TestBed.tick();
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('a corrupted entry resets to the default show-all state', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    const service = inject();
    expect(entries(service)).toEqual([]);
  });
});

/**
 * Selection seniority (spec §Map scope overrides · Seniority fill): the
 * map's insertion order is the cap-fill priority, so the service must
 * express the two user decisions (2026-07-28) and persist the order.
 */
describe('MapVisibilityService, selection seniority', () => {
  it('re-checking a folder is a NEW selection: it moves to the tail', () => {
    const service = inject();
    service.setOnly(['a', 'b', 'c']);
    service.setSubtree('a', 'exclude'); // uncheck: entry deleted (inherits root exclude)
    service.setSubtree('a', 'include'); // re-check: appended last
    expect([...service.overrides().keys()]).toEqual(['b', 'c', '', 'a']);
  });

  it('selecting a parent after a child swallows the child, parent at the tail', () => {
    const service = inject();
    service.setOnly(['docs/a', 'other']);
    service.setSubtree('docs', 'include');
    expect([...service.overrides().keys()]).toEqual(['other', '', 'docs']);
  });

  it('prune preserves the surviving insertion order', () => {
    const service = inject();
    service.setOnly(['z', 'm', 'a']);
    service.prune(new Set(['z', 'a']));
    expect([...service.overrides().keys()]).toEqual(['z', 'a', '']);
  });

  it('persists the insertion order (array shape) and rehydrates it', () => {
    const service = inject();
    service.setOnly(['z', 'a']);
    TestBed.tick();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '')).toEqual([
      ['z', 'include'],
      ['a', 'include'],
      ['', 'exclude'],
    ]);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const fresh = inject();
    expect([...fresh.overrides().keys()]).toEqual(['z', 'a', '']);
  });

  it('still reads the legacy object shape (best-effort order)', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ z: 'include', a: 'include', '': 'exclude' }),
    );
    const service = inject();
    expect(entries(service)).toEqual(['exclude:', 'include:a', 'include:z']);
  });
});
