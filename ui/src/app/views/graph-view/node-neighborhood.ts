/**
 * 1-hop neighborhood over an undirected adjacency map.
 *
 * Given the neighbor sets built from the graph's edges (see the
 * `fullAdjacency` computed in `graph-view.ts`), returns `start` PLUS its
 * direct neighbors (one hop, in or out), and nothing further. Drives the
 * "isolate" gesture: focus the map on a node and the things it links to.
 *
 * Deliberately NOT the transitive connected component: in a connected
 * graph the whole component IS the entire graph, so isolating any node
 * would show everything and read as a no-op (it just selects the node).
 * One hop always narrows to a meaningful neighborhood. Pure, no DOM, no
 * signals, so it is trivially unit-testable.
 */
export function directNeighborhood(
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
  start: string,
): Set<string> {
  const neighborhood = new Set<string>([start]);
  for (const neighbor of adjacency.get(start) ?? []) {
    neighborhood.add(neighbor);
  }
  return neighborhood;
}
