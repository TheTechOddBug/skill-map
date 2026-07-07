import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { ConfirmationService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { TooltipModule } from 'primeng/tooltip';
import {
  EFConnectionBehavior,
  EFConnectionConnectableSide,
  EFLayoutMode,
  EFMarkerType,
  EFZoomDirection,
  FCanvasComponent,
  FFlowComponent,
  FFlowModule,
  FVirtualFor,
  FZoomDirective,
  provideFLayout,
} from '@foblex/flow';
import type { FCanvasChangeEvent } from '@foblex/flow';
import { DagreLayoutEngine } from '@foblex/flow-dagre-layout';

import { GRAPH_VIEW_TEXTS } from '../../../i18n/graph-view.texts';
import { DEFAULT_SETTINGS } from '../../../models/settings';

import { CollectionLoaderService } from '../../../services/collection-loader';
import { FilterStoreService } from '../../../services/filter-store';
import { GraphPreferencesService } from '../../../services/graph-preferences';
import { IssuePathsService } from '../../../services/issue-paths';
import { LivePreferencesService } from '../../../services/live-preferences';
import { MapVisibilityService } from '../../../services/map-visibility';
import { AgentSpawnService } from '../../../services/agent-spawn';
import { NodeActivityService } from '../../../services/node-activity';
import { NodeActivityStatsService } from '../../../services/node-activity-stats';
import { DATA_SOURCE } from '../../../services/data-source/data-source.port';
import type { INodeActivityStatsApi } from '../../../models/api';
import { directNeighborhood } from './node-neighborhood';
import { resolveConnectionSides } from './connection-sides';
import { BranchCapBanner } from './branch-cap-banner/branch-cap-banner';
import { GraphLayoutToolbar } from './graph-layout-toolbar/graph-layout-toolbar';
import { ConversationDialog } from '../../components/conversation-dialog/conversation-dialog';
import { setupConversationDialog } from '../../components/conversation-dialog/conversation-dialog.controller';
import { KindPalette } from '../../components/kind-palette/kind-palette';
import { LinkKindPalette } from '../../components/link-kind-palette/link-kind-palette';
import { SessionNode } from '../../components/session-node/session-node';
import { SeverityPalette } from '../../components/severity-palette/severity-palette';
import { NodeCard } from '../../components/node-card/node-card';
import { PerfHud } from '../../components/perf-hud/perf-hud';
/* ViewContributionsHost: real graph.node.alert slot mount (also ringed by the kept debug-slots overlay; see context/ui.md). */
import { ViewContributionsHost } from '../../components/view-contributions-host/view-contributions-host';
import { DebugPerfService } from '../../services/debug-perf';
import { UsageTrackerService } from '../../services/usage-tracker';
import { InspectorView } from '../inspector-view/inspector-view';
import { MiddleMousePanDirective, type IMiddleMousePanTarget } from './middle-mouse-pan';
import {
  computeDagreLayout,
  computeForceLayoutPositions,
  projectVisible,
  resolveTopology,
  topologyFingerprint,
  type IFullLayout,
  type IGraphData,
  type IGraphEdge,
  type IGraphNode,
  type IPoint,
  type TNodePositions,
} from './graph-layout';
import { reconcileNodePositions } from './graph-view.reconcile';
import {
  EMPTY_SPAWN_OVERLAY,
  edgePairKey,
  resolveSpawnOverlay,
  type ISpawnOverlay,
} from './spawn-overlay';
import { bindSelectionToUrl } from './selection-url-sync';
import {
  readStoredNodePositions,
  readStoredPanelWidth,
  readStoredViewport,
  writeStoredNodePositions,
  writeStoredPanelWidth,
  writeStoredViewport,
} from './graph-view.storage';
import { setupEdgeResize } from '../../core/edge-resize.controller';
import { setupTagSelection } from './tag-selection.controller';
import { setupViewportStore, ZOOM_MIN, ZOOM_MAX } from './viewport-store';
import { isAnyPrimengOverlayOpen } from './graph-view.utils';
import {
  createSelectionState,
  type IEdgeSelectionView,
  type ISelectionView,
} from './selection-state';
import { setupNodeDrag } from './node-drag.controller';
import { setupExpansion } from './expansion.controller';
import { setupFollowActivity } from './follow-activity.controller';
import { setupLayoutFit } from './layout-fit.controller';
import {
  animateViewport,
  computeCenterTransform,
  computeFitTransform,
  TAG_FIT_MAX_ZOOM,
  type IViewportTransform,
} from './viewport-animation';

const ZOOM_BUTTON_STEP = 0.2;

/** Inspector panel width the view opens at when nothing is persisted. */
const PANEL_WIDTH_DEFAULT = 500;
const PANEL_WIDTH_MIN = 400;
/** Minimum graph area to keep visible at any viewport width. */
const PANEL_VIEWPORT_RESERVE = 80;

/** Tween duration (ms) for the auto-fit on WS-scan topology change. A
 *  hair longer than the tag-selection tween (320 ms) so the "scan
 *  brought in new nodes, camera glides to frame them" beat reads as a
 *  distinct event without dragging the UX. */
const AUTO_FIT_ANIM_MS = 420;

/** Default selection bundle when a node is not yet in the selection map. */
const SELECTION_DEFAULT: ISelectionView = {
  selected: false,
  highlighted: false,
  dimmed: false,
};

/** Default edge bundle when an edge is not yet in the selection map. */
const EDGE_SELECTION_DEFAULT: IEdgeSelectionView = {
  highlighted: false,
  dimmed: false,
  opacity: 1,
};


// Direction icons / spacing icons / connection-type SVG paths now live
// inside `<sm-graph-layout-toolbar>` along with the catalogs and
// labelers they feed. Connector-side resolution (direction -> side
// table + force-layout fallback) lives in `./connection-sides`.

@Component({
  selector: 'sm-graph-view',
  imports: [
    FFlowModule,
    FVirtualFor,
    BranchCapBanner,
    ConversationDialog,
    GraphLayoutToolbar,
    KindPalette,
    LinkKindPalette,
    SessionNode,
    SeverityPalette,
    NodeCard,
    PerfHud,
    InspectorView,
    ButtonModule,
    ConfirmDialogModule,
    TooltipModule,
    /* ViewContributionsHost: real graph.node.alert slot mount (also ringed by the kept debug-slots overlay; see context/ui.md). */
    ViewContributionsHost,
    MiddleMousePanDirective,
  ],
  providers: [
    ConfirmationService,
    // Manual mode: we own the relayout lifecycle (topology cache,
    // preference-driven recompute, animated viewport refit) and call
    // `DagreLayoutEngine.calculate()` directly from the layout effect
    // below. Auto mode would have Foblex re-measure + relayout on
    // every render which conflicts with our cached `nodePositions`.
    provideFLayout(DagreLayoutEngine, { mode: EFLayoutMode.MANUAL }),
  ],
  templateUrl: './graph-view.html',
  styleUrl: './graph-view.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'onEscape()' },
})
export class GraphView implements OnInit {
  private readonly loader = inject(CollectionLoaderService);
  private readonly filters = inject(FilterStoreService);
  private readonly issuePaths = inject(IssuePathsService);
  // Protected so the template can read `isActive()` / `count()` (toolbar
  // "show all" affordance + curation empty-state) and call `clear()`.
  protected readonly mapVisibility = inject(MapVisibilityService);
  private readonly graphPreferences = inject(GraphPreferencesService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dagreLayout = inject(DagreLayoutEngine);
  private readonly injector = inject(Injector);
  private readonly usageTracker = inject(UsageTrackerService);
  protected readonly nodeActivity = inject(NodeActivityService);
  private readonly activityStats = inject(NodeActivityStatsService);
  private readonly agentSpawns = inject(AgentSpawnService);
  private readonly livePrefs = inject(LivePreferencesService);
  private readonly dataSource = inject(DATA_SOURCE);

  private readonly flow = viewChild(FFlowComponent);
  // Protected: `panTarget` (below) reads this for the middle-mouse pan's
  // final `emitCanvasChangeEvent()` flush.
  protected readonly canvas = viewChild(FCanvasComponent);
  private readonly zoom = viewChild(FZoomDirective);
  private readonly canvasWrap = viewChild<ElementRef<HTMLElement>>('canvasWrap');
  // Connection visual contract, typed via Foblex enums instead of raw
  // string literals so a future enum rename surfaces at compile time.
  // `END_ALL_STATES` covers selected + non-selected with the same arrow
  // glyph (we currently disable connection selection, but this stays
  // correct if `[fSelectionDisabled]` is ever flipped).
  //
  // `connectionType` is a signal from `GraphPreferencesService` so the
  // graph re-renders when the user picks a different edge shape from
  // Settings → General. The Foblex `EFConnectionType` enum IS a string
  // union, so the wire literal flows straight into `[fType]` without a
  // mapping table.
  protected readonly connectionType = this.graphPreferences.connectionType;
  readonly connectionBehavior = EFConnectionBehavior.FIXED;
  // Schema-designer style endpoints: a small circle at the source and
  // an arrow at the target. `*_ALL_STATES` covers selected + idle with
  // the same glyph (we currently disable connection selection, but the
  // marker stays correct if `[fSelectionDisabled]` is ever flipped).
  readonly markerStart = EFMarkerType.START_ALL_STATES;
  readonly markerEnd = EFMarkerType.END_ALL_STATES;

  /**
   * Compile-time defaults from `models/settings.ts`. Read directly today;
   * the runtime config service that loads `/config.json` and merges with
   * defaults lands with the `sm ui` CLI (ROADMAP §Step 14). Until then,
   * the shape here matches the future service signal exactly so the
   * migration is a one-line import swap.
   */
  protected readonly perf = DEFAULT_SETTINGS.graph.perf;
  /**
   * PerfHud visibility. Gated by `DebugPerfService` (`?debug-fps=1` /
   * localStorage `sm-debug-perf`) until the runtime settings loader
   * lands and a real `graph.perfHud` config key takes over. The signal
   * shape matches what the future settings-driven flag will look like
   *, migration is a one-line import swap.
   */
  protected readonly perfHud = inject(DebugPerfService).visible;

  private readonly savedViewport = readStoredViewport();
  // Middle-mouse pan lives in `[smMiddleMousePan]` directive applied
  // to `.graph__canvas-wrap` in the template, see
  // `middle-mouse-pan.ts`.

  // Viewport state, owned by `setupViewportStore`. See the helper for
  // the rationale around using signals (Foblex reconciliation gotcha).
  private readonly viewportStore = setupViewportStore({
    savedViewport: this.savedViewport,
    hasCompletedInitialLayout: () => this.layoutFit.hasCompletedInitialLayout(),
  });
  protected readonly viewportPosition = this.viewportStore.viewportPosition;
  protected readonly viewportScale = this.viewportStore.viewportScale;
  /**
   * Accessors the middle-mouse pan directive drives. Foblex 18.6 dropped
   * the public `setPosition`, so the pan writes the `[position]` signal
   * (the same path the viewport animations use) instead of poking the
   * canvas imperatively; `emitChange` flushes a final persist at the end
   * of the gesture.
   */
  protected readonly panTarget: IMiddleMousePanTarget = {
    readPosition: () => this.viewportPosition(),
    writePosition: (p) => this.viewportPosition.set(p),
    emitChange: () => this.canvas()?.emitCanvasChangeEvent(),
  };
  protected readonly canZoomIn = this.viewportStore.canZoomIn;
  protected readonly canZoomOut = this.viewportStore.canZoomOut;

  // Re-expose the zoom range so the `<f-canvas>` bindings can read from
  // the same constants the toolbar's enable/disable logic uses (single
  // source of truth, see `viewport-store.ts`).
  protected readonly zoomMin = ZOOM_MIN;
  protected readonly zoomMax = ZOOM_MAX;

  protected readonly texts = GRAPH_VIEW_TEXTS;

  private readonly nodePositions = signal<TNodePositions>(readStoredNodePositions());

  // Node drag state machine, owns pointer-down anchor + drag buffer.
  // See `node-drag.controller.ts` for the buffer rationale.
  private readonly nodeDrag = setupNodeDrag({
    destroyRef: this.destroyRef,
    nodePositions: this.nodePositions,
  });

  // Card-expansion state, owns `expandedNodeIds`, the persistence
  // writer, and the GC effect that drops stale ids.
  private readonly expansion = setupExpansion({ nodes: this.loader.nodes });

  // Inspector panel width, owned by the shared edge-resize factory.
  // The panel hugs the RIGHT edge (handle on its left), so dragging
  // left grows it; the clamp reserves graph width on the other side.
  private readonly panelResize = setupEdgeResize({
    destroyRef: this.destroyRef,
    edge: 'right',
    defaultWidth: PANEL_WIDTH_DEFAULT,
    minWidth: PANEL_WIDTH_MIN,
    viewportReserve: PANEL_VIEWPORT_RESERVE,
    initialWidth: readStoredPanelWidth() ?? PANEL_WIDTH_DEFAULT,
    onCommit: (width) => writeStoredPanelWidth(width),
  });
  protected readonly clampedPanelWidth = this.panelResize.clampedWidth;

  readonly loading = this.loader.loading;
  readonly error = this.loader.error;

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
  private readonly visibleNodes = computed(() =>
    this.filters.apply(this.loader.nodes(), this.issuePaths.bySeverity(), {
      includeSearch: this.filters.searchAffectsMap(),
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
  private readonly topology = computed(() =>
    resolveTopology(this.loader.nodes(), this.loader.scan()),
  );

  /**
   * Dagre output, top-left positions keyed by node path. Filled by the
   * async layout effect in the constructor. Initially empty: nodes
   * render at (0, 0) until dagre resolves, the first frame of the
   * boot tween hides this via `fitToScreen`.
   */
  private readonly layoutPositions = signal<Map<string, IPoint>>(new Map());
  /** `performance.now()` timestamp of the last dagre run; exposed to the perf HUD. */
  private readonly layoutComputedAtSignal = signal(0);

  /**
   * Combined topology + positions, the shape the renderer + reconcile
   * helpers consume. Kept as a computed so consumers stay reactive
   * across both topology changes and layout updates without bookkeeping.
   */
  private readonly fullLayout = computed<IFullLayout>(() => ({
    ...this.topology(),
    positions: this.layoutPositions(),
    computedAt: this.layoutComputedAtSignal(),
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
  private readonly mapVisiblePaths = computed<Set<string>>(
    () => new Set(this.visibleNodes().map((n) => n.path)),
  );

  readonly graph = computed<IGraphData>(() => {
    const visibleIds = this.mapVisiblePaths();
    const linkKinds = this.filters.selectedLinkKinds();
    const visibleEdgeKinds = linkKinds.length > 0 ? new Set(linkKinds) : null;
    return projectVisible(
      this.fullLayout(),
      visibleIds,
      this.nodePositions(),
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
  private readonly fullAdjacency = computed<Map<string, Set<string>>>(() => {
    const map = new Map<string, Set<string>>();
    const link = (a: string, b: string): void => {
      let set = map.get(a);
      if (!set) {
        set = new Set<string>();
        map.set(a, set);
      }
      set.add(b);
    };
    for (const edge of this.fullLayout().edges) {
      link(edge.from, edge.to);
      link(edge.to, edge.from);
    }
    return map;
  });

  readonly hasData = computed(() => this.graph().nodes.length > 0);
  /**
   * Show the empty-state card when no nodes are visible AND the user
   * did NOT intentionally drive the view to zero matches. Two cases
   * are treated as intentional and skip the empty-state card:
   *
   *   1. The kind toggle is explicitly empty (sticky flag on the filter
   *      store). The operator switched every kind off; we keep the
   *      canvas rendered with zero nodes so the floating palette stays
   *      one click away from re-enabling a kind.
   *   2. The search input has text. A no-match search means the typed
   *      query simply filters everything out; surfacing a full-card "No
   *      nodes match" message on every keystroke would shout at the
   *      user mid-typing. The blank canvas + the active-tinted search
   *      icon in the palette already communicate the filter state.
   */
  readonly showEmptyState = computed(
    () =>
      !this.hasData() &&
      !this.mapVisibility.isActive() &&
      !this.filters.kindToggleExplicitEmpty() &&
      this.filters.searchText().trim().length === 0,
  );

  /**
   * Curation drove the canvas to zero: the user curated a visible set,
   * but nothing in it survives the active facet filters (or every curated
   * path got filtered out). Distinct from `showEmptyState` so we can offer
   * a "Show all on map" escape instead of the generic "no matches" copy.
   */
  readonly showCurationEmptyState = computed(
    () => !this.hasData() && this.mapVisibility.isActive(),
  );

  /** Counters / timestamp exposed to the perf HUD. Pure derivations. */
  protected readonly visibleCount = computed(() => this.graph().nodes.length);
  protected readonly totalCount = computed(() => this.loader.nodes().length);
  protected readonly edgeCount = computed(() => this.graph().edges.length);
  protected readonly layoutComputedAt = computed(() => this.layoutComputedAtSignal());

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
  protected readonly connectionSides = computed(() =>
    resolveConnectionSides(
      this.graphPreferences.layoutAlgorithm(),
      this.graphPreferences.layoutDirection(),
    ),
  );
  protected readonly inputSide = computed(() => this.connectionSides().input);
  protected readonly outputSide = computed(() => this.connectionSides().output);

  // Layout-control catalogs, labelers, setters, and dynamic icons now
  // live in `<sm-graph-layout-toolbar>` (graph-layout-toolbar/). The
  // toolbar reads + writes `GraphPreferencesService` directly so no
  // wiring crosses the parent-child boundary.

  readonly selectedNodeId = signal<string | null>(null);

  protected readonly selectedPath = computed<string | undefined>(() => {
    const id = this.selectedNodeId();
    if (!id) return undefined;
    const node = this.graph().nodes.find((n) => n.id === id);
    return node?.view.path;
  });

  /**
   * Width the inspector panel currently reserves over the canvas, its
   * live (resizable) width while a node is selected, `0` otherwise. The
   * panel is an absolute overlay pinned to the right edge, so it never
   * shrinks `canvasWrap`; every "centre in the visible area" computation
   * has to subtract this from the usable width by hand. Consumed by the
   * auto-fit camera, the single-node center pan, and the floating
   * toolbar's horizontal centering (so the pill glides clear of the
   * panel instead of hiding behind it).
   */
  protected readonly reservedPanelWidth = computed(() =>
    this.selectedNodeId() !== null ? this.clampedPanelWidth() : 0,
  );

  /**
   * Drop the selection if the underlying graph no longer contains the
   * selected node (e.g. filters changed). Avoids dangling highlight state.
   */
  private readonly selectionGuard = effect(() => {
    const id = this.selectedNodeId();
    if (id === null) return;
    const exists = this.graph().nodes.some((n) => n.id === id);
    if (!exists) this.selectedNodeId.set(null);
  });

  // URL ↔ selection deep-link wiring lives in `bindSelectionToUrl`,
  // see `selection-url-sync.ts` for the loop-guard contract. Called
  // from the constructor below.


  /**
   * Fingerprint of the loaded path set (NOT edges). Drives the "auto-fit
   * when a node is added or removed" effect below. Edge-only topology
   * changes (a new link extracted from an edited body, or a link that
   * disappeared) do NOT trip this fingerprint, the user kept the same
   * cards, just their wiring changed; jerking the viewport for that
   * would feel intrusive.
   */
  private readonly pathsFingerprint = computed(() =>
    this.loader.nodes().map((n) => n.path).sort().join('|'),
  );

  // Initial fit-to-screen + auto-fit on topology change. Owns the
  // `hasCompletedInitialLayout` flag the viewport store reads to gate
  // storage writes during the boot tween. The animated path runs on
  // WS-scan add / remove (the user sees the camera glide to frame the
  // new layout); the snap path stays the initial-fit fallback because
  // it goes through Foblex's `fitToScreen` (which doesn't honour the
  // zoom clamp during its own tween, hence the clamp-after-snap).
  private readonly layoutFit = setupLayoutFit({
    visibleNodes: this.visibleNodes,
    pathsFingerprint: this.pathsFingerprint,
    savedViewport: this.savedViewport,
    fit: () => this.fitToScreenClamped(),
    animatedFit: () => this.animatedFitToScreen(),
  });

  constructor() {
    // URL ↔ selection deep-link wiring (extracted helper). The
    // `graphNodes` signal feeds a lightweight {id, view.path} list
    // derived straight from the loader, NOT from the full `graph()`
    // pipeline. Without this, the async dagre layout effect's
    // `layoutPositions` write would tick `graph()` (different array
    // ref each time) and re-fire the URL→selection reader with the
    // stale URL path, undoing a freshly-closed panel before
    // `router.navigate` has cleared the `?path=` query param.
    const selectionNodes = computed(
      () => this.loader.nodes().map((n) => ({ id: n.path, view: { path: n.path } })),
      {
        equal: (a, b) => {
          if (a.length !== b.length) return false;
          for (let i = 0; i < a.length; i++) {
            if (a[i]?.id !== b[i]?.id) return false;
          }
          return true;
        },
      },
    );
    bindSelectionToUrl({
      selectedPath: this.selectedPath,
      setSelectedNodeId: (id) => this.selectedNodeId.set(id),
      readSelectedNodeId: () => this.selectedNodeId(),
      graphNodes: selectionNodes,
      // A deep link from the files view ("open in map") should glide
      // the camera onto the node. Stash the id; the center effect below
      // runs the pan once the boot fit has fixed the zoom and the dagre
      // positions are in.
      onDeepLinkSelect: (id) => {
        this.pendingCenterNodeId.set(id);
      },
      router: this.router,
      route: this.route,
    });

    // Reconcile `nodePositions` against the loaded set so storage holds
    // the position of every visible node, not just the ones the user
    // manually dragged. Reads the latest dagre output for missing ids,
    // drops stale entries, and refreshes auto pins whose dagre position
    // drifted (manual pins stay verbatim). After `resetLayout()` clears
    // the map this effect runs on the next tick and reseeds every
    // visible node from the freshest dagre layout, then persists.
    // Single localStorage write per cycle, gated by the helper's `dirty`
    // flag. Empty-loader case is skipped so we don't wipe storage
    // during the boot loading phase. Pure reconcile in
    // `graph-view.reconcile.ts`.
    //
    // Must run BEFORE the auto-fit runner below: both effects react to
    // the same `layoutComputedAt` tick (reconcile via `fullLayout()`,
    // auto-fit directly), and `runAnimatedFit` reads `nodePositions` to
    // compute the bbox. Reconcile-then-fit guarantees the camera tweens
    // toward the rendered geometry, not the pre-reconcile snapshot.
    effect(() => {
      const nodes = this.loader.nodes();
      if (nodes.length === 0) return;
      const layout = this.fullLayout();
      if (layout.positions.size === 0) return; // dagre hasn't run yet
      const result = reconcileNodePositions({
        nodes,
        current: this.nodePositions(),
        layout,
      });
      if (!result.dirty) return;
      this.nodePositions.set(result.next);
      writeStoredNodePositions(result.next);
    });

    // Auto-fit animation runner. `setupLayoutFit` fires `animatedFit`
    // on the `pathsFingerprint` change tick, which lands BEFORE the
    // async dagre layout finishes. We can't read `fullLayout()` at that
    // moment, the positions are still the pre-change snapshot, so a
    // deletion tweens toward the bbox of the surviving nodes' OLD
    // positions and lands wrong once dagre relayouts. Deferring to the
    // next `layoutComputedAt` tick guarantees fresh positions are in
    // place before `runAnimatedFit` reads them, AND the reconcile
    // effect declared above has already mirrored those positions into
    // `nodePositions` (the source `runAnimatedFit` actually consults
    // for the bbox, mirroring `projectVisible`).
    effect(() => {
      this.layoutComputedAt();
      if (!this.autoFitPending) return;
      this.autoFitPending = false;
      this.runAnimatedFit();
    });

    // Deep-link center pan. A files-view "open in map" navigation stashes
    // the target node id in `pendingCenterNodeId`; this effect runs the
    // camera glide once BOTH gates are satisfied: the boot fit has fixed
    // the zoom (`hasCompletedInitialLayout`, signal-backed so this
    // re-fires when it flips) AND dagre has produced positions (the
    // `layoutComputedAt` tick). The pan itself is deferred to
    // `afterNextRender` so Foblex's snap fit + clamp have already
    // applied and the scale `centerOnNode` reads is the settled one,
    // the pan keeps that zoom and only moves the position.
    effect(() => {
      this.layoutComputedAt();
      const bootFitDone = this.layoutFit.hasCompletedInitialLayout();
      const id = this.pendingCenterNodeId();
      if (id === null || !bootFitDone) return;
      if (this.fullLayout().positions.size === 0) return;
      this.pendingCenterNodeId.set(null);
      afterNextRender(() => this.centerOnNode(id), { injector: this.injector });
    });

    // Re-fit the camera when the map visibility curation changes (decision:
    // refit on every change) UNLESS that change rode in on a tag selection.
    // A tag click curates in place (hides the non-matching cards) but
    // deliberately leaves the camera where it is: the operator clicked a
    // tag on a card they were already looking at, and a pan / zoom jump
    // reads as the view running away from them. The genuine curation
    // gestures (rail checkboxes, isolate) still glide. We tell the two
    // apart by the `activeTagSelection` transition: when it changed since
    // the last run (tag activated, swapped, or toggled off) the paths moved
    // because of the tag and we skip the refit; when it held steady the
    // paths moved for a non-tag reason and we frame the result. Debounced
    // so a burst of checkbox toggles coalesces into one glide. Topology is
    // unchanged on a pure visibility edit, so `layoutComputedAt` does NOT
    // tick; positions are already settled post-boot, so we drive
    // `runAnimatedFit` via `afterNextRender` directly (which lets
    // `projectVisible` render the new node set first).
    let lastTagForRefit: string | null = null;
    effect(() => {
      this.mapVisibility.paths(); // refit on curation change ...
      const tag = this.activeTagSelection(); // ... but not when a tag drove it
      const tagChanged = tag !== lastTagForRefit;
      lastTagForRefit = tag;
      if (tagChanged) {
        // Tag selection curates in place and never reframes. It also
        // cancels any refit a just-prior curation gesture queued, so the
        // camera stays put across the tag click.
        if (this.mapFitDebounce !== null) clearTimeout(this.mapFitDebounce);
        this.mapFitDebounce = null;
        return;
      }
      // Gate, NOT a dependency: reading it tracked would also refit on the
      // boot flip of this flag (a redundant re-frame). `untracked` keeps the
      // effect firing only when the curation set actually changes.
      if (!untracked(() => this.layoutFit.hasCompletedInitialLayout())) return;
      if (this.mapFitDebounce !== null) clearTimeout(this.mapFitDebounce);
      this.mapFitDebounce = setTimeout(() => {
        afterNextRender(() => this.runAnimatedFit(), { injector: this.injector });
      }, 180);
    });
    this.destroyRef.onDestroy(() => {
      if (this.mapFitDebounce !== null) clearTimeout(this.mapFitDebounce);
    });

    // Garbage-collect curated paths a re-scan removed. Keyed on the
    // whole-corpus LITE node set, NOT the rendered branch: curation is
    // corpus-wide and must survive a branch switch (a curated path that
    // is simply outside the current branch is still valid). Only a path
    // the re-scan genuinely dropped from the corpus is pruned. If
    // pruning empties the curation the map falls back to "show all".
    effect(() => {
      const lite = this.loader.liteNodes();
      if (lite.length === 0) return;
      // `untracked`: prune is a re-scan garbage-collect, it must fire only
      // when the CORPUS changes (lite list), never on a selection toggle.
      // prune reads `mapVisibility.paths()` internally, so without this the
      // effect would track the selection and re-run on every checkbox click,
      // wiping a freshly-selected folder prefix before the map even renders.
      untracked(() => this.mapVisibility.prune(new Set(lite.map((n) => n.path))));
    });

    // Async layout effect, runs dagre when topology or layout
    // preferences change. The cache key combines the topology
    // fingerprint with the preferences tuple so an unchanged WS push
    // (same paths + edges + same algorithm/direction/spacing) skips
    // the engine call entirely.
    //
    // A preference change is treated as an explicit "redo the layout"
    // gesture: `nodePositions` is cleared so the next reconcile pass
    // repaints every card from the fresh dagre output, instead of
    // keeping the user pinned to the previous arrangement.
    //
    // The engine call is deferred to a microtask via
    // `Promise.resolve().then(...)` so the synchronous prelude of
    // `DagreLayoutEngine.calculate()` (which builds the graphlib
    // graph and may touch Foblex internals) runs OUTSIDE this
    // effect's reactive context. Inlining the call subscribes the
    // effect to any signal Foblex reads, producing spurious re-fires
    // on unrelated state changes.
    let lastLayoutKey = '';
    let lastPreferencesKey = '';
    effect(() => {
      const nodes = this.loader.nodes();
      const topology = this.topology();
      const preferences = {
        algorithm: this.graphPreferences.layoutAlgorithm(),
        direction: this.graphPreferences.layoutDirection(),
        spacing: this.graphPreferences.layoutSpacing(),
      };
      if (nodes.length === 0) return;

      const topologyKey = topologyFingerprint(nodes, topology.edges);
      const preferencesKey =
        `${preferences.algorithm}|${preferences.direction}|${preferences.spacing}`;
      const cacheKey = `${topologyKey}|${preferencesKey}`;
      if (cacheKey === lastLayoutKey) return;
      const preferencesChanged =
        lastPreferencesKey !== '' && lastPreferencesKey !== preferencesKey;
      lastLayoutKey = cacheKey;
      lastPreferencesKey = preferencesKey;

      // Dispatch on algorithm: 'force' goes to our local d3-force
      // helper (sync, wrap in Promise.resolve so the effect's await
      // chain is uniform), the rest go to Foblex's dagre engine.
      const layoutPromise =
        preferences.algorithm === 'force'
          ? Promise.resolve(computeForceLayoutPositions(nodes, topology.edges))
          : Promise.resolve().then(() =>
              computeDagreLayout(this.dagreLayout, nodes, topology.edges, preferences),
            );

      void layoutPromise
        .then((positions) => {
          this.layoutPositions.set(positions);
          this.layoutComputedAtSignal.set(performance.now());
          if (preferencesChanged) {
            // The user just asked for a new layout: drop the
            // user-pinned drag positions so every card repaints from
            // the fresh dagre / force output, then fit the viewport
            // to the new bounding box. `fitToScreenClamped` calls
            // `canvas.fitToScreen` which gates on
            // `WaitForConnectionsRendered` internally (waits for both
            // `connectionsRenderedRevision` and the matching
            // `connectionsRenderedNodesRevision`), so the bounding
            // box it measures is always against the post-layout DOM.
            this.nodePositions.set(new Map());
            this.fitToScreenClamped();
          }
        })
        .catch((err) => {
          // Swallow + log: a layout failure (e.g. dagre CJS interop
          // missing in tests) must not crash the graph view. The
          // previous positions stay; the user can still pan, drag,
          // and select cards.
          console.error('[graph-view] layout failed:', err);
        });
    });
  }

  ngOnInit(): void {
    // Boot guard: kick the three-fetch lazy load once if nothing has
    // landed yet. Keyed on `scanMeta()` (the cheapest of the three) so a
    // branch that legitimately renders zero nodes does not re-trigger
    // the boot fetch on every mount.
    if (this.loader.scanMeta() === null && !this.loader.loading()) {
      void this.loader.load();
    }
  }

  onLoaded(): void {
    // Intentional no-op, `setupLayoutFit` owns the initial fit and
    // the prefs-change fit lives in the layout effect. Kept as a
    // template hook in case we need a render-complete callback later.
  }

  /**
   * Canvas change handler: mirrors the event into the viewport store
   * (reconciliation + persistence) and doubles as the manual-gesture
   * hook for Follow the Activity. Foblex only fires `fCanvasChange`
   * for USER gestures (wheel / pinch / canvas drag / the zoom buttons'
   * `setZoom`) plus the middle-mouse pan's explicit
   * `emitCanvasChangeEvent()` flush, never for programmatic
   * `[position]` / `[scale]` writes, so the follow tween itself cannot
   * trip this and the event IS the "operator touched the camera"
   * signal. Gated on the boot fit: the initial imperative
   * `fitToScreenClamped` (Foblex `fitToScreen` + `setZoom` clamp)
   * emits too, and must not kill a persisted follow preference at
   * startup.
   *
   * Follow drops ONLY when the gesture interrupts a camera move in
   * flight: the operator grabbed the wheel while the camera was
   * driving itself, so the tween is cancelled on the spot (its rAF
   * loop would keep writing over the user's hand for the rest of its
   * 420ms) and the preference switches off. A gesture while the
   * camera RESTS keeps follow armed, panning around between
   * executions is free and the next membership change re-frames.
   * Explicit camera intents (fit / zoom buttons / re-arrange /
   * isolate / deep-link center) still disable at their call sites.
   */
  protected onCanvasChange(event: FCanvasChangeEvent): void {
    this.viewportStore.onCanvasChange(event);
    if (!this.layoutFit.hasCompletedInitialLayout()) return;
    if (!this.cameraTweenInFlight()) return;
    this.autoFitAnimToken++;
    this.disableFollow();
  }

  /**
   * Run a fit that respects `zoomMin` / `zoomMax`. Foblex's `FitToFlow`
   * writes `transform.scale` directly without clamping (verified in
   * `node_modules/@foblex/flow/fesm2022/foblex-flow.mjs`, `FitToFlow.handle`),
   * so a sparse graph balloons past the user's max. We delegate the fit
   * itself to Foblex (it owns the bbox + parent rect math) but follow
   * it up with our own clamp inside the SAME render cycle via
   * `afterNextRender`: Foblex's `_afterRedraw` already uses
   * `afterNextRender`, so by queueing right after we land in the same
   * `rAF` tick, Foblex's fit runs first, our clamp runs second, and the
   * browser only paints the post-clamp frame. Non-animated fit is used
   * so the (briefly held) pre-clamp transform never hits a CSS
   * transition that would expose the overshoot to the eye.
   */
  private fitToScreenClamped(): void {
    const canvas = this.canvas();
    const zoom = this.zoom();
    if (!canvas) return;
    canvas.fitToScreen({ x: 40, y: 40 }, false);
    afterNextRender(
      () => {
        const scale = canvas.transform.scale;
        // Clamp the fit to the fit-to-content ceiling (`TAG_FIT_MAX_ZOOM`),
        // NOT the wheel-zoom max (`zoomMax`): Foblex's `fitToScreen`
        // ignores the zoom bounds and magnifies a lone node far past
        // natural size, so a one-node project would otherwise open
        // gigantic. Zoom-out (many nodes) is bounded by `zoomMin`.
        if (scale > TAG_FIT_MAX_ZOOM || scale < this.zoomMin) {
          const clamped = Math.max(this.zoomMin, Math.min(scale, TAG_FIT_MAX_ZOOM));
          const step = Math.abs(scale - clamped);
          const direction = scale > clamped ? EFZoomDirection.ZOOM_OUT : EFZoomDirection.ZOOM_IN;
          // `FZoomDirective.setZoom` clamps via `SetZoom._clamp` (the same
          // path wheel + button zoom go through), so it lands exactly at
          // `zoomMin` / `zoomMax`. Non-animated to keep the snap atomic
          // inside this render cycle.
          zoom?.setZoom(this.getViewportCenter(), step, direction, false);
        }
        // Persist the settled fit. Foblex's `fitToScreen` (FitToFlow)
        // never emits `fCanvasChange`, so a layout-algorithm / direction
        // change would otherwise be lost on F5 like the animated fits
        // were. Read the transform AFTER the optional clamp so the saved
        // scale matches what is painted; the clamp's `setZoom` also emits
        // and would write the same value, so this is idempotent there.
        if (this.layoutFit.hasCompletedInitialLayout()) {
          const t = canvas.transform;
          writeStoredViewport({ x: t.position.x, y: t.position.y, scale: t.scale });
        }
      },
      { injector: this.injector },
    );
  }

  /** Supersession token for the auto-fit tween, increments on each
   *  call so a back-to-back WS scan refresh cancels the in-flight tween
   *  cleanly (mirrors the tag-selection pattern). */
  private autoFitAnimToken = 0;

  /**
   * Wall-clock start of the last animated camera tween. A tween runs
   * exactly `AUTO_FIT_ANIM_MS` from here (a superseding call restarts
   * the window together with the tween), so "started less than a
   * duration ago" IS the in-flight state, no completion callback
   * needed. `-Infinity` so the pre-first-tween window never reads as
   * moving (`performance.now()` starts near 0 at page load).
   */
  private cameraTweenStartedAt = Number.NEGATIVE_INFINITY;

  /** True while an animated camera move (fit / center / follow) is in flight. */
  private cameraTweenInFlight(): boolean {
    return performance.now() - this.cameraTweenStartedAt < AUTO_FIT_ANIM_MS;
  }

  /**
   * Set to `true` when `setupLayoutFit` fires its animated callback on
   * a topology change; the actual tween is deferred to the next
   * `layoutComputedAt` tick (see `autoFitRunner` effect in the
   * constructor). The deferral is load-bearing: `pathsFingerprint`
   * changes BEFORE dagre re-layouts, so reading `layoutPositions`
   * during the callback would tween toward a stale bbox, the symptom
   * the user reported was deletes anchoring on the pre-delete positions.
   */
  private autoFitPending = false;

  /**
   * Debounce timer for the re-fit on a map-visibility change. A folder
   * cascade is one signal tick (one fit), but rapid single-leaf toggles
   * each tick the curation effect; coalescing them into one camera glide
   * keeps the viewport from thrashing. Cleared on destroy.
   */
  private mapFitDebounce: ReturnType<typeof setTimeout> | null = null;

  /**
   * Node id (== node path) queued by a deep-link selection (the files
   * view "open in map" navigation). The center effect in the
   * constructor drains it once the boot fit and dagre positions are
   * ready. Signal-backed so a repeated deep-link re-fires the effect:
   * in the fused workspace the graph stays mounted, so clicking a
   * second file would set this without changing `layoutComputedAt` /
   * `hasCompletedInitialLayout`, and a plain field would leave the
   * effect dormant (camera never re-centers). As a signal, each set
   * invalidates the effect and the camera glides to the new node.
   */
  private readonly pendingCenterNodeId = signal<string | null>(null);

  /** Public-facing scheduler the layout-fit controller wires into
   *  `animatedFit`. Just marks intent; the deferred runner does the work. */
  private animatedFitToScreen(): void {
    this.autoFitPending = true;
  }

  /**
   * Run the animated fit: the camera glides (pan + zoom) to frame the
   * on-screen nodes. Drives both the deferred auto-fit (scan add / remove,
   * curation re-fit) and the explicit re-arrange / fit buttons, so every
   * fit in the view animates the same way. Pure signal tween via
   * `viewport-animation`: the clamp lives inside `computeFitTransform`
   * (returns the scale already clamped to `[zoomMin, TAG_FIT_MAX_ZOOM]`),
   * so we get the camera-glide UX without Foblex's `FitToFlow`
   * overshoot the snap-then-clamp path `fitToScreenClamped` is
   * specifically guarding against.
   *
   * Empty-points / no-wrap guards mirror tag-selection; the visible-
   * paths intersection ensures filter-hidden nodes don't anchor the
   * bbox (a filter that hides everything but one node should fit on
   * that one node when the WS scan brings in a sibling).
   */
  private runAnimatedFit(): void {
    const transform = this.computeVisibleFitTransform();
    if (!transform) return;
    this.animateToTransform(transform);
  }

  /**
   * Glide the viewport toward `transform` with the shared supersession
   * token. Single tween entry point for every animated camera move
   * (auto-fit, deep-link center, follow-the-activity), so back-to-back
   * moves from different features cancel each other cleanly instead of
   * fighting over the viewport signals.
   */
  private animateToTransform(transform: IViewportTransform): void {
    const token = ++this.autoFitAnimToken;
    this.cameraTweenStartedAt = performance.now();
    animateViewport(
      {
        readPosition: () => this.viewportPosition(),
        readScale: () => this.viewportScale(),
        writePosition: (p) => this.viewportPosition.set(p),
        writeScale: (s) => this.viewportScale.set(s),
        isStaleToken: () => token !== this.autoFitAnimToken,
      },
      transform,
      AUTO_FIT_ANIM_MS,
    );
    // Persist the destination so a reload restores where the camera was
    // parked. Foblex only emits `fCanvasChange` (the other writer of
    // `sm.graph.viewport`) for real gestures and button zoom, never for
    // the programmatic signal writes `animateViewport` makes, so without
    // this every fit / re-arrange / show-all / isolate / deep-link
    // center / follow move was lost on F5. Write the TARGET (already the
    // clamped final transform) directly rather than through
    // `emitCanvasChangeEvent()`, which would trip the tween-interrupt
    // branch in `onCanvasChange` and wrongly disable follow. The boot
    // gate mirrors `viewport-store`: don't clobber the restored viewport
    // before the first layout settles.
    if (this.layoutFit.hasCompletedInitialLayout()) {
      writeStoredViewport({ x: transform.position.x, y: transform.position.y, scale: transform.scale });
    }
  }

  /**
   * Compute the pan/zoom that fits the on-screen nodes inside the
   * VISIBLE canvas, reserving the inspector panel's width when it is open
   * so the camera frames the area the operator actually sees (left of
   * the panel). Shared by every camera fit (the auto-fit on scan, the
   * curation re-fit, and the explicit re-arrange / fit buttons) so they
   * all honour the panel identically.
   *
   * Reads EFFECTIVE positions the way `projectVisible` does: user-pinned
   * (`nodePositions`) wins over the dagre output, layout map as fallback,
   * so the bbox matches what is actually rendered after manual drags
   * (reading just the dagre map produced the "zoom expanded too much"
   * symptom). Fits over the SAME set the canvas renders (facet ∩
   * curation). The files rail needs no special handling: it is a flex
   * sibling that already narrows `canvasWrap`, so `clientWidth` excludes
   * it. Returns null when nothing is on screen or the host is unmounted.
   */
  private computeVisibleFitTransform(): IViewportTransform | null {
    const host = this.canvasWrap()?.nativeElement;
    if (!host) return null;
    const layoutPositions = this.fullLayout().positions;
    if (layoutPositions.size === 0) return null;
    const pinned = this.nodePositions();
    const points: IPoint[] = [];
    for (const path of this.mapVisiblePaths()) {
      const pt = pinned.get(path) ?? layoutPositions.get(path);
      if (pt) points.push({ x: pt.x, y: pt.y });
    }
    if (points.length === 0) return null;
    return computeFitTransform({
      points,
      wrap: { width: host.clientWidth, height: host.clientHeight },
      panelW: this.reservedPanelWidth(),
      zoomMin: this.zoomMin,
    });
  }

  /**
   * Pan the camera so a single node sits in the centre of the visible
   * canvas (left of the inspector panel), WITHOUT changing zoom. Driven
   * by the files-view deep link, not by in-map clicks. Reuses the
   * `autoFitAnimToken` so a competing auto-fit / center supersedes this
   * tween cleanly. The effective position mirrors `projectVisible` /
   * `runAnimatedFit`: user-pinned drag position wins over the dagre
   * output. Bails when the node is not currently visible on the map, has
   * no resolvable position, or the host isn't mounted.
   */
  private centerOnNode(nodeId: string): void {
    // A deep-link center is an explicit "look at THIS node" intent, the
    // camera is the operator's again: follow-the-activity yields.
    this.disableFollow();
    // Only pan to a node that is actually on the map. When it is curated /
    // filtered out of the visible set there is nothing on screen to center
    // on (its full-layout position points at empty space), so leave the
    // camera where it is.
    if (!this.mapVisiblePaths().has(nodeId)) return;
    const host = this.canvasWrap()?.nativeElement;
    if (!host) return;
    const pt = this.nodePositions().get(nodeId) ?? this.fullLayout().positions.get(nodeId);
    if (!pt) return;

    const transform = computeCenterTransform({
      point: pt,
      wrap: { width: host.clientWidth, height: host.clientHeight },
      panelW: this.reservedPanelWidth(),
      scale: this.viewportScale(),
    });
    this.animateToTransform(transform);
  }

  /**
   * Isolate `path` on the map: curate visibility down to the node and its
   * DIRECT neighbors (one hop), and select the origin node. One hop, not
   * the transitive connected component, because a connected graph has a
   * single component, so "isolate" would otherwise show the whole map and
   * read as a plain select. The curation change is picked up by the
   * re-fit effect (which frames the neighborhood, inspector-aware);
   * selecting the node directly writes `?path` via the selection writer
   * effect without firing the deep-link centerer, so the camera frames the
   * neighborhood rather than centering the single origin node. Public
   * because the rail reaches it through `MAP_ISOLATE_INTENT` (the workspace
   * provides an implementation that forwards here).
   *
   * Re-invoking it for the same node while the map still shows exactly that
   * neighborhood toggles back to the pre-isolate visibility (see
   * `MapVisibilityService.isolate`); the service owns that bookkeeping.
   */
  isolateNeighborhood(path: string): void {
    // Isolating curates + re-frames the neighborhood; follow would fight
    // that framing on the next activity tick, so it yields first.
    this.disableFollow();
    const outcome = this.mapVisibility.isolate(path, directNeighborhood(this.fullAdjacency(), path));
    // A toggle-back (re-isolating the same node while the map still shows its
    // neighborhood) restores the prior visibility; leave selection alone so it
    // reads as an undo. A fresh isolate selects the origin so the re-fit effect
    // frames the neighborhood.
    if (outcome === 'isolated') this.selectedNodeId.set(path);
  }

  onNodePositionChange(id: string, position: IPoint): void {
    this.nodeDrag.onNodePositionChange(id, position);
  }

  zoomIn(): void {
    this.disableFollow();
    this.zoom()?.setZoom(this.getViewportCenter(), ZOOM_BUTTON_STEP, EFZoomDirection.ZOOM_IN, true);
  }

  zoomOut(): void {
    this.disableFollow();
    this.zoom()?.setZoom(this.getViewportCenter(), ZOOM_BUTTON_STEP, EFZoomDirection.ZOOM_OUT, true);
  }

  fitToScreen(): void {
    this.disableFollow();
    this.runAnimatedFit();
  }

  resetLayout(): void {
    const visiblePaths = this.mapVisiblePaths();
    const full = visiblePaths.size >= this.loader.nodes().length;
    // Skip the confirm entirely when nothing user-established would be lost:
    // with no manual (dragged / re-arranged) position stored, the current
    // layout IS the automatic one, so re-running it changes nothing to warn
    // about. Only when the user has positioned nodes do we surface the
    // (low-intensity) warning below.
    const hasManualPositions = [...this.nodePositions().values()].some((p) => p.manual === true);
    if (!hasManualPositions) {
      this.applyResetLayout(visiblePaths, full);
      return;
    }
    // Warn that the reset replaces those positions, but at LOW intensity
    // (not a red danger action): an info icon and a normal accept button.
    // The copy differs by case, the full reset replaces every position; the
    // scoped one only re-arranges the currently visible nodes and leaves the
    // hidden ones' coordinates intact.
    const t = GRAPH_VIEW_TEXTS.resetLayoutConfirm;
    this.confirmationService.confirm({
      header: t.header,
      message: full ? t.message : t.messageVisible,
      icon: 'pi pi-info-circle',
      acceptButtonProps: { label: t.accept },
      rejectButtonProps: { label: t.reject, severity: 'secondary', outlined: true },
      accept: () => this.applyResetLayout(visiblePaths, full),
    });
  }

  private applyResetLayout(visiblePaths: Set<string>, full: boolean): void {
    // Re-arranging is an explicit framing intent; follow yields. Placed
    // here (not in `resetLayout`) so cancelling the confirm dialog
    // leaves the follow state untouched.
    this.disableFollow();
    // Reset also collapses every expanded card: the intent is "give me a
    // clean canvas", and leaving cards open re-introduces the size
    // variation that made the user reach for reset in the first place.
    this.expansion.resetAll();
    if (full) {
      // Clearing `nodePositions` is the only mechanical step needed: the
      // reconcile effect runs on the next tick, sees an empty map plus the
      // current full-graph auto-layout, reseeds every node, and persists.
      // That's the original delete → re-arrange → save loop.
      this.nodePositions.set(new Map());
      this.runAnimatedFit();
      return;
    }
    void this.relayoutVisibleSubset(visiblePaths)
      .then(() => this.runAnimatedFit())
      .catch(() => {
        // Layout failure (e.g. dagre CJS interop missing in tests) must
        // not crash the view; the previous positions stay.
      });
  }

  /**
   * Re-run the layout engine over ONLY the visible nodes and the edges
   * between them, then pin the result (`manual: true`) so the reconcile
   * pass, which reseeds AUTO pins from the FULL-graph dagre output, leaves
   * it verbatim. Hidden nodes keep their stored coordinates, so showing
   * them again later yields a hybrid layout that a full "show all" reset
   * re-tidies.
   */
  private async relayoutVisibleSubset(visiblePaths: Set<string>): Promise<void> {
    const subNodes = this.loader.nodes().filter((n) => visiblePaths.has(n.path));
    if (subNodes.length === 0) return;
    const subEdges = this.topology().edges.filter(
      (e) => visiblePaths.has(e.from) && visiblePaths.has(e.to),
    );
    const preferences = {
      algorithm: this.graphPreferences.layoutAlgorithm(),
      direction: this.graphPreferences.layoutDirection(),
      spacing: this.graphPreferences.layoutSpacing(),
    };
    const positions = await Promise.resolve(
      preferences.algorithm === 'force'
        ? computeForceLayoutPositions(subNodes, subEdges)
        : computeDagreLayout(this.dagreLayout, subNodes, subEdges, preferences),
    );
    const next: TNodePositions = new Map(this.nodePositions());
    for (const [path, pt] of positions) {
      next.set(path, { x: pt.x, y: pt.y, manual: true });
    }
    this.nodePositions.set(next);
    writeStoredNodePositions(next);
  }

  private getViewportCenter(): { x: number; y: number } {
    const host = this.canvasWrap()?.nativeElement;
    if (!host) return { x: 0, y: 0 };
    const rect = host.getBoundingClientRect();
    return { x: rect.width / 2, y: rect.height / 2 };
  }

  // Middle-mouse pan is owned by the `[smMiddleMousePan]` directive
  // applied to `.graph__canvas-wrap` in the template, handlers,
  // origin state, rAF coalescing, and cleanup all live there.

  onNodePointerDown(event: PointerEvent): void {
    this.nodeDrag.onNodePointerDown(event);
  }

  /**
   * Session-anchor drag, mirroring the card pattern (skill rule 9:
   * buffer per move, flush once at mouseup, `fDragHandle` consumes
   * `pointerup` so `mouseup` is the reliable end signal). The flushed
   * position lands in the EPHEMERAL override map that feeds
   * `spawnOverlay`, never in the persisted node-position store:
   * session anchors are page-lifetime state by contract.
   */
  private sessionDragBuffer: { owner: string; point: IPoint } | null = null;

  onSessionPointerDown(): void {
    document.addEventListener('mouseup', this.onSessionMouseUp, { once: true });
  }

  onSessionPositionChange(owner: string, position: IPoint): void {
    this.sessionDragBuffer = { owner, point: { x: position.x, y: position.y } };
  }

  private readonly onSessionMouseUp = (): void => {
    // One microtask so a final synchronous fNodePositionChange around
    // the up event lands in the buffer before the flush reads it.
    queueMicrotask(() => {
      const buffered = this.sessionDragBuffer;
      this.sessionDragBuffer = null;
      if (!buffered) return;
      const next = new Map(this.sessionPositionOverrides());
      next.set(buffered.owner, buffered.point);
      this.sessionPositionOverrides.set(next);
    });
  };

  selectNode(node: IGraphNode, event: MouseEvent): void {
    if (!this.nodeDrag.isClickWithoutDrag(event)) return;
    this.selectedNodeId.set(node.id);
    // Opening the node inspector is a tracked feature usage (no node id,
    // path, or title is ever sent, only the `inspector` surface enum).
    this.usageTracker.trackFeature('inspector');
  }

  // Tag-selection state machine (active tag + pre-tag curation snapshot),
  // owned by `setupTagSelection`. Clicking a tag curates the map to the
  // nodes carrying it (the rest hide); the graph view's curation re-fit
  // effect frames the result. The view still owns the trigger surface
  // (`onTagSelect`, wired to the inspector header's tag chip output) and
  // reads `activeTagSelection` for the dim suspension.
  private readonly tagSelection = setupTagSelection({
    nodes: this.loader.nodes,
    mapVisibility: this.mapVisibility,
  });
  protected readonly activeTagSelection = this.tagSelection.activeTagSelection;

  private readonly selectionState = createSelectionState({
    graph: this.graph,
    selectedNodeId: this.selectedNodeId,
    activeTagSelection: this.activeTagSelection,
  });

  protected onTagSelect(tag: string): void {
    this.tagSelection.onTagSelect(tag);
  }

  /** Close the embedded inspector panel and remove the URL `?path` param. */
  closePanel(): void {
    this.selectedNodeId.set(null);
  }

  /**
   * Escape closes the inspector panel, but only when no PrimeNG
   * overlay is open. A confirm dialog / settings modal / overlay panel
   * receives Escape first (its own keydown handler closes it), and
   * because the host listener does not control propagation, the same key
   * would otherwise ALSO collapse this panel in the same tick. The
   * selector covers ConfirmDialog, Dialog, OverlayPanel, and Popover
   * variants used in this app.
   */
  onEscape(): void {
    if (this.selectedNodeId() === null) return;
    if (typeof document !== 'undefined' && isAnyPrimengOverlayOpen(document)) return;
    this.closePanel();
  }

  /**
   * Clear every active filter, same affordance the list view exposes in
   * its empty state. Wired to the "Reset filters" button rendered when
   * `showEmptyState()` is true so the user can recover from an
   * over-narrow filter combo without leaving the graph.
   */
  protected resetFilters(): void {
    this.filters.reset();
  }

  protected onPanelResizeStart(event: MouseEvent): void {
    this.panelResize.onResizeStart(event);
  }

  openNode(node: IGraphNode): void {
    // Embedded inspector mode: dblclick selects (single click already does
    // the same, kept the handler so the gesture has a clear intent).
    this.selectedNodeId.set(node.id);
  }

  /**
   * Click anywhere on the canvas that is NOT an interactive overlay
   * deselects. Foblex's `<f-flow>` does not expose a "background click"
   * event, so we listen on the wrapper and filter by target.
   *
   * Opt-out contract: any surface that must NOT clear the selection
   * marks itself with `data-canvas-click-shield` in the template (node
   * cards, session anchors, palettes, toolbar, inspector panel, perf
   * HUD). The attribute keeps this handler decoupled from child
   * components' CSS class names, a styling refactor cannot silently
   * break the deselect gating, and a new overlay opts out by adding
   * the attribute instead of editing a selector list here.
   */
  onCanvasClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-canvas-click-shield]')) return;
    this.selectedNodeId.set(null);
  }

  isSelected(id: string): boolean {
    return this.selectionState.isSelected(id);
  }

  isHighlighted(id: string): boolean {
    return this.selectionState.isHighlighted(id);
  }

  isDimmed(id: string): boolean {
    return this.selectionState.isDimmed(id);
  }

  /**
   * Single-call lookup for the bundled selection state of a node, used
   * as the `[selection]` binding on `<sm-node-card>`. Falls back to the
   * all-`false` default when the map has not seen `id` yet (between a
   * graph swap and the next selection recompute).
   */
  selectionFor(id: string): ISelectionView {
    return this.selectionState.selectionView().get(id) ?? SELECTION_DEFAULT;
  }

  isExpanded(id: string): boolean {
    return this.expansion.isExpanded(id);
  }

  setExpanded(id: string, value: boolean): void {
    this.expansion.setExpanded(id, value);
  }

  onFavoriteToggle(payload: { path: string; value: boolean }): void {
    void this.loader.toggleFavorite(payload.path, payload.value);
  }

  /**
   * Single-call lookup for the bundled selection state of an edge, read
   * via a `@let` on each `<f-connection>` so highlight / dim / opacity
   * cost one Map lookup instead of three function calls per CD pass
   * (mirrors `selectionFor` for nodes). The opacity folds the confidence
   * gradient and the dim override into one value; inline styles win over
   * the `.f-conn--dimmed` class rule, so this is the single source of
   * truth for connection opacity. Falls back to the all-visible default
   * between a graph swap and the next selection recompute.
   */
  edgeSelectionFor(id: string): IEdgeSelectionView {
    return this.selectionState.edgeSelectionView().get(id) ?? EDGE_SELECTION_DEFAULT;
  }

  /**
   * Live-activity lookup (spec/provider-activity.md): `true` while the
   * node's unit is executing in the operator's AI runtime. Graph node
   * ids ARE node paths, so the `NodeActivityService` set applies with
   * one O(1) lookup per node; under OnPush only the cards whose value
   * flips re-render.
   */
  isExecuting(id: string): boolean {
    return this.nodeActivity.activePaths().has(id);
  }

  /**
   * Active-spine edge: both endpoints are executing (the agent that is
   * running and the skill it invoked), so the connection between them
   * lights up with them and the path reads as one live chain instead of
   * isolated glowing dots.
   */
  isEdgeExecuting(edge: IGraphEdge): boolean {
    const active = this.nodeActivity.activePaths();
    return active.has(edge.from) && active.has(edge.to);
  }

  /**
   * Execution-stats lookup for the card counter pill
   * (spec/provider-activity.md §Execution stats). One O(1) Map lookup
   * per node; entry identities are stable inside
   * `NodeActivityStatsService`, so under OnPush only the cards whose
   * count actually moved re-render.
   */
  activityStatsFor(id: string): INodeActivityStatsApi | null {
    return this.activityStats.stats().get(id) ?? null;
  }

  /**
   * Ephemeral spawn overlay (spec/provider-activity.md §WS event:
   * `agent.spawn`), LAYERED BESIDE `graph()`: dashed spawn edges plus
   * floating session anchors, projected against the SAME visible set
   * and effective positions the canvas renders, but through a separate
   * computed so the synthetic `session:<owner>` ids never reach
   * `fullLayout`, the reconciler, persisted positions, or the fit
   * bbox. Empty (and dependency-cheap) while nothing is spawning.
   */
  /**
   * User-dragged session-anchor positions, keyed by session owner.
   * Ephemeral by contract (page lifetime, never persisted); survives a
   * session's decay so a reappearing session lands where the user left
   * it. Written only by the drag-end flush above.
   */
  private readonly sessionPositionOverrides = signal<ReadonlyMap<string, IPoint>>(new Map());

  protected readonly spawnOverlay = computed<ISpawnOverlay>(() => {
    const spawns = this.agentSpawns.spawnEdges();
    if (spawns.length === 0) return EMPTY_SPAWN_OVERLAY;
    const pinned = this.nodePositions();
    const layout = this.fullLayout().positions;
    const sessionOverrides = this.sessionPositionOverrides();
    // RENDERED static pairs (edge-kind filters + visibility already
    // applied by `graph()`): a spawn whose exact pair is drawn rides
    // that static edge instead of duplicating it; a pair the user
    // filtered out keeps the standalone dashed edge.
    const staticPairs = new Set(this.graph().edges.map((e) => edgePairKey(e.from, e.to)));
    return resolveSpawnOverlay({
      spawns,
      sessions: this.agentSpawns.sessionNodes(),
      visiblePaths: this.mapVisiblePaths(),
      staticPairs,
      positionOf: (path) => pinned.get(path) ?? layout.get(path),
      sessionPositionOf: (owner) => sessionOverrides.get(owner),
    });
  });

  /**
   * pairKey -> representative spawnId for static edges hosting live
   * spawn state. Any spawn of the pair works, the click opens the
   * whole THREAD via the two-fetch widening; emission order makes the
   * last (most recent) spawn win.
   */
  protected readonly spawnActiveByPair = computed<ReadonlyMap<string, string>>(() => {
    const map = new Map<string, string>();
    for (const entry of this.spawnOverlay().activeOnStatic) {
      map.set(entry.pairKey, entry.spawnId);
    }
    return map;
  });

  /** The spawn riding this static edge, or `null` when the edge is plain. */
  protected spawnActiveIdFor(edge: IGraphEdge): string | null {
    return this.spawnActiveByPair().get(edgePairKey(edge.from, edge.to)) ?? null;
  }

  // ── Follow the Activity ─────────────────────────────────────────────
  // Camera state machine extracted to `follow-activity.controller.ts`
  // (fingerprint-gated effect, animated fit over the executing nodes +
  // session capsules). This component stays the camera's home and only
  // wires the config; a gesture that interrupts an in-flight camera
  // move hands control back to the operator via `disableFollow`, see
  // `onCanvasChange`.
  private readonly followCtl = setupFollowActivity({
    livePrefs: this.livePrefs,
    nodeActivity: this.nodeActivity,
    visiblePaths: this.mapVisiblePaths,
    sessions: () => this.spawnOverlay().sessions,
    layoutComputedAt: this.layoutComputedAt,
    bootFitDone: () => this.layoutFit.hasCompletedInitialLayout(),
    hostElement: () => this.canvasWrap()?.nativeElement ?? null,
    // Effective position: user-pinned drag wins over the dagre output,
    // like every other camera path.
    positionOf: (path) => this.nodePositions().get(path) ?? this.fullLayout().positions.get(path),
    panelWidth: () => this.reservedPanelWidth(),
    zoomMin: ZOOM_MIN,
    animateToTransform: (transform) => this.animateToTransform(transform),
  });

  /** Follow-the-activity preference, re-exposed for the toolbar toggle. */
  protected readonly followActivity = this.followCtl.followActivity;

  protected toggleFollowActivity(): void {
    this.followCtl.toggle();
  }

  /**
   * Explicit camera intents (fit / zoom buttons / re-arrange / isolate
   * / deep-link center) switch follow off, plus the gesture-interrupt
   * path in `onCanvasChange` (a free-form gesture only counts while a
   * camera move is in flight). The setter no-ops when already off.
   */
  private disableFollow(): void {
    this.followCtl.disable();
  }

  /**
   * Conversation count of a static edge's directional pair (spec
   * §Execution stats, per-pair spawn counters). One O(1) Map lookup
   * per edge; feeds the count pill and gates the historical click.
   */
  protected convoCountFor(edge: IGraphEdge): number {
    return this.convoCountForKey(edgePairKey(edge.from, edge.to));
  }

  /**
   * Key-form sibling of `convoCountFor` for the dashed spawn edges,
   * whose pair key is precomputed by `resolveSpawnOverlay` (session
   * parents key by the raw owner, not the `session:<owner>` node id).
   */
  protected convoCountForKey(pairKey: string): number {
    return this.activityStats.pairCounts().get(pairKey) ?? 0;
  }

  /**
   * Static-edge click, two live paths plus a no-op:
   *
   *   1. A spawn-active edge (a live spawn rides it) opens through the
   *      SAME path as the dashed spawn edge (supersession guard
   *      included), the live spawnId wins.
   *   2. A plain edge whose pair has counted conversations opens the
   *      HISTORICAL thread: the child's activity detail filtered to
   *      this parent, grouped, most recent thread first.
   *   3. A label-less static edge stays selection-only (no fetch, no
   *      dialog).
   */
  protected onStaticEdgeClick(edge: IGraphEdge, event: MouseEvent): void {
    const spawnId = this.spawnActiveIdFor(edge);
    if (spawnId !== null) {
      this.onSpawnEdgeClick(spawnId, event);
      return;
    }
    if (this.convoCountFor(edge) === 0) return;
    // Keep the click from bubbling to the canvas wrap (mirrors the
    // spawn-edge handler): it would clear the node selection.
    event.stopPropagation();
    void this.conversation.openHistorical({
      parentPath: edge.from,
      childPath: edge.to,
      pairKey: edgePairKey(edge.from, edge.to),
    });
  }

  /**
   * Conversation dialog (spec §Conversation capture), state machine
   * shared with the inspector via
   * `conversation-dialog.controller.ts` (the inspector's activity rows
   * drive the same dialog through the no-fetch `openThread` path). The
   * graph opens it from edge clicks: a spawn edge fetches the record
   * by id and widens it to the full parent-child thread, a labelled
   * static edge opens the pair's historical thread; scan-link edges
   * stay non-clickable. Supersession between racing clicks lives in
   * the controller.
   */
  private readonly conversation = setupConversationDialog({ dataSource: this.dataSource });
  protected readonly conversationOpen = this.conversation.open;
  protected readonly conversationThread = this.conversation.thread;
  protected readonly conversationCaptureEnabled = this.conversation.captureEnabled;

  protected onSpawnEdgeClick(spawnId: string, event: MouseEvent): void {
    // Keep the click from bubbling to the canvas wrap, which would
    // clear the node selection underneath the dialog.
    event.stopPropagation();
    void this.conversation.openSpawn(spawnId);
  }

  protected onConversationClosed(): void {
    this.conversation.close();
  }

  // Layout-popover labelers + setters + per-item icon helpers now live
  // inside `<sm-graph-layout-toolbar>`. The toolbar owns the popover
  // surface end-to-end (catalogs, dynamic icons, click handlers).
}
