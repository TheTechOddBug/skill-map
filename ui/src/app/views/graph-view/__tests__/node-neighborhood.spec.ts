/**
 * `directNeighborhood`, 1-hop neighbor lookup over a neighbor-set
 * adjacency map.
 *
 * Pure module, no Angular / DOM, so it tests as a plain function. Covers:
 * isolated start, the direct neighbors only (NOT transitive), branching
 * hub, and a start absent from the adjacency map. The key property is
 * that 2-hop nodes are excluded, which is what makes "isolate" narrow a
 * connected graph instead of returning everything.
 */

import { describe, expect, it } from 'vitest';

import { directNeighborhood } from '../node-neighborhood';

/** Build an undirected adjacency map from edge pairs (both directions). */
function adjacency(edges: ReadonlyArray<readonly [string, string]>): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const link = (a: string, b: string): void => {
    let set = map.get(a);
    if (!set) {
      set = new Set<string>();
      map.set(a, set);
    }
    set.add(b);
  };
  for (const [a, b] of edges) {
    link(a, b);
    link(b, a);
  }
  return map;
}

/** Sorted member array, so assertions are order-independent. */
function members(set: Set<string>): string[] {
  return [...set].sort();
}

describe('directNeighborhood', () => {
  it('returns just {start} for an isolated node with an empty neighbor set', () => {
    const map = new Map<string, Set<string>>([['A', new Set<string>()]]);
    expect(members(directNeighborhood(map, 'A'))).toEqual(['A']);
  });

  it('returns the start plus its direct neighbors only, NOT 2-hop nodes', () => {
    const map = adjacency([
      ['A', 'B'],
      ['B', 'C'], // C is two hops from A
    ]);
    // From A: only A and B. C (transitively reachable) is excluded.
    expect(members(directNeighborhood(map, 'A'))).toEqual(['A', 'B']);
    // From the middle: B touches both A and C.
    expect(members(directNeighborhood(map, 'B'))).toEqual(['A', 'B', 'C']);
  });

  it('returns a hub plus all its direct leaves, but not the leaves of leaves', () => {
    const map = adjacency([
      ['A', 'B'],
      ['A', 'C'],
      ['C', 'D'], // D is two hops from A
    ]);
    expect(members(directNeighborhood(map, 'A'))).toEqual(['A', 'B', 'C']);
  });

  it('returns just {start} when the start node is absent from the adjacency map', () => {
    const map = adjacency([['A', 'B']]);
    expect(members(directNeighborhood(map, 'orphan'))).toEqual(['orphan']);
  });
});
