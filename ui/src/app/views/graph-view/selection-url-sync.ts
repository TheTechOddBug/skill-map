/**
 * Two-way bridge between the graph-view's `selectedNodeId` signal and
 * the URL `?path=…` query param.
 *
 *   - Reader: query param changes propagate to the selection (a deep
 *     link or a navigation from list-view both land here).
 *   - Writer: selection changes mirror back into the URL so the
 *     panel's open/closed state survives a refresh and is shareable.
 *
 * The two effects would loop unless guarded: reader sets selection,
 * writer pushes URL, reader fires again. The loop is broken by
 * comparing the deep-link path against the path of the currently
 * selected node BEFORE writing, when they already agree, the side
 * with the comparison is a no-op. Reads of the "other" signal in
 * each effect use `untracked()` so neither effect subscribes to the
 * signal the other one writes.
 *
 * Lives outside `graph-view.ts` so the loop-guard contract is
 * documented in one place; the component owns the signals + lookup
 * but does not have to host the wiring.
 */

import { effect, untracked, type Signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';

import type { IGraphNode } from './graph-layout';

export interface ISelectionUrlSyncConfig {
  /** Source of the active selection's path string (computed in the
   *  component). `undefined` when nothing is selected. */
  selectedPath: Signal<string | undefined>;
  /** Component's writable selection. Reader effect calls this to
   *  align the selection with the URL. */
  setSelectedNodeId: (id: string | null) => void;
  /** Current selection id, read via `untracked()` inside the reader
   *  effect to break the reader/writer loop. */
  readSelectedNodeId: () => string | null;
  /** Snapshot of the rendered graph nodes, the reader uses it to
   *  resolve a URL path back to a node id. */
  graphNodes: Signal<readonly IGraphNode[]>;
  router: Router;
  route: ActivatedRoute;
}

/**
 * Wire the two effects. Must be called from a context where
 * `effect()` can be created (typically the component constructor).
 */
export function bindSelectionToUrl(config: ISelectionUrlSyncConfig): void {
  const {
    selectedPath,
    setSelectedNodeId,
    readSelectedNodeId,
    graphNodes,
    router,
    route,
  } = config;

  const deepLinkPath = toSignal(
    route.queryParamMap.pipe(map((m) => m.get('path'))),
    { initialValue: route.snapshot.queryParamMap.get('path') },
  );

  // Reader: URL → selection.
  effect(() => {
    const path = deepLinkPath();
    const nodes = graphNodes();
    if (nodes.length === 0) return;
    if (!path) {
      // The URL has no `path`. The writer effect keeps the URL in sync
      // when the selection clears; don't clear here, or a refresh on a
      // deep-link would clear before the reader has matched the URL
      // to a node.
      return;
    }
    // Loop guard: read the current selection via `untracked` so this
    // effect does NOT subscribe to `selectedNodeId`. Otherwise a
    // close-panel call (which clears selection BEFORE the writer
    // effect has cleared the URL) re-fires this reader with the stale
    // URL path and immediately re-selects the node we just closed.
    const currentId = untracked(() => readSelectedNodeId());
    if (currentId !== null) {
      const currentNode = nodes.find((n) => n.id === currentId);
      // URL already matches the selection, reader is a no-op.
      if (currentNode?.view.path === path) return;
    }
    const target = nodes.find((n) => n.view.path === path);
    if (target) setSelectedNodeId(target.id);
  });

  // Writer: selection → URL.
  //   - `replaceUrl: true` keeps the back button focused on cross-route
  //     transitions instead of stuttering through every node-selection
  //     change.
  //   - `queryParamsHandling: 'merge'` preserves any other query
  //     params (filter sync etc.) that may live alongside `path`.
  effect(() => {
    const path = selectedPath();
    // Untracked: the writer must fire only when the selection changes,
    // not when the URL changes (reader's job). Tracking `deepLinkPath`
    // here would make the writer ping-pong with the reader on every
    // navigation.
    const currentInUrl = untracked(() => deepLinkPath());
    if ((path ?? null) === (currentInUrl ?? null)) return;
    void router.navigate([], {
      relativeTo: route,
      queryParams: { path: path ?? null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  });
}
