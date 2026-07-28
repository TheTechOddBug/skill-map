/**
 * Pure derivation chain for the graph view: from the loader's node /
 * scan signals down to the `graph` data the canvas @for renders, plus
 * the perf-HUD counters and the connector-side resolution. Owns the
 * layout-position signals the async dagre effect fills; carries NO
 * side effects of its own (the dagre effect that WRITES
 * `layoutPositions` stays in the component's constructor, where it can
 * thread the camera + preference concerns).
 *
 * Extracted from `graph-view.ts` so the view component focuses on
 * selection + camera + overlay orchestration. Mirrors the
 * `inspector-body-state` helper pattern: a `setupX` factory returns
 * a handle the component captures in a field initializer. Everything
 * here is a `computed` (or a writable signal the host's layout effect
 * drives), so the factory needs no injection context and no cleanup.
 */

import { computed, signal, type Signal, type WritableSignal } from '@angular/core';
import type { EFConnectionConnectableSide } from '@foblex/flow';

import type { INodeView } from '../../../models/node';
import type { IScanResultApi, TLinkKindApi } from '../../../models/api';
import type { FilterStoreService } from '../../../services/filter-store';
import type { IIssuePathsBySeverity } from '../../../services/issue-paths';
import { resolveConnectionSides, type IConnectionSides } from './connection-sides';
import {
  projectVisible,
  resolveTopology,
  type IFullLayout,
  type IGraphData,
  type IPoint,
  type ITopology,
  type TNodePositions,
} from './graph-layout';
import type { TLayoutAlgorithm, TLayoutDirection } from './layout-controls';

export interface IGraphPipelineConfig {
  /** Loaded node views (branch-scoped), `loader.nodes` in the host. */
  nodes: Signal<INodeView[]>;
  /** Branch-scoped scan payload (links + API node rows), `loader.scan`. */
  scan: Signal<IScanResultApi | null>;
  /** Facet filter store: visible-set projection + link-kind whitelist. */
  filters: Pick<
    FilterStoreService,
    'apply' | 'searchAffectsMap' | 'selectedLinkKinds' | 'linkKindToggleExplicitEmpty'
  >;
  /** Issue index feeding the severity palette toggles. */
  issuesBySeverity: Signal<IIssuePathsBySeverity>;
  /** User-pinned drag positions (host-owned), layered over dagre output. */
  nodePositions: Signal<TNodePositions>;
  /** Layout preferences driving the connector-side resolution. */
  layoutAlgorithm: Signal<TLayoutAlgorithm>;
  layoutDirection: Signal<TLayoutDirection>;
}

export interface IGraphPipelineHandle {
  readonly visibleNodes: Signal<INodeView[]>;
  readonly topology: Signal<ITopology>;
  /**
   * Dagre output, top-left positions keyed by node path. Writable:
   * filled by the async layout effect in the host's constructor.
   * Initially empty: nodes render at (0, 0) until dagre resolves, the
   * first frame of the boot tween hides this via `fitToScreen`.
   */
  readonly layoutPositions: WritableSignal<Map<string, IPoint>>;
  /** `performance.now()` timestamp of the last dagre run; exposed to the perf HUD. */
  readonly layoutComputedAtSignal: WritableSignal<number>;
  readonly fullLayout: Signal<IFullLayout>;
  readonly mapVisiblePaths: Signal<Set<string>>;
  readonly graph: Signal<IGraphData>;
  readonly fullAdjacency: Signal<Map<string, Set<string>>>;
  /** Counters / timestamp exposed to the perf HUD. Pure derivations. */
  readonly visibleCount: Signal<number>;
  readonly totalCount: Signal<number>;
  readonly edgeCount: Signal<number>;
  readonly layoutComputedAt: Signal<number>;
  readonly connectionSides: Signal<IConnectionSides>;
  readonly inputSide: Signal<EFConnectionConnectableSide>;
  readonly outputSide: Signal<EFConnectionConnectableSide>;
  readonly pathsFingerprint: Signal<string>;
}

export function setupGraphPipeline(config: IGraphPipelineConfig): IGraphPipelineHandle {
  /**
   * Visible node set. Delegates everything to `FilterStoreService.apply`,
   * passing the `IssuePathsService.bySeverity` index so the severity
   * palette toggles work end-to-end. AND semantics across tiers (both
   * on means a node must carry at least one error AND at least one
   * warn) lives inside `apply()`; the view only feeds the context.
   *
   * The TEXT search only participates when the search → map coupling
   * is on (`searchAffectsMap`, the toggle next to the rail's search
   * input), which it is by default: the map narrows on the query
   * alongside the files rail. Turn the toggle off to keep the map
   * layout while only the files rail narrows.
   */
  const visibleNodes = computed(() =>
    config.filters.apply(config.nodes(), config.issuesBySeverity(), {
      includeSearch: config.filters.searchAffectsMap(),
    }),
  );

  /**
   * Topology view: indexed lookups + the resolved edge set. Computed
   * synchronously, runs once per `loader.nodes()` / `loader.scan()`
   * change. Carries no positions, those live in `layoutPositions`
   * below and are filled asynchronously by the dagre effect.
   *
   * When a WebSocket `scan.completed` event makes the loader re-fetch
   * and replace `loader.nodes()` with a fresh array, this computed
   * re-runs but the topology fingerprint only changes when nodes are
   * added / removed / relinked. The downstream layout effect skips
   * the dagre call when the fingerprint + preferences combo matches
   * the last cache, so the viewport stays put and unmoved nodes do
   * not jump on every WS push.
   */
  const topology = computed(() => resolveTopology(config.nodes(), config.scan()));

  /**
   * Dagre output, top-left positions keyed by node path. Filled by the
   * async layout effect in the host's constructor. Initially empty:
   * nodes render at (0, 0) until dagre resolves, the first frame of
   * the boot tween hides this via `fitToScreen`.
   */
  const layoutPositions = signal<Map<string, IPoint>>(new Map());
  /** `performance.now()` timestamp of the last dagre run; exposed to the perf HUD. */
  const layoutComputedAtSignal = signal(0);

  /**
   * Combined topology + positions, the shape the renderer + reconcile
   * helpers consume. Kept as a computed so consumers stay reactive
   * across both topology changes and layout updates without bookkeeping.
   */
  const fullLayout = computed<IFullLayout>(() => ({
    ...topology(),
    positions: layoutPositions(),
    computedAt: layoutComputedAtSignal(),
  }));

  /**
   * Effective set of node paths the MAP shows: the facet-filtered set
   * (`visibleNodes`, shared with the rail) over the FETCHED branch union.
   * The map SELECTION is now applied server-side, the loader fetches the
   * union of the selected folder prefixes + leaf paths, so `branch()`
   * already IS the selected set; there is no client-side curation
   * intersection to layer on top. This stays the single chokepoint both
   * the canvas (`graph`) and the camera (`runAnimatedFit`) read so they
   * never disagree on what is visible.
   */
  const mapVisiblePaths = computed<Set<string>>(
    () => new Set(visibleNodes().map((n) => n.path)),
  );

  const graph = computed<IGraphData>(() => {
    const visibleIds = mapVisiblePaths();
    const linkKinds = config.filters.selectedLinkKinds();
    // An empty whitelist is ambiguous on its own: it is both the default
    // "no link filter" and the state left behind after the operator turns
    // the last link toggle off. The sticky flag disambiguates, an empty
    // Set hides every edge, `null` bypasses the filter.
    const visibleEdgeKinds = config.filters.linkKindToggleExplicitEmpty()
      ? new Set<TLinkKindApi>()
      : linkKinds.length > 0
        ? new Set(linkKinds)
        : null;
    return projectVisible(
      fullLayout(),
      visibleIds,
      config.nodePositions(),
      visibleEdgeKinds,
    );
  });

  /**
   * Undirected neighbor map over the FULL topology (not the currently
   * visible subset), built from `fullLayout().edges`. Mirrors the
   * `adjacency` computed in `selection-state.ts`, but unfiltered: the
   * isolate gesture must resolve a node's direct neighbors against the
   * full topology even when curation has narrowed the canvas down. Feeds
   * `isolateNeighborhood`.
   */
  const fullAdjacency = computed<Map<string, Set<string>>>(() => {
    const map = new Map<string, Set<string>>();
    const link = (a: string, b: string): void => {
      let set = map.get(a);
      if (!set) {
        set = new Set<string>();
        map.set(a, set);
      }
      set.add(b);
    };
    for (const edge of fullLayout().edges) {
      link(edge.from, edge.to);
      link(edge.to, edge.from);
    }
    return map;
  });

  /** Counters / timestamp exposed to the perf HUD. Pure derivations. */
  const visibleCount = computed(() => graph().nodes.length);
  const totalCount = computed(() => config.nodes().length);
  const edgeCount = computed(() => graph().edges.length);
  const layoutComputedAt = computed(() => layoutComputedAtSignal());

  /**
   * Connector sides per layout direction, fed into `<f-connection>`
   * via `[fOutputSide]` / `[fInputSide]` and into each `<div fNode>`
   * via `[fInputConnectableSide]` / `[fOutputConnectableSide]`.
   *
   * Same-element pattern (`fNodeInput` + `fNodeOutput` on the card
   * itself) means the connection geometry anchors to the card edge
   * matching the side string, no CSS positioning needed. Direction
   * table + force-layout fallback live in `./connection-sides`.
   */
  const connectionSides = computed(() =>
    resolveConnectionSides(config.layoutAlgorithm(), config.layoutDirection()),
  );
  const inputSide = computed(() => connectionSides().input);
  const outputSide = computed(() => connectionSides().output);

  /**
   * Fingerprint of the loaded path set (NOT edges). Drives the "auto-fit
   * when a node is added or removed" effect in `layout-fit.controller.ts`.
   * Edge-only topology changes (a new link extracted from an edited body,
   * or a link that disappeared) do NOT trip this fingerprint, the user
   * kept the same cards, just their wiring changed; jerking the viewport
   * for that would feel intrusive.
   */
  const pathsFingerprint = computed(() =>
    config.nodes().map((n) => n.path).sort().join('|'),
  );

  return {
    visibleNodes,
    topology,
    layoutPositions,
    layoutComputedAtSignal,
    fullLayout,
    mapVisiblePaths,
    graph,
    fullAdjacency,
    visibleCount,
    totalCount,
    edgeCount,
    layoutComputedAt,
    connectionSides,
    inputSide,
    outputSide,
    pathsFingerprint,
  };
}
