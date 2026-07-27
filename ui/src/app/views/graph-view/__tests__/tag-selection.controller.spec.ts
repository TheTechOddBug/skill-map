import { describe, expect, it } from 'vitest';
import { signal } from '@angular/core';

import { setupTagSelection } from '../tag-selection.controller';
import type { INodeView } from '../../../../models/node';
import type { TOverrideMap, TVisibilityOverride } from '../../../../services/map-overrides';

/**
 * Tag-selection controller. Clicking a tag curates the map to the nodes
 * carrying it (the rest hide) via `mapVisibility.setOnly`; clicking the
 * active tag again restores the curation that was in effect before. Pure
 * state machine, no Angular component, so it tests as a plain function.
 */

function node(path: string, tags: string[]): INodeView {
  return {
    path,
    kind: 'agent',
    frontmatter: { name: path, description: '' },
    sidecar: { present: true, status: 'fresh', annotations: { tags } },
  };
}

/** Minimal stand-in for `MapVisibilityService` (just the members the
 *  controller touches), backed by a real signal so the Pick type fits.
 *  `current()` reports the include-override paths, sorted, mirroring
 *  what `setOnly(paths)` writes (root-exclude + includes). */
function makeMapVisibility(initial: string[] = []) {
  const seed = new Map<string, TVisibilityOverride>();
  for (const p of initial) seed.set(p, 'include');
  if (initial.length > 0) seed.set('', 'exclude');
  const overrides = signal<TOverrideMap>(seed);
  const setOnly = (p: Iterable<string>): void => {
    const next = new Map<string, TVisibilityOverride>();
    for (const path of p) if (path.length > 0) next.set(path, 'include');
    if (next.size > 0) next.set('', 'exclude');
    overrides.set(next);
  };
  return {
    overrides,
    setOnly,
    setOverrides: (m: TOverrideMap): void => overrides.set(new Map(m)),
    current: (): string[] =>
      [...overrides().entries()]
        .filter(([, kind]) => kind === 'include')
        .map(([path]) => path)
        .sort(),
  };
}

const NODES = signal<INodeView[]>([
  node('a.md', ['infra']),
  node('b.md', ['infra', 'review']),
  node('c.md', ['review']),
]);

describe('setupTagSelection', () => {
  it('curates the map to the tagged nodes and marks the tag active', () => {
    const mv = makeMapVisibility();
    const h = setupTagSelection({ nodes: NODES, mapVisibility: mv });

    h.onTagSelect('infra');

    expect(mv.current()).toEqual(['a.md', 'b.md']);
    expect(h.activeTagSelection()).toBe('infra');
  });

  it('restores "show all" (empty curation) when the active tag is toggled off', () => {
    const mv = makeMapVisibility();
    const h = setupTagSelection({ nodes: NODES, mapVisibility: mv });

    h.onTagSelect('infra');
    h.onTagSelect('infra'); // toggle off

    expect(mv.overrides().size).toBe(0); // empty == show all
    expect(h.activeTagSelection()).toBeNull();
  });

  it('restores the pre-tag curation snapshot on toggle off', () => {
    const mv = makeMapVisibility(['a.md', 'c.md']); // a manual curation was active
    const h = setupTagSelection({ nodes: NODES, mapVisibility: mv });

    h.onTagSelect('infra');
    expect(mv.current()).toEqual(['a.md', 'b.md']);

    h.onTagSelect('infra'); // toggle off
    expect(mv.current()).toEqual(['a.md', 'c.md']); // back to the prior curation
  });

  it('keeps the original snapshot across tag-to-tag swaps', () => {
    const mv = makeMapVisibility(); // show all
    const h = setupTagSelection({ nodes: NODES, mapVisibility: mv });

    h.onTagSelect('infra'); // {a, b}
    h.onTagSelect('review'); // swap -> {b, c}
    expect(mv.current()).toEqual(['b.md', 'c.md']);
    expect(h.activeTagSelection()).toBe('review');

    h.onTagSelect('review'); // toggle off -> restore the ORIGINAL (show all)
    expect(mv.overrides().size).toBe(0);
    expect(h.activeTagSelection()).toBeNull();
  });

  it('is a no-op for a tag no node carries (curation untouched)', () => {
    const mv = makeMapVisibility(['a.md']);
    const h = setupTagSelection({ nodes: NODES, mapVisibility: mv });

    h.onTagSelect('does-not-exist');

    expect(mv.current()).toEqual(['a.md']); // unchanged
    expect(h.activeTagSelection()).toBeNull();
  });
});
