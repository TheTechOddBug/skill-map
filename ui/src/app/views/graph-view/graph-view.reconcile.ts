/**
 * Pure reconciliation helpers for graph-view persistence.
 *
 * Two responsibilities extracted from constructor effects so the
 * branching logic is unit-testable in isolation:
 *
 *   - `reconcileExpandedIds` — drop expanded ids whose nodes were
 *     deleted from disk. Without this, a stale id persisted to
 *     localStorage would re-mark a freshly-recreated node as expanded.
 *
 *   - `reconcileNodePositions` — three-way merge against the loaded
 *     set: keep current pins, drop deletions, place newly-loaded
 *     nodes (cold-start reuses the auto-layout cache; incremental
 *     pins existing + settles missing via `computeIncrementalPositions`).
 *
 * Both return `{ next, dirty }`. The caller writes only when `dirty`
 * is true, which both avoids storage churn AND prevents the host
 * effect from looping when reading `nodePositions` / `expandedNodeIds`.
 */

import {
  computeIncrementalPositions,
  type IFullLayout,
  type IGraphEdge,
  type TNodePositions,
} from './graph-layout';

export interface IReconcileResult<T> {
  next: T;
  dirty: boolean;
}

/**
 * Filter `current` down to the ids present in `allPaths`. Returns the
 * input set unchanged (and `dirty: false`) when nothing was dropped,
 * so the caller can skip both the signal write and the storage write.
 */
export function reconcileExpandedIds(
  current: ReadonlySet<string>,
  allPaths: ReadonlySet<string>,
): IReconcileResult<ReadonlySet<string>> {
  if (current.size === 0) return { next: current, dirty: false };
  let dirty = false;
  const filtered = new Set<string>();
  for (const id of current) {
    if (allPaths.has(id)) filtered.add(id);
    else dirty = true;
  }
  return { next: dirty ? filtered : current, dirty };
}

/**
 * Reconcile pinned positions against the loaded node set:
 *   - Drop entries for nodes that no longer exist.
 *   - For newly-loaded nodes, fall through to cold-start (reuse the
 *     auto-layout cache when the pin map is empty) or incremental
 *     (settle the missing ones around the pinned set).
 *
 * `nodes` is the loaded list (passed through to
 * `computeIncrementalPositions` for the d3-force adapter). `layout`
 * is the cached full simulation result. Returns `{ next, dirty }`;
 * `dirty: false` lets the caller skip the storage write.
 */
export function reconcileNodePositions(input: {
  nodes: readonly { path: string }[];
  current: TNodePositions;
  layout: IFullLayout;
  edges: readonly IGraphEdge[];
}): IReconcileResult<TNodePositions> {
  const { nodes, current, layout, edges } = input;
  const allPaths = new Set(nodes.map((n) => n.path));
  let dirty = false;
  const next: TNodePositions = { ...current };

  // (3) Drop positions for nodes that no longer exist.
  for (const id of Object.keys(next)) {
    if (allPaths.has(id)) continue;
    delete next[id];
    dirty = true;
  }

  // (1 / 2) Identify newly-loaded nodes and place them.
  const missing: string[] = [];
  for (const path of allPaths) {
    if (!(path in next)) missing.push(path);
  }

  if (missing.length > 0) {
    if (Object.keys(next).length === 0) {
      // Cold start — nothing pinned. Reuse the cached full sim.
      for (const path of missing) {
        const pos = layout.positions.get(path);
        if (pos) next[path] = { x: pos.x, y: pos.y };
      }
    } else {
      // Incremental — pin existing, settle the new ones around them.
      const placed = computeIncrementalPositions(nodes, edges, next, missing);
      for (const path of missing) {
        const pos = placed.get(path);
        if (pos) next[path] = pos;
      }
    }
    dirty = true;
  }

  return { next, dirty };
}
