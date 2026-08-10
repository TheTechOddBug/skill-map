import { describe, expect, it } from 'vitest';

import type { IMapViewApi } from '../../models/api';
import {
  MAP_VIEW_SLUG_MAX_LENGTH,
  brokenRefCount,
  pinsEqual,
  slugify,
} from '../map-views.model';

/**
 * Pure map-views helpers (`map-views.model.ts`): the slug derivation
 * (lowercase, diacritics, hyphen collapsing, 64-char clamp), the
 * dead-reference counter (override keys / pin keys / group members,
 * folder prefixes live through a surviving descendant), and pin-set
 * value equality.
 */

function makeView(overrides: Partial<IMapViewApi> = {}): IMapViewApi {
  return {
    schemaVersion: 1,
    kind: 'map-view',
    name: 'Test view',
    overrides: [],
    pins: {},
    ...overrides,
  };
}

describe('slugify', () => {
  it.each([
    ['Focus', 'focus'],
    ['My Focus  View', 'my-focus-view'],
    ['Visión Ñoña über café', 'vision-nona-uber-cafe'],
    ['  --Lead & trail--  ', 'lead-trail'],
    ['a/b\\c.d', 'a-b-c-d'],
    ['UPPER_case_09', 'upper-case-09'],
    ['***', ''],
    ['', ''],
  ])('derives %j -> %j', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it('clamps to 64 chars and re-trims a hyphen the clamp exposes', () => {
    const longRun = `${'a'.repeat(63)}-bcdef`;
    const slug = slugify(longRun);
    expect(slug.length).toBeLessThanOrEqual(MAP_VIEW_SLUG_MAX_LENGTH);
    // Position 64 lands exactly on the separator hyphen; the re-trim
    // drops it instead of emitting a trailing-hyphen slug.
    expect(slug).toBe('a'.repeat(63));
    expect(slugify('x'.repeat(100))).toBe('x'.repeat(64));
  });
});

describe('brokenRefCount', () => {
  const corpus = new Set(['docs/a.md', 'docs/guides/b.md', 'src/c.md']);

  it('returns 0 for a view whose references all resolve', () => {
    const view = makeView({
      overrides: [
        ['', 'exclude'],
        ['docs/a.md', 'include'],
        ['docs/guides', 'include'],
      ],
      pins: { 'src/c.md': { x: 1, y: 2 } },
      groups: [{ id: 'g', label: 'G', members: ['docs/guides/b.md'] }],
    });
    expect(brokenRefCount(view, corpus)).toBe(0);
  });

  it('never counts the root override key', () => {
    const view = makeView({ overrides: [['', 'exclude']] });
    expect(brokenRefCount(view, new Set())).toBe(0);
  });

  it('keeps a folder prefix alive through a surviving descendant', () => {
    const view = makeView({
      overrides: [
        ['docs', 'include'],
        ['gone-folder', 'include'],
      ],
    });
    // `docs` is not itself a node path but `docs/a.md` survives under
    // it; `gone-folder` has no descendant and counts.
    expect(brokenRefCount(view, corpus)).toBe(1);
  });

  it('counts dead override keys, pin keys, and group members together', () => {
    const view = makeView({
      overrides: [
        ['', 'exclude'],
        ['docs/a.md', 'include'],
        ['dead/one.md', 'include'],
      ],
      pins: { 'dead/two.md': { x: 0, y: 0 }, 'src/c.md': { x: 3, y: 4 } },
      groups: [
        { id: 'g', label: 'G', members: ['dead/three.md', 'docs/a.md'] },
      ],
    });
    expect(brokenRefCount(view, corpus)).toBe(3);
  });
});

describe('pinsEqual', () => {
  it('compares by value, ignoring key order', () => {
    expect(
      pinsEqual(
        { a: { x: 1, y: 2 }, b: { x: 3, y: 4 } },
        { b: { x: 3, y: 4 }, a: { x: 1, y: 2 } },
      ),
    ).toBe(true);
  });

  it('detects a coordinate change, a missing key, and an extra key', () => {
    const base = { a: { x: 1, y: 2 } };
    expect(pinsEqual(base, { a: { x: 1, y: 3 } })).toBe(false);
    expect(pinsEqual(base, {})).toBe(false);
    expect(pinsEqual(base, { a: { x: 1, y: 2 }, b: { x: 0, y: 0 } })).toBe(false);
  });

  it('treats two empty sets as equal', () => {
    expect(pinsEqual({}, {})).toBe(true);
  });
});
