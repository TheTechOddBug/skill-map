/**
 * Pure contract of `map-overrides.ts`, the deviation-model helpers
 * (`spec/cli-contract.md` §Map scope overrides): nearest-ancestor-wins
 * evaluation, the canonicalizing subtree toggle, the wire compilation,
 * and the serialization key. No Angular, no DOM.
 */

import { describe, expect, it } from 'vitest';

import {
  applySetSubtree,
  compileOverridesToWire,
  effectiveState,
  inheritedState,
  overrideMapsEqual,
  overridesKey,
  type TVisibilityOverride,
} from '../map-overrides';

function map(entries: Record<string, TVisibilityOverride>): Map<string, TVisibilityOverride> {
  return new Map(Object.entries(entries));
}

describe('effectiveState', () => {
  it('defaults to include with no overrides', () => {
    expect(effectiveState(map({}), 'a/b.md')).toBe('include');
  });

  it('nearest ancestor wins across three levels', () => {
    const overrides = map({ app: 'exclude', 'app/keep': 'include', 'app/keep/deep': 'exclude' });
    expect(effectiveState(overrides, 'app/x.md')).toBe('exclude');
    expect(effectiveState(overrides, 'app/keep/y.md')).toBe('include');
    expect(effectiveState(overrides, 'app/keep/deep/z.md')).toBe('exclude');
    expect(effectiveState(overrides, 'other.md')).toBe('include');
  });

  it('the root key covers everything', () => {
    expect(effectiveState(map({ '': 'exclude' }), 'any.md')).toBe('exclude');
    expect(effectiveState(map({ '': 'exclude', docs: 'include' }), 'docs/a.md')).toBe('include');
  });

  it('an override matches itself, not string-prefix siblings', () => {
    const overrides = map({ app: 'exclude' });
    expect(effectiveState(overrides, 'app')).toBe('exclude');
    expect(effectiveState(overrides, 'app2/x.md')).toBe('include');
  });
});

describe('inheritedState', () => {
  it('skips the path\'s own override and reports the strict ancestor', () => {
    const overrides = map({ app: 'exclude', 'app/keep': 'include' });
    expect(inheritedState(overrides, 'app/keep')).toBe('exclude');
    expect(inheritedState(overrides, 'app')).toBe('include');
  });
});

describe('applySetSubtree', () => {
  it('clears the subtree\'s own overrides and writes one', () => {
    const before = map({ 'app/a': 'exclude', 'app/b': 'include', docs: 'exclude' });
    const after = applySetSubtree(before, 'app', 'exclude');
    expect([...after.entries()].sort()).toEqual([
      ['app', 'exclude'],
      ['docs', 'exclude'],
    ]);
  });

  it('deletes instead of writing when the desired state is inherited anyway', () => {
    const before = map({ app: 'exclude' });
    const after = applySetSubtree(before, 'app', 'include');
    expect(after.size).toBe(0);
  });

  it('the root toggle wipes the whole map', () => {
    const before = map({ app: 'exclude', docs: 'include' });
    const after = applySetSubtree(before, '', 'exclude');
    expect([...after.entries()]).toEqual([['', 'exclude']]);
    expect(applySetSubtree(after, '', 'include').size).toBe(0);
  });

  it('never mutates the input map', () => {
    const before = map({ app: 'exclude' });
    applySetSubtree(before, 'app', 'include');
    expect(before.get('app')).toBe('exclude');
  });
});

describe('compileOverridesToWire', () => {
  it('splits includes / excludes and lifts the root onto excludeRoot', () => {
    const wire = compileOverridesToWire(
      map({ '': 'exclude', 'b/keep': 'include', a: 'exclude', z: 'include' }),
    );
    expect(wire).toEqual({
      include: ['b/keep', 'z'],
      exclude: ['a'],
      excludeRoot: true,
    });
  });

  it('the empty map compiles to the whole-corpus request', () => {
    expect(compileOverridesToWire(map({}))).toEqual({
      include: [],
      exclude: [],
      excludeRoot: false,
    });
  });
});

describe('overridesKey / overrideMapsEqual', () => {
  it('the key is order-independent and state-sensitive', () => {
    const a = map({ x: 'exclude', y: 'include' });
    const b = new Map([...map({ y: 'include', x: 'exclude' })]);
    expect(overridesKey(a)).toBe(overridesKey(b));
    expect(overridesKey(a)).not.toBe(overridesKey(map({ x: 'include', y: 'include' })));
  });

  it('equality is value-based', () => {
    expect(overrideMapsEqual(map({ a: 'exclude' }), map({ a: 'exclude' }))).toBe(true);
    expect(overrideMapsEqual(map({ a: 'exclude' }), map({ a: 'include' }))).toBe(false);
    expect(overrideMapsEqual(map({ a: 'exclude' }), map({}))).toBe(false);
  });
});
