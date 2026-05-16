import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
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
import { PopoverModule } from 'primeng/popover';
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
import {
  LAYOUT_ALGORITHMS,
  LAYOUT_DIRECTIONS,
  LAYOUT_SPACINGS,
  algorithmUsesDirection,
  algorithmUsesSpacing,
  type TLayoutAlgorithm,
  type TLayoutDirection,
  type TLayoutSpacing,
} from './layout-controls';
import { KindPalette } from '../../components/kind-palette/kind-palette';
import { LinkKindPalette } from '../../components/link-kind-palette/link-kind-palette';
import { NodeCard } from '../../components/node-card/node-card';
import { PerfHud } from '../../components/perf-hud/perf-hud';
/* DEBUG-SLOTS: remove with debug-slots.css. */
import { ViewContributionsHost } from '../../components/view-contributions-host/view-contributions-host';
import { DebugPerfService } from '../../services/debug-perf';
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

const ZOOM_BUTTON_STEP = 0.2;

/** Default selection bundle when a node is not yet in the selection map. */
const SELECTION_DEFAULT: ISelectionView = {
  selected: false,
  highlighted: false,
  dimmed: false,
};

interface IConnectionSides {
  readonly input: EFConnectionConnectableSide;
  readonly output: EFConnectionConnectableSide;
}

/**
 * Connector-side pairs per layout direction. Mirrors Foblex's
 * `getDirectionalLayoutConnectionSides` reference helper: in a
 * top-to-bottom layout the source's output sits at the bottom of the
 * card and the target's input at the top; left-to-right swaps the
 * axis. The pair travels to both the `<f-connection>` (`[fOutputSide]`
 * / `[fInputSide]`) and the `<div fNode>` (`[fInputConnectableSide]`
 * / `[fOutputConnectableSide]`), so each card's matching edge becomes
 * the geometric anchor.
 */
const CONNECTION_SIDES_BY_DIRECTION: Readonly<Record<TLayoutDirection, IConnectionSides>> = {
  TOP_BOTTOM: {
    output: EFConnectionConnectableSide.BOTTOM,
    input: EFConnectionConnectableSide.TOP,
  },
  BOTTOM_TOP: {
    output: EFConnectionConnectableSide.TOP,
    input: EFConnectionConnectableSide.BOTTOM,
  },
  LEFT_RIGHT: {
    output: EFConnectionConnectableSide.RIGHT,
    input: EFConnectionConnectableSide.LEFT,
  },
  RIGHT_LEFT: {
    output: EFConnectionConnectableSide.LEFT,
    input: EFConnectionConnectableSide.RIGHT,
  },
};

function sidesForDirection(direction: TLayoutDirection): IConnectionSides {
  return CONNECTION_SIDES_BY_DIRECTION[direction];
}

/**
 * PrimeIcon class for each layout direction. Used by the toolbar
 * direction button so its glyph reflects the current direction at a
 * glance (open the popover only to switch, not to inspect).
 */
const DIRECTION_ICONS: Readonly<Record<TLayoutDirection, string>> = {
  TOP_BOTTOM: 'pi pi-arrow-down',
  BOTTOM_TOP: 'pi pi-arrow-up',
  LEFT_RIGHT: 'pi pi-arrow-right',
  RIGHT_LEFT: 'pi pi-arrow-left',
};

/**
 * PrimeIcon class for each spacing preset. macOS-style window-control
 * gradient: minimize (less space taken) → bars → maximize (more space
 * taken). Same dynamic-button + icon-row popover pattern as direction.
 */
const SPACING_ICONS: Readonly<Record<TLayoutSpacing, string>> = {
  compact: 'pi pi-window-minimize',
  normal: 'pi pi-bars',
  spacious: 'pi pi-window-maximize',
};

@Component({
  selector: 'sm-graph-view',
  imports: [
    FFlowModule,
    FVirtualFor,
    KindPalette,
    LinkKindPalette,
    NodeCard,
    PerfHud,
    InspectorView,
    ButtonModule,
    ConfirmDialogModule,
    PopoverModule,
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
  private readonly graphPreferences = inject(GraphPreferencesService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dagreLayout = inject(DagreLayoutEngine);

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

  private readonly visibleNodes = computed(() => this.filters.apply(this.loader.nodes()));

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
   * matching the side string, no CSS positioning needed.
   *
   * The four direction → side pairs match Foblex's reference example
   * (`libs/f-examples/plugins/f-layout/utils/layout-connection-sides`).
   */
  protected readonly connectionSides = computed(() => {
    // Force layout has no consistent flow direction, every edge can
    // shoot in any direction. Use Foblex's `CALCULATE` mode so the
    // engine picks the side per-connection from the actual geometry
    // (line angle between connector centres), arrows always point
    // away from the node instead of getting pinned to a fixed edge.
    if (!algorithmUsesDirection(this.graphPreferences.layoutAlgorithm())) {
      return {
        input: EFConnectionConnectableSide.CALCULATE,
        output: EFConnectionConnectableSide.CALCULATE,
      };
    }
    const direction = this.graphPreferences.layoutDirection();
    return sidesForDirection(direction);
  });
  protected readonly inputSide = computed(() => this.connectionSides().input);
  protected readonly outputSide = computed(() => this.connectionSides().output);

  /**
   * Inline layout-control popovers anchored to the bottom toolbar.
   * Mirror the catalogues the Settings modal exposes, the source of
   * truth is `GraphPreferencesService` so a toolbar change reflects
   * in Settings on the next open and vice versa.
   *
   * The arrays are typed as plain `ReadonlyArray<T>` instead of the
   * `{ value, labelKey }` shape the Settings modal uses, the popover
   * renders a vertical list (one button per option) so the template
   * iterates over the literals directly and resolves the label via
   * `*Label(value)`.
   */
  protected readonly layoutAlgorithms = LAYOUT_ALGORITHMS;
  protected readonly layoutDirections = LAYOUT_DIRECTIONS;
  protected readonly layoutSpacings = LAYOUT_SPACINGS;
  protected readonly layoutAlgorithm = this.graphPreferences.layoutAlgorithm;
  protected readonly layoutDirection = this.graphPreferences.layoutDirection;
  protected readonly layoutSpacing = this.graphPreferences.layoutSpacing;

  /**
   * Dynamic PrimeIcon for the direction button: the arrow head points
   * the way the graph flows, so the operator sees the active mode
   * without opening the popover. Keys mirror `EFLayoutDirection`.
   */
  protected readonly directionIcon = computed(
    () => DIRECTION_ICONS[this.layoutDirection()],
  );
  /** Dynamic FontAwesome class for the spacing button (mirrors direction). */
  protected readonly spacingIcon = computed(() => SPACING_ICONS[this.layoutSpacing()]);

  /**
   * Whether the active algorithm honours the `direction` preference.
   * Force-directed layouts don't have a flow direction, the toolbar
   * disables the direction button and swaps its tooltip to explain.
   */
  protected readonly directionAvailable = computed(() =>
    algorithmUsesDirection(this.layoutAlgorithm()),
  );
  /**
   * Whether the active algorithm honours the `spacing` preset.
   * Force-directed uses its own internal collision radius / link
   * distance, the `nodeGap` / `layerGap` numbers go nowhere.
   */
  protected readonly spacingAvailable = computed(() =>
    algorithmUsesSpacing(this.layoutAlgorithm()),
  );

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
  // storage writes during the boot tween.
  private readonly layoutFit = setupLayoutFit({
    visibleNodes: this.visibleNodes,
    pathsFingerprint: this.pathsFingerprint,
    canvas: () => this.canvas(),
    savedViewport: this.savedViewport,
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
    // manually dragged. Reads the latest dagre output for missing ids
    // and drops stale entries. After `resetLayout()` clears the map
    // this effect runs on the next tick and reseeds every visible node
    // from the freshest dagre layout, then persists. Single localStorage
    // write per cycle, gated by the helper's `dirty` flag. Empty-loader
    // case is skipped so we don't wipe storage during the boot loading
    // phase. Pure reconcile in `graph-view.reconcile.ts`.
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
            // the fresh dagre / force output, then animate the
            // viewport to fit the new bounding box.
            //
            // Foblex skill rule 3 forbids `transition: transform` on
            // `[fNode]` hosts (path-recalc lag during the tween),
            // so the cards themselves SNAP to their new positions.
            // The only animation surface left is the canvas
            // viewport, hence the `fitToScreen({...}, true)` tween
            // here. The user sees "cards jump to new layout" then
            // "camera glides to frame them"; that two-event feel is
            // inherent to Foblex when relayout keeps node identity
            // stable, the alternative experiments (in-place redraw,
            // scale nudge, temp transition class on nodes) all
            // either failed to animate visibly or violated rule 3.
            //
            // Double `requestAnimationFrame`: first rAF waits for
            // the paint that commits the new `[fNodePosition]`
            // transforms, second rAF buffers Foblex's own internal
            // connection-redraw pass that runs on the same tick.
            // `fitToScreen` then measures the up-to-date bounding
            // box and tweens position + scale across ~250ms.
            this.nodePositions.set({});
            requestAnimationFrame(() =>
              requestAnimationFrame(() =>
                this.canvas()?.fitToScreen({ x: 40, y: 40 }, true),
              ),
            );
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
    // the prefs-change fit lives in the layout effect (double rAF).
    // Kept as a template hook in case we need a render-complete
    // callback later.
  }

  protected readonly onCanvasChange = this.viewportStore.onCanvasChange;

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
    this.canvas()?.fitToScreen({ x: 40, y: 40 }, true);
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
        this.nodePositions.set({});
        // Reset layout also collapses every expanded card. The intent of
        // "reset" is "give me back a clean canvas", leaving cards open
        // would re-introduce the size variation that made the user reach
        // for reset in the first place.
        this.expansion.resetAll();
        queueMicrotask(() => this.canvas()?.fitToScreen({ x: 40, y: 40 }, true));
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

  // ---------------------------------------------------------------
  // Inline layout-control popovers (bottom toolbar)
  //
  // Three buttons next to the zoom controls open a popover with the
  // active catalogue (algorithm / direction / spacing). Labels are
  // resolved against `SETTINGS_TEXTS` so the modal and the toolbar
  // never drift in copy. Setters delegate to the preferences service,
  // which writes localStorage and notifies every consumer signal.
  // ---------------------------------------------------------------

  protected layoutAlgorithmLabel(value: TLayoutAlgorithm): string {
    return GRAPH_VIEW_TEXTS.layout.algorithm.options[value].label;
  }

  protected layoutDirectionLabel(value: TLayoutDirection): string {
    return GRAPH_VIEW_TEXTS.layout.direction.options[value].label;
  }

  protected layoutSpacingLabel(value: TLayoutSpacing): string {
    return GRAPH_VIEW_TEXTS.layout.spacing.options[value].label;
  }

  protected setLayoutAlgorithm(value: TLayoutAlgorithm): void {
    this.graphPreferences.setLayoutAlgorithm(value);
  }

  protected setLayoutDirection(value: TLayoutDirection): void {
    this.graphPreferences.setLayoutDirection(value);
  }

  protected setLayoutSpacing(value: TLayoutSpacing): void {
    this.graphPreferences.setLayoutSpacing(value);
  }

  /**
   * Per-value PrimeIcon for the direction popover items, used so the
   * popover renders four arrows instead of "Top to bottom / Bottom
   * to top / ..." text. The label still flows through the
   * `aria-label` and tooltip for screen-reader users.
   */
  protected directionItemIcon(value: TLayoutDirection): string {
    return DIRECTION_ICONS[value];
  }

  /** Same shape as `directionItemIcon`, but for the spacing popover. */
  protected spacingItemIcon(value: TLayoutSpacing): string {
    return SPACING_ICONS[value];
  }
}
