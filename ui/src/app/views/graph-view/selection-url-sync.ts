/**
 * Two-way bridge between the graph-view's `selectedNodeId` signal and
 * the URL `?path=…` query param.
 *
 *   - Reader: query param changes propagate to the selection (a deep
 *     link or a navigation from files-view both land here).
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

/**
 * Minimal structural slice of a graph node this sync reads: the node
 * id and the path it maps to in the URL. Deliberately NOT `IGraphNode`,
 * the caller feeds a lightweight `{ id, view.path }` projection (see
 * `graph-view.ts`), and typing the full node here would force a cast
 * that silently narrows 80% of the fields away. If the sync ever needs
 * another field, widen THIS interface and the compiler walks every
 * caller.
 */
export interface ISelectionSyncNode {
  readonly id: string;
  readonly view: { readonly path: string };
}

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
  graphNodes: Signal<readonly ISelectionSyncNode[]>;
  /**
   * Fired ONLY by the reader when a `?path=` deep link (e.g. the
   * "open in map" navigation from the files view) resolves to a node
   * and moves the selection there. NOT fired for in-map node clicks,
   * those set the selection directly and feed the writer, never the
   * reader. The graph view uses this to pan the camera onto the node
   * (centering), which would be intrusive on every in-map click.
   */
  onDeepLinkSelect?: (nodeId: string) => void;
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
    onDeepLinkSelect,
    router,
    route,
  } = config;

  const deepLinkPath = toSignal(
    route.queryParamMap.pipe(map((m) => m.get('path'))),
    { initialValue: route.snapshot.queryParamMap.get('path') },
  );

  // Reader: URL → selection.
  //
  // A `?path=` is an INSTRUCTION to honour once ("select this"), not a
  // state to re-apply forever. That distinction matters because this
  // effect also depends on `graphNodes`, which changes for reasons that
  // have nothing to do with the URL (a re-layout, a WS push, a filter).
  //
  // The race it closes: arriving on a deep link, the first run has the
  // path but an EMPTY node list, so it cannot resolve it yet and has to
  // wait. If the user closes the panel before the nodes land, the next
  // `graphNodes` change re-runs this effect, the URL still carries the
  // old path (the writer's `router.navigate` is async), and the node
  // the user just closed gets re-selected. `untracked` on the selection
  // does not help, the effect was woken by the nodes, not the
  // selection; and invalidating from the writer does not either, since
  // effects run in creation order and this one runs FIRST.
  //
  // So a pending path is tagged with the selection it was armed
  // against. If the selection has moved since, the deep link lost its
  // mandate and is dropped rather than applied late.
  // Last path the WRITER pushed into the URL, awaiting its own
  // query-param change to come back around. See both effects below.
  let echoedPath: string | null = null;
  let seenUrlPath: string | null | undefined;
  let pendingPath: string | null = null;
  let armedAtSelection: string | null = null;
  effect(() => {
    const path = deepLinkPath() ?? null;
    const nodes = graphNodes();
    // Tagged with the raw selection ID, NOT `selectedPath`: that one
    // resolves the id against `graphNodes` and so reads `undefined`
    // during the exact window this guard exists for, the one where the
    // nodes have not loaded. Comparing it would compare null to null
    // and never fire.
    const currentSelection = untracked(() => readSelectedNodeId());
    if (path !== seenUrlPath && path !== null && path === echoedPath) {
      // The writer put this path there; it is our own reflection, not an
      // instruction. Swallow it. Without this the reader cannot tell an
      // echo from a deep link whenever it did not happen to run while
      // the selection was still set, and it then "restores" a selection
      // the user has already cleared.
      seenUrlPath = path;
      echoedPath = null;
      return;
    }
    if (path !== seenUrlPath) {
      // A real navigation landed (deep link, files-view "open in map"):
      // re-arm against today's selection.
      seenUrlPath = path;
      pendingPath = path;
      armedAtSelection = currentSelection;
    } else if (pendingPath !== null && currentSelection !== armedAtSelection) {
      // The app moved the selection while this path was still waiting
      // for nodes to resolve against. Whatever the URL still says, the
      // user's last action wins.
      pendingPath = null;
    }
    // Nothing to honour, or nothing to resolve it against yet. An
    // absent path never CLEARS the selection: the writer owns that
    // direction, and clearing here would drop a deep link on refresh
    // before the nodes have loaded.
    if (pendingPath === null || nodes.length === 0) return;
    // Loop guard: read the current selection via `untracked` so this
    // effect does NOT subscribe to it, the writer side feeds it.
    const currentId = untracked(() => readSelectedNodeId());
    if (currentId !== null) {
      const currentNode = nodes.find((n) => n.id === currentId);
      // URL already matches the selection (an in-map click the writer
      // mirrored out): consume it without re-selecting, and WITHOUT
      // firing `onDeepLinkSelect`, which would yank the camera on every
      // click.
      if (currentNode?.view.path === pendingPath) {
        pendingPath = null;
        return;
      }
    }
    const target = nodes.find((n) => n.view.path === pendingPath);
    if (target) {
      pendingPath = null;
      setSelectedNodeId(target.id);
      onDeepLinkSelect?.(target.id);
    }
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
    // Claim this value before navigating so the reader recognises the
    // resulting query-param change as our own echo rather than a fresh
    // deep link. Only a non-null path needs claiming: an absent `path`
    // never makes the reader select anything.
    echoedPath = path ?? null;
    void router.navigate([], {
      relativeTo: route,
      queryParams: { path: path ?? null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  });
}
