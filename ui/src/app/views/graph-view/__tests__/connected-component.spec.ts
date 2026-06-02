/**
 * `connectedComponent`, undirected BFS over a neighbor-set adjacency map.
 *
 * Pure module, no Angular / DOM, so it tests as a plain function. Covers:
 * isolated start, linear chain, branching, a cycle (termination), two
 * disconnected components (only the start's), and a start absent from the
 * adjacency map.
 */

import { describe, expect, it } from 'vitest';

import { connectedComponent } from '../connected-component';

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

describe('connectedComponent', () => {
  it('returns just {start} for an isolated node with an empty neighbor set', () => {
    const map = new Map<string, Set<string>>([['A', new Set<string>()]]);
    expect(members(connectedComponent(map, 'A'))).toEqual(['A']);
  });

  it('walks a linear chain A-B-C end to end', () => {
    const map = adjacency([
      ['A', 'B'],
      ['B', 'C'],
    ]);
    expect(members(connectedComponent(map, 'A'))).toEqual(['A', 'B', 'C']);
    // Same component reached from the middle and the tail.
    expect(members(connectedComponent(map, 'B'))).toEqual(['A', 'B', 'C']);
    expect(members(connectedComponent(map, 'C'))).toEqual(['A', 'B', 'C']);
  });

  it('walks a branching graph (a hub with several leaves)', () => {
    const map = adjacency([
      ['A', 'B'],
      ['A', 'C'],
      ['C', 'D'],
      ['C', 'E'],
    ]);
    expect(members(connectedComponent(map, 'A'))).toEqual(['A', 'B', 'C', 'D', 'E']);
    // A leaf still reaches the whole component (undirected).
    expect(members(connectedComponent(map, 'D'))).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('terminates on a cycle and returns every node once', () => {
    const map = adjacency([
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'A'],
    ]);
    const result = connectedComponent(map, 'A');
    expect(members(result)).toEqual(['A', 'B', 'C']);
    expect(result.size).toBe(3); // no duplicate visits, no infinite loop
  });

  it('returns only the start node component for a graph with two disconnected components', () => {
    const map = adjacency([
      // component 1
      ['A', 'B'],
      ['B', 'C'],
      // component 2 (disjoint)
      ['X', 'Y'],
      ['Y', 'Z'],
    ]);
    expect(members(connectedComponent(map, 'A'))).toEqual(['A', 'B', 'C']);
    expect(members(connectedComponent(map, 'X'))).toEqual(['X', 'Y', 'Z']);
  });

  it('returns just {start} when the start node is absent from the adjacency map', () => {
    const map = adjacency([['A', 'B']]);
    expect(members(connectedComponent(map, 'orphan'))).toEqual(['orphan']);
  });
});
