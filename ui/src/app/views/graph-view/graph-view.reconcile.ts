/**
 * Pure reconciliation helpers for graph-view persistence.
 *
 * Two responsibilities extracted from constructor effects so the
 * branching logic is unit-testable in isolation:
 *
 *   - `reconcileExpandedIds`, drop expanded ids whose nodes were
 *     deleted from disk. Without this, a stale id persisted to
 *     localStorage would re-mark a freshly-recreated node as expanded.
 *
 *   - `reconcileNodePositions`, three-way merge against the loaded
 *     set: keep current pins, drop deletions, place newly-loaded
 *     nodes by reading the latest dagre layout for the missing ids.
 *
 * Both return `{ next, dirty }`. The caller writes only when `dirty`
 * is true, which both avoids storage churn AND prevents the host
 * effect from looping when reading `nodePositions` / `expandedNodeIds`.
 */

import type { INodeView } from '../../../models/node';
import {
  type IFullLayout,
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
 *   - For newly-loaded nodes, read the latest dagre output for the
 *     missing ids and pin them. Both the cold-start case (no pins yet)
 *     and the incremental case (a node was added to an existing set)
 *     funnel through the same lookup, dagre re-lays out the entire
 *     graph on every topology / preference change, so the freshest
 *     positions for missing ids are always in `layout.positions`.
 *
 * Returns `{ next, dirty }`; `dirty: false` lets the caller skip the
 * storage write.
 */
export function reconcileNodePositions(input: {
  nodes: readonly INodeView[];
  current: TNodePositions;
  layout: IFullLayout;
}): IReconcileResult<TNodePositions> {
  const { nodes, current, layout } = input;
  const allPaths = new Set(nodes.map((n) => n.path));
  let dirty = false;
  const next: TNodePositions = { ...current };

  // Drop positions for nodes that no longer exist.
  for (const id of Object.keys(next)) {
    if (allPaths.has(id)) continue;
    delete next[id];
    dirty = true;
  }

  // Pin newly-loaded nodes against the latest dagre output.
  const missing: string[] = [];
  for (const path of allPaths) {
    if (!(path in next)) missing.push(path);
  }

  // Only mark dirty when we ACTUALLY add a position. Setting dirty
  // for "had missing ids" even when `layout.positions` doesn't yet
  // know about them (e.g. dagre is still mid-flight for a fresh WS
  // rename) loops: the host effect writes a new `{ ...current }` ref
  // with identical content, the signal write re-fires the same
  // effect, missing stays unresolved, repeat. The runaway pegs CPU
  // at 100%+ until dagre finally emits.
  for (const path of missing) {
    const pos = layout.positions.get(path);
    if (!pos) continue;
    next[path] = { x: pos.x, y: pos.y };
    dirty = true;
  }

  return { next, dirty };
}
