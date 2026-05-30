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
import { DagreLayoutEngine } from '@foblex/flow-dagre-layout';

import { GRAPH_VIEW_TEXTS } from '../../../i18n/graph-view.texts';
import { DEFAULT_SETTINGS } from '../../../models/settings';

import { CollectionLoaderService } from '../../../services/collection-loader';
import { FilterStoreService } from '../../../services/filter-store';
import { GraphPreferencesService } from '../../../services/graph-preferences';
import { IssuePathsService } from '../../../services/issue-paths';
import { resolveConnectionSides } from './connection-sides';
import { GraphLayoutToolbar } from './graph-layout-toolbar/graph-layout-toolbar';
import { KindPalette } from '../../components/kind-palette/kind-palette';
import { LinkKindPalette } from '../../components/link-kind-palette/link-kind-palette';
import { SeverityPalette } from '../../components/severity-palette/severity-palette';
import { NodeCard } from '../../components/node-card/node-card';
import { PerfHud } from '../../components/perf-hud/perf-hud';
/* DEBUG-SLOTS: remove with debug-slots.css. */
import { ViewContributionsHost } from '../../components/view-contributions-host/view-contributions-host';
import { DebugPerfService } from '../../services/debug-perf';
import { UsageTrackerService } from '../../services/usage-tracker';
import { InspectorView } from '../inspector-view/inspector-view';
import { MiddleMousePanDirective } from './middle-mouse-pan';
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
import { bindSelectionToUrl } from './selection-url-sync';
import {
  readStoredNodePositions,
  readStoredPanelWidth,
  readStoredViewport,
  writeStoredNodePositions,
  writeStoredPanelWidth,
} from './graph-view.storage';
import { setupPanelResize } from './panel-resize.controller';
import { setupTagSelection } from './tag-selection.controller';
import { setupViewportStore, ZOOM_MIN, ZOOM_MAX } from './viewport-store';
import { isAnyPrimengOverlayOpen } from './graph-view.utils';
import { createSelectionState, type ISelectionView } from './selection-state';
import { setupNodeDrag } from './node-drag.controller';
import { setupExpansion } from './expansion.controller';
import { setupLayoutFit } from './layout-fit.controller';
import { animateViewport, computeFitTransform } from './viewport-animation';

const ZOOM_BUTTON_STEP = 0.2;

/** Tween duration (ms) for the auto-fit on WS-scan topology change. A
 *  hair longer than the tag-selection tween (320 ms) so the "scan
 *  brought in new nodes, camera glides to frame them" beat reads as a
 *  distinct event without dragging the UX. */
const AUTO_FIT_ANIM_MS = 420;

/**
 * Edge opacity tunables. `DIMMED` paints a flat fade for edges outside
 * the selection halo; the active edges run a confidence-weighted
 * gradient `MIN + RANGE * confidence` so high-confidence links read
 * solid and low-confidence ones recede. `CONFIDENCE_DEFAULT` fills in
 * when an edge's `confidence` is missing from the projection.
 */
const EDGE_OPACITY_DIMMED = 0.15;
const EDGE_OPACITY_MIN = 0.25;
const EDGE_OPACITY_RANGE = 0.75;
const EDGE_CONFIDENCE_DEFAULT = 0.6;

/** Default selection bundle when a node is not yet in the selection map. */
const SELECTION_DEFAULT: ISelectionView = {
  selected: false,
  highlighted: false,
  dimmed: false,
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
    GraphLayoutToolbar,
    KindPalette,
    LinkKindPalette,
    SeverityPalette,
    NodeCard,
    PerfHud,
    InspectorView,
    ButtonModule,
    ConfirmDialogModule,
    TooltipModule,
    /* DEBUG-SLOTS: remove with debug-slots.css. */
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
  private readonly graphPreferences = inject(GraphPreferencesService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dagreLayout = inject(DagreLayoutEngine);
  private readonly injector = inject(Injector);
  private readonly usageTracker = inject(UsageTrackerService);

  private readonly flow = viewChild(FFlowComponent);
  // Protected: template binds `[smMiddleMousePan]="canvas()"` to feed
  // the middle-mouse pan directive.
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
   * PerfHud visibility. Gated by `DebugPerfService` (`?debug-perf=1` /
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

  // Inspector panel width, owned by `setupPanelResize`. Drag handle
  // bindings come straight off the returned handle.
  private readonly panelResize = setupPanelResize({
    destroyRef: this.destroyRef,
    initialWidth: readStoredPanelWidth() ?? 400,
    onCommit: (width) => writeStoredPanelWidth(width),
  });
  protected readonly clampedPanelWidth = this.panelResize.clampedPanelWidth;

  readonly loading = this.loader.loading;
  readonly error = this.loader.error;

  /**
   * Visible node set. Delegates everything to `FilterStoreService.apply`,
   * passing the `IssuePathsService.bySeverity` index so the severity
   * palette toggles work end-to-end. AND semantics across tiers (both
   * on means a node must carry at least one error AND at least one
   * warn) lives inside `apply()`; the view only feeds the context.
   */
  private readonly visibleNodes = computed(() =>
    this.filters.apply(this.loader.nodes(), this.issuePaths.bySeverity()),
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

  readonly graph = computed<IGraphData>(() => {
    const visibleIds = new Set(this.visibleNodes().map((n) => n.path));
    const linkKinds = this.filters.selectedLinkKinds();
    const visibleEdgeKinds = linkKinds.length > 0 ? new Set(linkKinds) : null;
    return projectVisible(
      this.fullLayout(),
      visibleIds,
      this.nodePositions(),
      visibleEdgeKinds,
    );
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
      !this.filters.kindToggleExplicitEmpty() &&
      this.filters.searchText().trim().length === 0,
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
      () =>
        this.loader.nodes().map(
          (n) => ({ id: n.path, view: { path: n.path } }) as unknown as IGraphNode,
        ),
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
    if (this.loader.nodes().length === 0 && !this.loader.loading()) {
      void this.loader.load();
    }
  }

  onLoaded(): void {
    // Intentional no-op, `setupLayoutFit` owns the initial fit and
    // the prefs-change fit lives in the layout effect. Kept as a
    // template hook in case we need a render-complete callback later.
  }

  protected readonly onCanvasChange = this.viewportStore.onCanvasChange;

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
        if (scale <= this.zoomMax && scale >= this.zoomMin) return;
        const clamped = Math.max(this.zoomMin, Math.min(scale, this.zoomMax));
        const step = Math.abs(scale - clamped);
        const direction = scale > clamped ? EFZoomDirection.ZOOM_OUT : EFZoomDirection.ZOOM_IN;
        // `FZoomDirective.setZoom` clamps via `SetZoom._clamp` (the same
        // path wheel + button zoom go through), so it lands exactly at
        // `zoomMin` / `zoomMax`. Non-animated to keep the snap atomic
        // inside this render cycle.
        zoom?.setZoom(this.getViewportCenter(), step, direction, false);
      },
      { injector: this.injector },
    );
  }

  /** Supersession token for the auto-fit tween, increments on each
   *  call so a back-to-back WS scan refresh cancels the in-flight tween
   *  cleanly (mirrors the tag-selection pattern). */
  private autoFitAnimToken = 0;

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

  /** Public-facing scheduler the layout-fit controller wires into
   *  `animatedFit`. Just marks intent; the deferred runner does the work. */
  private animatedFitToScreen(): void {
    this.autoFitPending = true;
  }

  /**
   * Run the deferred animated fit. Pure signal tween via
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
    const host = this.canvasWrap()?.nativeElement;
    if (!host) return;
    const wrap = { width: host.clientWidth, height: host.clientHeight };
    const layoutPositions = this.fullLayout().positions;
    if (layoutPositions.size === 0) return;
    // Resolve EFFECTIVE positions the same way `projectVisible` does:
    // user-pinned (`nodePositions`) takes precedence over the dagre
    // output, with the layout map as the fallback. Reading just the
    // dagre map here would tween toward a bbox that doesn't match
    // what's actually rendered after manual drags, producing the
    // "zoom expanded too much" symptom the user reported.
    const pinned = this.nodePositions();
    const visiblePaths = this.visibleNodes().map((n) => n.path);
    const points: IPoint[] = [];
    for (const path of visiblePaths) {
      const pt = pinned.get(path) ?? layoutPositions.get(path);
      if (pt) points.push({ x: pt.x, y: pt.y });
    }
    if (points.length === 0) return;

    const transform = computeFitTransform({
      points,
      wrap,
      panelW: this.selectedNodeId() !== null ? this.clampedPanelWidth() : 0,
      zoomMin: this.zoomMin,
    });
    if (!transform) return;

    const token = ++this.autoFitAnimToken;
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
  }

  onNodePositionChange(id: string, position: IPoint): void {
    this.nodeDrag.onNodePositionChange(id, position);
  }

  zoomIn(): void {
    this.zoom()?.setZoom(this.getViewportCenter(), ZOOM_BUTTON_STEP, EFZoomDirection.ZOOM_IN, true);
  }

  zoomOut(): void {
    this.zoom()?.setZoom(this.getViewportCenter(), ZOOM_BUTTON_STEP, EFZoomDirection.ZOOM_OUT, true);
  }

  fitToScreen(): void {
    this.fitToScreenClamped();
  }

  resetLayout(): void {
    const t = GRAPH_VIEW_TEXTS.resetLayoutConfirm;
    this.confirmationService.confirm({
      header: t.header,
      message: t.message,
      icon: 'pi pi-exclamation-triangle',
      acceptButtonProps: { label: t.accept, severity: 'danger' },
      rejectButtonProps: { label: t.reject, severity: 'secondary', outlined: true },
      accept: () => {
        // Clearing `nodePositions` here is the only mechanical step needed:
        // the reconcile effect runs on the next tick, sees an empty map plus
        // the current auto-layout, and reseeds every visible node, then
        // persists the freshly-computed positions to storage. That's why
        // "reset" ends up doing the full delete → re-arrange → save loop
        // without any explicit save call here.
        this.nodePositions.set(new Map());
        // Reset layout also collapses every expanded card. The intent of
        // "reset" is "give me back a clean canvas", leaving cards open
        // would re-introduce the size variation that made the user reach
        // for reset in the first place.
        this.expansion.resetAll();
        this.fitToScreenClamped();
      },
    });
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

  selectNode(node: IGraphNode, event: MouseEvent): void {
    if (!this.nodeDrag.isClickWithoutDrag(event)) return;
    this.selectedNodeId.set(node.id);
    // Opening the node inspector is a tracked feature usage (no node id,
    // path, or title is ever sent, only the `inspector` surface enum).
    this.usageTracker.trackFeature('inspector');
  }

  // Tag-selection state machine (active tag, viewport snapshot, fit /
  // restore animation), owned by `setupTagSelection`. The graph view
  // still owns the multi-select trigger surface (`onTagSelect` wired
  // to the inspector's tag chip output) and the `activeTagSelection`
  // signal it reads for the dim suspension.
  private readonly tagSelection = setupTagSelection({
    flow: this.flow,
    nodes: this.loader.nodes,
    fullLayout: computed(() => this.fullLayout()),
    canvasWrap: () => {
      const host = this.canvasWrap()?.nativeElement;
      if (!host) return null;
      return { width: host.clientWidth, height: host.clientHeight };
    },
    selectedNodeId: this.selectedNodeId,
    clampedPanelWidth: this.clampedPanelWidth,
    zoomMin: ZOOM_MIN,
    viewportPosition: this.viewportPosition,
    viewportScale: this.viewportScale,
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
    this.panelResize.onPanelResizeStart(event);
  }

  openNode(node: IGraphNode): void {
    // Embedded inspector mode: dblclick selects (single click already does
    // the same, kept the handler so the gesture has a clear intent).
    this.selectedNodeId.set(node.id);
  }

  /**
   * Click anywhere on the canvas that is NOT a node deselects. Foblex's
   * `<f-flow>` does not expose a "background click" event, so we listen on
   * the wrapper and filter by target.
   */
  onCanvasClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest('.sm-gnode')) return;
    if (target?.closest('.graph__toolbar')) return;
    if (target?.closest('.perf-hud')) return;
    if (target?.closest('.kind-palette')) return;
    if (target?.closest('.graph__panel')) return;
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

  isEdgeHighlighted(edge: IGraphEdge): boolean {
    return this.selectionState.isEdgeHighlighted(edge);
  }

  isEdgeDimmed(edge: IGraphEdge): boolean {
    return this.selectionState.isEdgeDimmed(edge);
  }

  /**
   * Map a numeric `[0..1]` `IGraphEdge.confidence` to the SVG opacity
   * applied via `[style.opacity]` on the `<f-connection>`. The floor
   * of `0.25` keeps even the most uncertain link readable; the slope
   * of `0.75` puts a confident link (`>= 0.9`) within a hair of fully
   * opaque so the operator's eye follows the strongest signal. The
   * mapping is intentionally linear: a non-linear curve would amplify
   * any clustering of extractor emissions in the middle of the range
   * (see the plan's "Edge opacity from confidence" risk note).
   *
   * Selection overrides: when another edge is highlighted and this
   * one is dimmed, return the fixed dim value (`0.15`) so the
   * selection fade reads consistently across kinds and confidences.
   * Inline styles win over class styles in CSS specificity, so this
   * function is the single source of truth for the f-connection
   * opacity, `.f-conn--dimmed` no longer applies its rule. Highlighted
   * edges keep the confidence-derived value since the highlight reads
   * through stroke width + colour, not opacity.
   */
  edgeOpacity(edge: IGraphEdge): number {
    if (this.isEdgeDimmed(edge)) return EDGE_OPACITY_DIMMED;
    const confidence =
      typeof edge.confidence === 'number' ? edge.confidence : EDGE_CONFIDENCE_DEFAULT;
    return EDGE_OPACITY_MIN + EDGE_OPACITY_RANGE * confidence;
  }

  // Layout-popover labelers + setters + per-item icon helpers now live
  // inside `<sm-graph-layout-toolbar>`. The toolbar owns the popover
  // surface end-to-end (catalogs, dynamic icons, click handlers).
}
