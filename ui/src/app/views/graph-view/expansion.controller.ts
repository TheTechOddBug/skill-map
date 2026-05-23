/**
 * Card-expansion state machine for the graph view. Owns the
 * `expandedNodeIds` signal (persisted to localStorage by the
 * `setExpanded` writer + the boot reader), the per-id is/set
 * predicates the template binds, and the GC effect that drops stale
 * ids when the underlying file is deleted.
 *
 * Extracted from `graph-view.ts` so the view component focuses on
 * graph rendering + selection + filter concerns. Mirrors the
 * `inspector-body-state` helper pattern: a `setupX` factory returns
 * a small handle the component captures in its constructor.
 */

import { effect, signal, type Signal } from '@angular/core';

import type { INodeView } from '../../../models/node';
import { reconcileExpandedIds } from './graph-view.reconcile';
import { readStoredExpanded, writeStoredExpanded } from './graph-view.storage';

export interface IExpansionConfig {
  /** Full loaded node list. Drives the GC effect. */
  nodes: Signal<readonly INodeView[]>;
}

export interface IExpansionHandle {
  isExpanded(id: string): boolean;
  setExpanded(id: string, value: boolean): void;
  /**
   * Clear every expanded id. Called from `resetLayout()` so the
   * "reset" affordance also collapses every open card.
   */
  resetAll(): void;
  /**
   * Live set of expanded node ids. Exposed so the graph view can bake
   * `expanded: boolean` into the per-node projection without N calls
   * to `isExpanded(id)` per CD pass.
   */
  readonly expandedNodeIds: Signal<ReadonlySet<string>>;
}

export function setupExpansion(config: IExpansionConfig): IExpansionHandle {
  const expandedNodeIds = signal<ReadonlySet<string>>(readStoredExpanded());

  // Garbage-collect `expandedNodeIds` against the current loaded set.
  // Without this, an id that was expanded in a previous session and
  // persisted to localStorage stays in the set forever, even after
  // the file behind it is deleted. The empty-array case (initial
  // boot before the first scan resolves) is skipped so we don't wipe
  // the set during the loading phase. Pure reconcile in
  // `graph-view.reconcile.ts#reconcileExpandedIds`.
  effect(() => {
    const allPaths = new Set(config.nodes().map((n) => n.path));
    if (allPaths.size === 0) return;
    const result = reconcileExpandedIds(expandedNodeIds(), allPaths);
    if (!result.dirty) return;
    expandedNodeIds.set(result.next);
    writeStoredExpanded(result.next);
  });

  const isExpanded = (id: string): boolean => expandedNodeIds().has(id);

  const setExpanded = (id: string, value: boolean): void => {
    const current = expandedNodeIds();
    if (current.has(id) === value) return;
    const next = new Set(current);
    if (value) next.add(id);
    else next.delete(id);
    expandedNodeIds.set(next);
    writeStoredExpanded(next);
  };

  const resetAll = (): void => {
    expandedNodeIds.set(new Set());
    writeStoredExpanded(new Set());
  };

  return { isExpanded, setExpanded, resetAll, expandedNodeIds };
}
