/**
 * Connected-component traversal over an undirected adjacency map.
 *
 * Given the neighbor sets built from the graph's edges (see the
 * `fullAdjacency` computed in `graph-view.ts`, which mirrors the pattern in
 * `selection-state.ts`), returns every node path transitively reachable
 * from `start`, INCLUDING `start` itself. Drives the "isolate chain"
 * gesture: the whole link-chain a node belongs to. Pure, no DOM, no
 * signals, so it is trivially unit-testable.
 */
export function connectedComponent(
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
  start: string,
): Set<string> {
  const seen = new Set<string>([start]);
  const queue: string[] = [start];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    const neighbors = adjacency.get(current);
    if (!neighbors) continue;
    for (const next of neighbors) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}
