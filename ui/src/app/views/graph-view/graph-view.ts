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
  provideFFlow,
  provideFLayout,
  withA11y,
} from '@foblex/flow';
import type { FCanvasChangeEvent, FSelectionChangeEvent } from '@foblex/flow';
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
import { BranchCapBanner } from './branch-cap-banner/branch-cap-banner';
import { GraphLayoutToolbar } from './graph-layout-toolbar/graph-layout-toolbar';
import { ConversationDialog } from '../../components/conversation-dialog/conversation-dialog';
import { KindPalette } from '../../components/kind-palette/kind-palette';
import { LinkKindPalette } from '../../components/link-kind-palette/link-kind-palette';
import { AgentCapsule } from '../../components/agent-capsule/agent-capsule';
import { SessionNode } from '../../components/session-node/session-node';
import { SeverityPalette } from '../../components/severity-palette/severity-palette';
import { NodeCard } from '../../components/node-card/node-card';
import { PerfHud } from '../../components/perf-hud/perf-hud';
/* ViewContributionsHost: real graph.node.alert slot mount (also ringed by the kept debug-slots overlay; see context/ui.md). */
import { ViewContributionsHost } from '../../components/view-contributions-host/view-contributions-host';
import { DebugPerfService } from '../../services/debug-perf';
import { A11yAnnouncerService } from '../../services/a11y-announcer';
import { pathBasenameForLink } from '../../../services/path-basename';
import { InspectorView } from '../inspector-view/inspector-view';
import { MiddleMousePanDirective, type IMiddleMousePanTarget } from './middle-mouse-pan';
import {
  computeDagreLayout,
  computeForceLayoutPositions,
  topologyFingerprint,
  type IGraphEdge,
  type IGraphNode,
  type IPoint,
  type TNodePositions,
} from './graph-layout';
import { reconcileNodePositions } from './graph-view.reconcile';
import { bindSelectionToUrl } from './selection-url-sync';
import {
  readStoredNodePositions,
  readStoredPanelWidth,
  readStoredViewport,
  writeStoredNodePositions,
  writeStoredPanelWidth,
} from './graph-view.storage';
import { setupEdgeResize } from '../../core/edge-resize.controller';
import { setupTagSelection } from './tag-selection.controller';
import { setupViewportStore, ZOOM_MIN, ZOOM_MAX } from './viewport-store';
import { isAnyPrimengOverlayOpen, isFlowDragging } from './graph-view.utils';
import type { IEdgeSelectionView, ISelectionView } from '../../../models/selection';
import { createSelectionState } from './selection-state';
import { setupNodeDrag } from './node-drag.controller';
import { setupExpansion } from './expansion.controller';
import { setupFollowActivity } from './follow-activity.controller';
import { setupLayoutFit } from './layout-fit.controller';
import { setupGraphPipeline } from './graph-pipeline';
import { setupCamera, type ICameraHandle } from './camera.controller';
import { setupSpawnAnchors } from './spawn-anchors.controller';
import { type IViewportTransform } from './viewport-animation';

const ZOOM_BUTTON_STEP = 0.2;

/** Inspector panel width the view opens at when nothing is persisted. */
const PANEL_WIDTH_DEFAULT = 500;
const PANEL_WIDTH_MIN = 400;
/** Minimum graph area to keep visible at any viewport width. */
const PANEL_VIEWPORT_RESERVE = 80;
/** Pixels the inspector panel grows / shrinks per arrow keypress (WCAG 2.1.1). */
const PANEL_RESIZE_STEP = 24;

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
    AgentCapsule,
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
    // Opt-in keyboard layer (Foblex v19): arrows move the selection
    // spatially, Home/End jump to first/last node, Ctrl/Cmd+arrow walks
    // the topology, Space+arrows moves the selected node (feature parity
    // with mouse drag; flows through the same fNodePositionChange
    // buffer). The graph is read-only, so the connection-creation and
    // delete actions are unbound. Selection ownership: Foblex is the
    // single owner, see `applySelection` / `onFlowSelectionChange`.
    provideFFlow(
      withA11y({
        keys: {
          connect: [],
          deleteSelected: [],
        },
      }),
    ),
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
  protected readonly nodeActivity = inject(NodeActivityService);
  private readonly activityStats = inject(NodeActivityStatsService);
  private readonly agentSpawns = inject(AgentSpawnService);
  private readonly livePrefs = inject(LivePreferencesService);
  private readonly dataSource = inject(DATA_SOURCE);
  private readonly announcer = inject(A11yAnnouncerService);

  private readonly flow = viewChild(FFlowComponent);
  // Inspector panel container, focused (and announced) when a node
  // becomes selected so keyboard / screen-reader users land on the
  // freshly opened details instead of staying on the canvas (WCAG 2.4.3).
  private readonly inspectorPanel = viewChild<ElementRef<HTMLElement>>('inspectorPanel');
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
    // A drag repositions a node, it does not inspect it. Foblex selected
    // the grabbed node on pointerdown and `onFlowSelectionChange` refused
    // to mirror that (see there); re-asserting the app's own selection
    // here realigns both sides, so the drag leaves selection untouched.
    onDragEnd: () => this.applySelection(this.selectedNodeId()),
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

  // Pure derivation chain (visible set -> topology -> layout -> graph),
  // owned by `setupGraphPipeline`. See `graph-pipeline.ts` for the
  // per-computed rationale (topology-fingerprint caching, link-kind
  // whitelist semantics, perf counters, connector sides). The aliases
  // below keep the template bindings and the rest of this component on
  // the pre-extraction member names.
  private readonly pipeline = setupGraphPipeline({
    nodes: this.loader.nodes,
    scan: this.loader.scan,
    filters: this.filters,
    issuesBySeverity: this.issuePaths.bySeverity,
    nodePositions: this.nodePositions,
    layoutAlgorithm: this.graphPreferences.layoutAlgorithm,
    layoutDirection: this.graphPreferences.layoutDirection,
  });
  private readonly visibleNodes = this.pipeline.visibleNodes;
  private readonly topology = this.pipeline.topology;
  /** Dagre output signals, written by the async layout effect in the constructor. */
  private readonly layoutPositions = this.pipeline.layoutPositions;
  private readonly layoutComputedAtSignal = this.pipeline.layoutComputedAtSignal;
  private readonly fullLayout = this.pipeline.fullLayout;
  private readonly mapVisiblePaths = this.pipeline.mapVisiblePaths;
  readonly graph = this.pipeline.graph;
  private readonly fullAdjacency = this.pipeline.fullAdjacency;
  private readonly pathsFingerprint = this.pipeline.pathsFingerprint;

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

  /** Counters / timestamp exposed to the perf HUD. Pure derivations in the pipeline. */
  protected readonly visibleCount = this.pipeline.visibleCount;
  protected readonly totalCount = this.pipeline.totalCount;
  protected readonly edgeCount = this.pipeline.edgeCount;
  protected readonly layoutComputedAt = this.pipeline.layoutComputedAt;

  // Connector sides per layout direction (direction table +
  // force-layout fallback live in `./connection-sides`, the computeds
  // in `graph-pipeline.ts`).
  protected readonly inputSide = this.pipeline.inputSide;
  protected readonly outputSide = this.pipeline.outputSide;

  /**
   * Fixed sides for overlay-chrome spawn edges (`edge.vertical`): the
   * overlay always places vertically (session above, capsules below
   * their anchor), so the arrow leaves the source's underside and
   * enters the target's top whatever the layout direction is.
   */
  protected readonly overlaySourceSide = EFConnectionConnectableSide.BOTTOM;
  protected readonly overlayTargetSide = EFConnectionConnectableSide.TOP;

  // Layout-control catalogs, labelers, setters, and dynamic icons now
  // live in `<sm-graph-layout-toolbar>` (graph-layout-toolbar/). The
  // toolbar reads + writes `GraphPreferencesService` directly so no
  // wiring crosses the parent-child boundary.

  readonly selectedNodeId = signal<string | null>(null);

  /**
   * Focus + announce management for the inspector panel (WCAG 2.4.3 +
   * 4.1.3). Tracks the previously selected id so the effect fires ONLY
   * on a real null -> id (or id -> other id) transition, never on the
   * unrelated re-renders that also read `selectedNodeId` (highlight,
   * dim, layout). On a genuine selection it moves keyboard focus into
   * the inspector container and announces the node name; on a
   * deselection it hands focus BACK (see the closing branch).
   */
  private previousSelectedId: string | null = null;
  private readonly selectionFocusEffect = effect(() => {
    const id = this.selectedNodeId();
    const prev = untracked(() => this.previousSelectedId);
    if (id === prev) return;
    this.previousSelectedId = id;
    if (id === null) {
      // Closing branch. The panel slides off-screen AND goes `inert`
      // (see the template), so focus parked inside it is dropped on
      // `<body>` and the keyboard user is stranded at the top of the
      // document with no way back to the node they were reading. Return
      // focus where it came from, the node host that was just
      // deselected, and fall back to the canvas wrap when that node is
      // gone (filtered away, re-scanned out, map curation). The
      // `previousSelectedId` bookkeeping above is untouched: `prev` is
      // the id we are closing, and it is non-null here because an
      // id === prev transition already returned.
      if (prev !== null) {
        this.announcer.announce(GRAPH_VIEW_TEXTS.a11y.nodeDeselected);
        afterNextRender(() => this.restoreFocusAfterClose(prev), {
          injector: this.injector,
        });
      }
      return;
    }
    const node = untracked(() => this.graph().nodes.find((n) => n.id === id));
    if (!node) return;
    this.announcer.announce(GRAPH_VIEW_TEXTS.a11y.nodeSelected(this.nodeDisplayName(node)));
    // The panel is always in the DOM (visibility toggles via `is-open`),
    // so the viewChild resolves; move focus after the current render.
    // `preventScroll` is load-bearing: the closed panel sits at
    // `translateX(100%)` INSIDE the overflow-hidden canvas wrap, so a
    // plain focus() mid slide-in makes the browser scroll the wrap to
    // reveal it (the whole graph lurches left, then glides back as the
    // transition lands and the overflow clamps scrollLeft back to 0).
    afterNextRender(
      () => this.inspectorPanel()?.nativeElement.focus({ preventScroll: true }),
      { injector: this.injector },
    );
  });

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
    if (!exists) this.applySelection(null);
  });

  // URL ↔ selection deep-link wiring lives in `bindSelectionToUrl`,
  // see `selection-url-sync.ts` for the loop-guard contract. Called
  // from the constructor below.

  /**
   * Tick stamped by the reconcile effect once it has processed a dagre
   * pass (dirty or not): its value is that pass's `computedAt`, so one
   * stamp maps to exactly one layout run and the echo re-run the
   * `nodePositions` write triggers re-stamps the same value (no
   * propagation). The camera's deferred fits key on THIS instead of the
   * raw `layoutComputedAt` tick: "positions are reconciled" is a data
   * dependency, not an effect creation-order coincidence (Angular does
   * not guarantee sibling-effect execution order, only the
   * `afterRender*` family documents ordering).
   */
  private readonly layoutReconciledAt = signal(0);

  // Camera controller handle (fit / center / tween orchestration).
  // Assigned in the constructor; closures created before the assignment
  // (layout-fit's `fit`, follow's `animateToTransform`) only
  // dereference it at call time, safely after construction. Its
  // deferred fits react to `layoutReconciledAt` (stamped by the
  // reconcile effect), so no ordering contract between the two exists.
  private camera!: ICameraHandle;

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
    fit: () => this.camera.fitToScreenClamped(),
    animatedFit: () => this.camera.animatedFitToScreen(),
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
      setSelectedNodeId: (id) => this.applySelection(id),
      readSelectedNodeId: () => this.selectedNodeId(),
      graphNodes: selectionNodes,
      // A deep link from the files view ("open in map") should glide
      // the camera onto the node. Stash the id; the camera's center
      // effect runs the pan once the boot fit has fixed the zoom and
      // the dagre positions are in.
      onDeepLinkSelect: (id) => {
        this.camera.pendingCenterNodeId.set(id);
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
    // The camera's deferred fits (`runAnimatedFit` reads `nodePositions`
    // for the bbox) must see post-reconcile geometry, so this effect
    // stamps `layoutReconciledAt` AFTER the positions write and the
    // camera keys on that stamp, never on the raw layout tick. The
    // stamp value is the pass's own `computedAt`, so the echo re-run
    // this effect's `nodePositions` write triggers re-stamps the same
    // number and propagates nothing.
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
      if (result.dirty) {
        this.nodePositions.set(result.next);
        writeStoredNodePositions(result.next);
      }
      this.layoutReconciledAt.set(layout.computedAt);
    });

    // Fit / center / tween orchestration, owned by `setupCamera`
    // (auto-fit runner, deep-link center pan, curation re-fit debounce;
    // see `camera.controller.ts` for each effect's rationale). Its
    // deferred fits key on `layoutReconciledAt` (stamped by the
    // reconcile effect above), so creation order between the two is
    // irrelevant: the camera only wakes once reconciled positions are
    // in `nodePositions`.
    this.camera = setupCamera({
      injector: this.injector,
      destroyRef: this.destroyRef,
      canvas: () => this.canvas(),
      zoom: () => this.zoom(),
      canvasWrap: () => this.canvasWrap()?.nativeElement ?? null,
      viewportPosition: this.viewportPosition,
      viewportScale: this.viewportScale,
      storeOnCanvasChange: (event) => this.viewportStore.onCanvasChange(event),
      zoomMin: this.zoomMin,
      nodes: this.loader.nodes,
      topology: this.topology,
      fullLayout: this.fullLayout,
      mapVisiblePaths: this.mapVisiblePaths,
      layoutSettledAt: this.layoutReconciledAt,
      nodePositions: this.nodePositions,
      reservedPanelWidth: () => this.reservedPanelWidth(),
      hasCompletedInitialLayout: () => this.layoutFit.hasCompletedInitialLayout(),
      graphPreferences: this.graphPreferences,
      dagreLayout: this.dagreLayout,
      framing: () => this.followCtl.framing(),
      disableFollow: () => this.disableFollow(),
      resetExpansion: () => this.expansion.resetAll(),
      curationOverrides: this.mapVisibility.overrides,
      activeTagSelection: this.activeTagSelection,
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
            this.camera.fitToScreenClamped();
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
   * Canvas change handler, bound in the template. The gesture semantics
   * (viewport mirroring + persistence, the follow interrupt on an
   * in-flight tween) live in `camera.controller.ts`.
   */
  protected onCanvasChange(event: FCanvasChangeEvent): void {
    this.camera.onCanvasChange(event);
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
    if (outcome === 'isolated') this.applySelection(path);
  }

  onNodePositionChange(id: string, position: IPoint): void {
    this.nodeDrag.onNodePositionChange(id, position);
  }

  // Zoom / fit keep follow armed (every toolbar button does now): they
  // reposition the camera now, and follow re-grabs it on the next
  // activity change. Neither changes layout or membership, so the follow
  // effect does not re-fire and there is nothing to race with.
  zoomIn(): void {
    this.zoom()?.setZoom(this.camera.getViewportCenter(), ZOOM_BUTTON_STEP, EFZoomDirection.ZOOM_IN, true);
  }

  zoomOut(): void {
    this.zoom()?.setZoom(this.camera.getViewportCenter(), ZOOM_BUTTON_STEP, EFZoomDirection.ZOOM_OUT, true);
  }

  fitToScreen(): void {
    this.camera.runAnimatedFit();
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
      this.camera.applyResetLayout(visiblePaths, full);
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
      accept: () => this.camera.applyResetLayout(visiblePaths, full),
    });
  }

  // Middle-mouse pan is owned by the `[smMiddleMousePan]` directive
  // applied to `.graph__canvas-wrap` in the template, handlers,
  // origin state, rAF coalescing, and cleanup all live there.

  onNodePointerDown(event: PointerEvent): void {
    this.nodeDrag.onNodePointerDown(event);
  }

  // Session-anchor + agent-capsule drags (ephemeral overrides, per-move
  // write-back, `mouseup` drag-end per skill rule 9) are owned by
  // `setupSpawnAnchors`; see `spawn-anchors.controller.ts` for the
  // deliberate rule 9 divergence rationale. One-line delegations keep
  // the template bindings unchanged.
  onSessionPointerDown(owner: string): void {
    this.spawnAnchors.onSessionPointerDown(owner);
  }

  onSessionPositionChange(owner: string, position: IPoint): void {
    this.spawnAnchors.onSessionPositionChange(owner, position);
  }

  onAgentCapsulePointerDown(id: string): void {
    this.spawnAnchors.onAgentCapsulePointerDown(id);
  }

  onAgentCapsulePositionChange(id: string, position: IPoint): void {
    this.spawnAnchors.onAgentCapsulePositionChange(id, position);
  }

  selectNode(node: IGraphNode, event: MouseEvent): void {
    if (!this.nodeDrag.isClickWithoutDrag(event)) return;
    this.applySelection(node.id);
  }

  /**
   * Selection single-owner contract (Foblex v19 keyboard layer): Foblex's
   * internal selection is the source of truth. Every PROGRAMMATIC write
   * (click handler, isolate, deep links, escape/background deselect, the
   * filter guard) goes through here so the canvas paint (`.f-selected`),
   * the keyboard layer's active item, and the app state (`selectedNodeId`
   * driving inspector panel + adjacency highlight + dim) can never
   * diverge. User gestures (arrow keys, Shift+area, Ctrl/Cmd+A) flow the
   * other way: Foblex mutates its own selection and reports through
   * `onFlowSelectionChange`. Writes are idempotent, so the two paths
   * converging on the same id is harmless.
   */
  private applySelection(id: string | null): void {
    this.selectedNodeId.set(id);
    this.flow()?.select(id === null ? [] : [id], [], false);
  }

  /**
   * Foblex → app bridge of the single-owner contract. Exactly one
   * selected node drives the inspector/highlight state; empty and
   * multi-node selections (Shift+area rectangle, Ctrl/Cmd+A) both map to
   * "no inspected node", matching the pre-keyboard behavior where only
   * a single click selected.
   */
  protected onFlowSelectionChange(event: FSelectionChangeEvent): void {
    // Grabbing a node to MOVE it is not a request to inspect it. Foblex
    // selects whatever sits under the pointer on pointerdown and reports
    // that selection the moment the drag threshold is crossed, which
    // would pop the inspector open mid-drag. Drag-induced changes are
    // dropped here (the `f-dragging` host class is the only signal
    // available this early, see `isFlowDragging`); the node-drag
    // controller's `onDragEnd` re-asserts the app selection into Foblex
    // once the gesture settles, so the two sides never stay divergent.
    // A click that never moved is unaffected: the class is never
    // stamped, the event arrives on pointerup, and the inspector opens.
    if (isFlowDragging(this.flow()?.hostElement)) return;
    const ids = event.nodeIds;
    if (ids.length === 1) {
      this.selectedNodeId.set(ids[0] ?? null);
      return;
    }
    // Connection-only selection: the Ctrl+arrow topology walk stops on
    // the connection before hopping to its far node (upstream design,
    // not configurable), and a mouse click can select an edge. Neither
    // should blink the inspector shut, so the last inspected node is
    // preserved (same as the pre-keyboard behavior, where edge clicks
    // never touched the app selection). Empty and multi-node
    // selections still clear it.
    if (ids.length === 0 && event.connectionIds.length > 0) return;
    this.selectedNodeId.set(null);
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
    this.applySelection(null);
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
    this.applySelection(node.id);
  }

  /**
   * Keyboard activation of a node host (WCAG 2.1.1 / 4.1.2). Mirrors the
   * `(click)` select without the drag guard (`selectNode` rejects a
   * click that was really a drag, which cannot happen from the keyboard).
   * Enter/Space select; the selection effect then moves focus into the
   * inspector. Spatial arrow-key navigation across the canvas belongs to
   * the Foblex keyboard layer (installed via `provideFFlow(withA11y(...))`
   * above), which drives its own active item through `aria-activedescendant`
   * on the `<f-flow>` host; this handler only provides the tab-reachable
   * activation the AA level requires on the node host itself.
   */
  selectNodeByKeyboard(node: IGraphNode, event: Event): void {
    event.preventDefault();
    this.applySelection(node.id);
  }

  /** Display name for a node host (frontmatter name, else a friendly basename). */
  nodeDisplayName(node: IGraphNode): string {
    return node.view.frontmatter.name ?? pathBasenameForLink(node.view.path);
  }

  /** Accessible name for a node host: name + kind + selection state. */
  nodeHostLabel(node: IGraphNode): string {
    return GRAPH_VIEW_TEXTS.a11y.nodeHost(
      this.nodeDisplayName(node),
      node.view.kind,
      this.isSelected(node.id),
    );
  }

  /**
   * Focus destination after the inspector panel closes (WCAG 2.4.3):
   * the node host that was just deselected, i.e. the element that opened
   * the panel, else the canvas wrap (`tabindex="-1"`, a focus target and
   * not a tab stop). Called once per close from `selectionFocusEffect`.
   */
  private restoreFocusAfterClose(deselectedId: string): void {
    const wrap = this.canvasWrap()?.nativeElement ?? null;
    if (!wrap) return;
    (this.nodeHostElement(wrap, deselectedId) ?? wrap).focus({ preventScroll: true });
  }

  /**
   * The rendered `<div fNode>` host for `nodeId`, or null when the node
   * is outside the render window (virtualisation) or gone from the graph.
   *
   * Matched by reading each host's `data-testid` instead of composing a
   * `[data-testid="..."]` selector: node ids are file paths, and a path
   * carrying a quote or a backslash would break the selector string. One
   * pass over the mounted hosts, run only when the panel closes, never
   * per node and never per frame.
   */
  private nodeHostElement(wrap: HTMLElement, nodeId: string): HTMLElement | null {
    const testid = `graph-node-${nodeId}`;
    const hosts = Array.from(wrap.querySelectorAll<HTMLElement>('.sm-gnode-host'));
    return hosts.find((el) => el.dataset['testid'] === testid) ?? null;
  }

  /**
   * Keyboard resize of the inspector panel (WCAG 2.1.1). The panel hugs
   * the right edge, so ArrowLeft widens it and ArrowRight narrows it.
   * `PANEL_RESIZE_STEP` per keypress. Values reflected to the separator's
   * `aria-valuenow`/min/max.
   */
  protected onPanelResizeKey(direction: 'wider' | 'narrower'): void {
    this.panelResize.stepBy(direction === 'wider' ? PANEL_RESIZE_STEP : -PANEL_RESIZE_STEP);
  }

  protected readonly panelResizeMin = this.panelResize.minWidth;
  protected readonly panelResizeMax = this.panelResize.maxWidth;

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
    this.applySelection(null);
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
   * Literal tool name that lit the node (spec/provider-activity.md
   * §detail), rendered by the card as a transient badge while the glow
   * lasts. One O(1) map lookup per node; `null` when the frame carried
   * no detail.
   */
  executingDetail(id: string): string | null {
    return this.nodeActivity.executionDetails().get(id) ?? null;
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

  // Live-overlay cluster (ephemeral spawn overlay, session anchors,
  // agent capsules, tool-invocation edges, per-pair conversation
  // counters, edge click routing, conversation dialog), owned by
  // `setupSpawnAnchors`; see `spawn-anchors.controller.ts` for the
  // layering + click-routing rationale. `resolveSpawnActiveId` routes
  // through the host's `spawnActiveIdFor` method below so an
  // instance-level pin of that method (the component spec does this)
  // still intercepts the static-edge click routing.
  private readonly spawnAnchors = setupSpawnAnchors({
    destroyRef: this.destroyRef,
    agentSpawns: this.agentSpawns,
    nodeActivity: this.nodeActivity,
    activityStats: this.activityStats,
    livePrefs: this.livePrefs,
    dataSource: this.dataSource,
    nodePositions: this.nodePositions,
    fullLayout: this.fullLayout,
    mapVisiblePaths: this.mapVisiblePaths,
    graph: this.graph,
    resolveSpawnActiveId: (edge) => this.spawnActiveIdFor(edge),
  });
  protected readonly spawnOverlay = this.spawnAnchors.spawnOverlay;
  protected readonly invocationEdges = this.spawnAnchors.invocationEdges;
  protected readonly conversationOpen = this.spawnAnchors.conversationOpen;
  protected readonly conversationThread = this.spawnAnchors.conversationThread;
  protected readonly conversationCaptureEnabled = this.spawnAnchors.conversationCaptureEnabled;

  /** The spawn riding this static edge, or `null` when the edge is plain. */
  protected spawnActiveIdFor(edge: IGraphEdge): string | null {
    return this.spawnAnchors.spawnActiveIdFor(edge);
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
   * The two "look at THIS instead" intents switch follow off: isolate
   * neighborhood and the files-view deep-link center, plus the
   * gesture-interrupt path in `onCanvasChange` (a free-form gesture only
   * counts while a camera move is in flight). Toolbar camera / layout
   * buttons no longer disable. The setter no-ops when already off.
   */
  private disableFollow(): void {
    this.followCtl.disable();
  }

  /**
   * Shared animated-camera entry point, delegated to the camera
   * controller (single supersession token, see `camera.controller.ts`).
   * Kept as a host member so the follow controller's config and every
   * other caller reach the tween through one seam.
   */
  private animateToTransform(transform: IViewportTransform): void {
    this.camera.animateToTransform(transform);
  }

  // Per-pair conversation counters + edge click routing + conversation
  // dialog state live in `setupSpawnAnchors` (see
  // `spawn-anchors.controller.ts`); one-line delegations keep the
  // template bindings unchanged.
  protected convoCountFor(edge: IGraphEdge): number {
    return this.spawnAnchors.convoCountFor(edge);
  }

  protected convoCountForKey(pairKey: string): number {
    return this.spawnAnchors.convoCountForKey(pairKey);
  }

  protected onStaticEdgeClick(edge: IGraphEdge, event: MouseEvent): void {
    this.spawnAnchors.onStaticEdgeClick(edge, event);
  }

  protected onSpawnEdgeClick(spawnId: string, event: MouseEvent): void {
    this.spawnAnchors.onSpawnEdgeClick(spawnId, event);
  }

  protected onConversationClosed(): void {
    this.spawnAnchors.onConversationClosed();
  }

  // Layout-popover labelers + setters + per-item icon helpers now live
  // inside `<sm-graph-layout-toolbar>`. The toolbar owns the popover
  // surface end-to-end (catalogs, dynamic icons, click handlers).
}
