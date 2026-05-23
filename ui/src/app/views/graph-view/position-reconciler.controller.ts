/**
 * Position-reconciler controller for `<sm-graph-view>`.
 *
 * Reconciles the cached `nodePositions` map against the latest dagre /
 * force output every time the loaded node set or the layout signal
 * changes:
 *
 *   1. Adds the dagre position for any node missing from the cache so
 *      newly-extracted nodes paint at the dagre slot instead of (0, 0).
 *   2. Drops cache entries whose node id is no longer in the loaded
 *      set, keeping localStorage from accumulating ghost positions for
 *      deleted files.
 *   3. Persists the reconciled map to localStorage exactly once per
 *      cycle, gated by the helper's `dirty` flag so a no-op reconcile
 *      does not thrash storage.
 *
 * Extracted from the `graph-view.ts` constructor to keep the component
 * a thin orchestrator and let the reconcile contract sit next to the
 * other graph controllers (`expansion`, `node-drag`, `layout-fit`,
 * `viewport-store`).
 */

import { effect } from '@angular/core';
import type { Signal, WritableSignal } from '@angular/core';

import type { INodeView } from '../../../models/node';
import { reconcileNodePositions } from './graph-view.reconcile';
import type { IFullLayout, TNodePositions } from './graph-layout';

export interface IPositionReconcilerConfig {
  /** Loaded node set; signals trigger reconciliation when it changes. */
  nodes: Signal<readonly INodeView[]>;
  /** Latest dagre / force layout output. */
  fullLayout: Signal<IFullLayout>;
  /** Cached map keyed by `node.path`; written in-place on every dirty cycle. */
  nodePositions: WritableSignal<TNodePositions>;
  /** Callback fired with the new map AFTER signal update; persist + side effects here. */
  onPersist: (next: TNodePositions) => void;
}

/**
 * Wires the reconciliation effect. The handle is returned for symmetry
 * with the other graph controllers (today nothing else is exposed; the
 * caller just keeps the reference for cleanup-by-context).
 */
export function setupPositionReconciler(config: IPositionReconcilerConfig): {
  readonly reconcileEffect: ReturnType<typeof effect>;
} {
  const reconcileEffect = effect(() => {
    const nodes = config.nodes();
    if (nodes.length === 0) return;
    const layout = config.fullLayout();
    if (layout.positions.size === 0) return; // dagre hasn't run yet
    const result = reconcileNodePositions({
      nodes,
      current: config.nodePositions(),
      layout,
    });
    if (!result.dirty) return;
    config.nodePositions.set(result.next);
    config.onPersist(result.next);
  });

  return { reconcileEffect };
}
