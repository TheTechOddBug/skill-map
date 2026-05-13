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
import { TooltipModule } from 'primeng/tooltip';
import {
  FCanvasComponent,
  FFlowComponent,
  FFlowModule,
  FVirtualFor,
  FZoomDirective,
  EFConnectionBehavior,
  EFMarkerType,
  EFZoomDirection,
} from '@foblex/flow';

import { GRAPH_VIEW_TEXTS } from '../../../i18n/graph-view.texts';
import { DEFAULT_SETTINGS } from '../../../models/settings';

import { CollectionLoaderService } from '../../../services/collection-loader';
import { FilterStoreService } from '../../../services/filter-store';
import { GraphPreferencesService } from '../../../services/graph-preferences';
import { KindPalette } from '../../components/kind-palette/kind-palette';
import { NodeCard } from '../../components/node-card/node-card';
import { PerfHud } from '../../components/perf-hud/perf-hud';
/* DEBUG-SLOTS: remove with debug-slots.css. */
import { ViewContributionsHost } from '../../components/view-contributions-host/view-contributions-host';
import { DebugPerfService } from '../../services/debug-perf';
import { InspectorView } from '../inspector-view/inspector-view';
import { MiddleMousePanDirective } from './middle-mouse-pan';
import {
  createLayoutComputer,
  projectVisible,
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

@Component({
  selector: 'sm-graph-view',
  imports: [
    FFlowModule,
    FVirtualFor,
    KindPalette,
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
  providers: [ConfirmationService],
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
   * Layout cache, the d3-force simulation runs ONCE over the full
   * collection, not over the filtered subset. Filters then project this
   * cache to the visible nodes without recomputing positions, so unmoved
   * nodes stay put when the user toggles a filter.
   *
   * The closure inside `createLayoutComputer()` adds a second cache layer
   * keyed on a topology fingerprint (path set + edge set). When a WebSocket
   * `scan.completed` event makes the loader re-fetch and replace
   * `loader.nodes()` with a fresh array, the computed re-runs, but if the
   * topology is unchanged (the common case: the user edited frontmatter or
   * body of an existing node, no node added/removed/relinked), positions
   * are reused and only the data maps (`nodesByPath`, `apiNodesByPath`)
   * refresh with the new view content. Foblex's `@for ... track node.id`
   * then reuses the existing DOM nodes and only re-renders their inner
   * card, so the viewport stays put and unmoved nodes don't jump.
   *
   * Manual drag positions (`nodePositions`) are NOT a layout input, they
   * override per-node at projection time, so dragging never invalidates
   * the cache either.
   */
  private readonly computeLayout = createLayoutComputer();
  private readonly fullLayout = computed<IFullLayout>(() =>
    this.computeLayout(this.loader.nodes(), this.loader.scan()),
  );

  readonly graph = computed<IGraphData>(() => {
    const visibleIds = new Set(this.visibleNodes().map((n) => n.path));
    return projectVisible(this.fullLayout(), visibleIds, this.nodePositions());
  });

  readonly hasData = computed(() => this.graph().nodes.length > 0);

  /** Counters / timestamp exposed to the perf HUD. Pure derivations. */
  protected readonly visibleCount = computed(() => this.graph().nodes.length);
  protected readonly totalCount = computed(() => this.loader.nodes().length);
  protected readonly edgeCount = computed(() => this.graph().edges.length);
  protected readonly layoutComputedAt = computed(() => this.fullLayout().computedAt);

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
    // URL ↔ selection deep-link wiring (extracted helper).
    bindSelectionToUrl({
      selectedPath: this.selectedPath,
      setSelectedNodeId: (id) => this.selectedNodeId.set(id),
      readSelectedNodeId: () => this.selectedNodeId(),
      graphNodes: computed(() => this.graph().nodes),
      router: this.router,
      route: this.route,
    });

    // Reconcile `nodePositions` against the loaded set so storage holds
    // the position of every visible node, not just the ones the user
    // manually dragged. Cold-start reuses the auto-layout cache;
    // incremental pins existing + settles missing via
    // `computeIncrementalPositions`; deletions drop stale entries.
    // After `resetLayout()` clears the map this effect runs on the next
    // tick and the cold-start branch reseeds the whole graph from the
    // auto-layout. Single localStorage write per cycle, gated by the
    // helper's `dirty` flag. Empty-loader case is skipped so we don't
    // wipe storage during the boot loading phase. Pure reconcile in
    // `graph-view.reconcile.ts#reconcileNodePositions`.
    effect(() => {
      const nodes = this.loader.nodes();
      if (nodes.length === 0) return;
      const layout = this.fullLayout();
      const result = reconcileNodePositions({
        nodes,
        current: this.nodePositions(),
        layout,
        edges: layout.edges,
      });
      if (!result.dirty) return;
      this.nodePositions.set(result.next);
      writeStoredNodePositions(result.next);
    });
  }

  ngOnInit(): void {
    if (this.loader.nodes().length === 0 && !this.loader.loading()) {
      void this.loader.load();
    }
  }

  onLoaded(): void {
    // Intentional no-op, the effect above handles initial layout once the
    // graph data is ready. Kept as a template hook in case we need it later.
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

}
