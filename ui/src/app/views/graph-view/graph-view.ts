import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
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
  EFConnectionType,
  EFMarkerType,
  EFZoomDirection,
  type FCanvasChangeEvent,
} from '@foblex/flow';

import { GRAPH_VIEW_TEXTS } from '../../../i18n/graph-view.texts';
import type { INodeView } from '../../../models/node';
import { DEFAULT_SETTINGS } from '../../../models/settings';

import { CollectionLoaderService } from '../../../services/collection-loader';
import { FilterStoreService } from '../../../services/filter-store';
import { KindPalette } from '../../components/kind-palette/kind-palette';
import { NodeCard } from '../../components/node-card/node-card';
import { PerfHud } from '../../components/perf-hud/perf-hud';
/* DEBUG-SLOTS: remove with debug-slots.css. */
import { ViewContributionsHost } from '../../components/view-contributions-host/view-contributions-host';
import { DebugPerfService } from '../../services/debug-perf';
import { InspectorView } from '../inspector-view/inspector-view';
import { MiddleMousePanDirective } from './middle-mouse-pan.directive';
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
import {
  reconcileExpandedIds,
  reconcileNodePositions,
} from './graph-view.reconcile';
import { bindSelectionToUrl } from './selection-url-sync';
import {
  readStoredExpanded,
  readStoredNodePositions,
  readStoredPanelWidth,
  readStoredViewport,
  writeStoredExpanded,
  writeStoredNodePositions,
  writeStoredPanelWidth,
  writeStoredViewport,
  type IStoredViewport,
} from './graph-view.storage';
import { nodeHasTag } from './graph-view.utils';
import {
  animateViewport,
  computeFitTransform,
  type IViewportTransform,
} from './viewport-animation';

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 4;

/** Tween duration (ms) for tag-fit and tag-restore viewport animations. */
const VIEWPORT_ANIM_MS = 320;
const ZOOM_BUTTON_STEP = 0.2;

/** Inspector panel width contract — see `clampedPanelWidth` computed. */
const PANEL_WIDTH_DEFAULT = 400;
const PANEL_WIDTH_MIN = 400;
/** Minimum graph area to keep visible at any viewport width. */
const PANEL_VIEWPORT_RESERVE = 80;

@Component({
  selector: 'app-graph-view',
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
})
export class GraphView implements OnInit {
  private readonly loader = inject(CollectionLoaderService);
  private readonly filters = inject(FilterStoreService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly confirmationService = inject(ConfirmationService);

  private readonly flow = viewChild(FFlowComponent);
  // Protected: template binds `[smMiddleMousePan]="canvas()"` to feed
  // the middle-mouse pan directive.
  protected readonly canvas = viewChild(FCanvasComponent);
  private readonly zoom = viewChild(FZoomDirective);
  private readonly canvasWrap = viewChild<ElementRef<HTMLElement>>('canvasWrap');
  // Connection visual contract — typed via Foblex enums instead of raw
  // string literals so a future enum rename surfaces at compile time.
  // `END_ALL_STATES` covers selected + non-selected with the same arrow
  // glyph (we currently disable connection selection, but this stays
  // correct if `[fSelectionDisabled]` is ever flipped).
  readonly connectionType = EFConnectionType.SEGMENT;
  readonly connectionBehavior = EFConnectionBehavior.FIXED;
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
   * — migration is a one-line import swap.
   */
  protected readonly perfHud = inject(DebugPerfService).visible;

  private pointerDownAt: { x: number; y: number } | null = null;
  private readonly savedViewport = readStoredViewport();
  private hasCompletedInitialLayout = false;
  // Middle-mouse pan lives in `[smMiddleMousePan]` directive applied
  // to `.graph__canvas-wrap` in the template — see
  // `middle-mouse-pan.directive.ts`.

  /**
   * Viewport state — bound to `<f-canvas>` `[position]` and `[scale]`.
   *
   * Critical that these are SIGNALS (not field-init constants) and that
   * `onCanvasChange` writes them. Foblex re-evaluates the input bindings
   * on every change-detection pass; if the bound value drifts from the
   * canvas's internal viewport (e.g. user pans → internal viewport
   * moves; bound value stays at its boot literal), Foblex re-applies the
   * bound value to "reconcile" and resets the viewport to the boot
   * position. Symptom: every WS-driven re-render snaps the canvas back
   * to wherever it was when the component mounted, undoing the user's
   * pan / zoom. Storing the viewport in signals that track the canvas
   * keeps the binding always in sync, so reconciliation is a no-op.
   *
   * Initial value comes from the persisted viewport (if any) so a reload
   * restores the user's last pan / zoom.
   */
  protected readonly viewportPosition = signal<IPoint>(
    this.savedViewport
      ? { x: this.savedViewport.x, y: this.savedViewport.y }
      : { x: 0, y: 0 },
  );
  protected readonly viewportScale = signal<number>(this.savedViewport?.scale ?? 1);
  protected readonly canZoomIn = computed(() => this.viewportScale() < ZOOM_MAX - 1e-6);
  protected readonly canZoomOut = computed(() => this.viewportScale() > ZOOM_MIN + 1e-6);

  protected readonly texts = GRAPH_VIEW_TEXTS;

  private readonly nodePositions = signal<TNodePositions>(readStoredNodePositions());
  private readonly expandedNodeIds = signal<ReadonlySet<string>>(readStoredExpanded());

  /**
   * Inspector panel width — user-resizable via the left-edge handle,
   * persisted to localStorage. Stored as the user's intent; the
   * `clampedPanelWidth` computed below is what the template binds, so
   * a saved value that no longer fits in the current viewport is
   * neutralised at render time without overwriting the user's choice
   * (resizing the window back wider restores it).
   */
  private readonly panelWidth = signal<number>(readStoredPanelWidth() ?? PANEL_WIDTH_DEFAULT);

  /**
   * Live viewport width. Drives `clampedPanelWidth` so a window
   * resize re-evaluates whether the saved panel width still fits.
   * Only the inner width matters here — height does not gate the
   * panel.
   */
  private readonly viewportWidth = signal<number>(
    typeof window === 'undefined' ? 1920 : window.innerWidth,
  );

  /**
   * Effective panel width after clamping against the current viewport.
   *
   *   - If the saved width exceeds the max the viewport allows, fall
   *     back to the DEFAULT (matches the user's stated intent: "if it
   *     doesn't fit, reset"). When the default itself doesn't fit
   *     (very narrow viewport), clamp the default to the max so the
   *     panel never overflows.
   *   - The user's saved intent in `panelWidth` is preserved — when
   *     they resize the window back wider, the original size returns
   *     without needing to re-drag.
   */
  protected readonly clampedPanelWidth = computed<number>(() => {
    const max = Math.max(PANEL_WIDTH_MIN, this.viewportWidth() - PANEL_VIEWPORT_RESERVE);
    const w = this.panelWidth();
    if (w > max) return Math.min(PANEL_WIDTH_DEFAULT, max);
    if (w < PANEL_WIDTH_MIN) return Math.min(PANEL_WIDTH_DEFAULT, max);
    return w;
  });

  private panelResizeStart: { mouseX: number; widthAtStart: number } | null = null;

  readonly loading = this.loader.loading;
  readonly error = this.loader.error;

  private readonly visibleNodes = computed(() => this.filters.apply(this.loader.nodes()));

  /**
   * Layout cache — the d3-force simulation runs ONCE over the full
   * collection, not over the filtered subset. Filters then project this
   * cache to the visible nodes without recomputing positions, so unmoved
   * nodes stay put when the user toggles a filter.
   *
   * The closure inside `createLayoutComputer()` adds a second cache layer
   * keyed on a topology fingerprint (path set + edge set). When a WebSocket
   * `scan.completed` event makes the loader re-fetch and replace
   * `loader.nodes()` with a fresh array, the computed re-runs — but if the
   * topology is unchanged (the common case: the user edited frontmatter or
   * body of an existing node, no node added/removed/relinked), positions
   * are reused and only the data maps (`nodesByPath`, `apiNodesByPath`)
   * refresh with the new view content. Foblex's `@for ... track node.id`
   * then reuses the existing DOM nodes and only re-renders their inner
   * card, so the viewport stays put and unmoved nodes don't jump.
   *
   * Manual drag positions (`nodePositions`) are NOT a layout input — they
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
   * Adjacency map (undirected): node id → set of node ids it shares an edge with.
   * Used by `is*` helpers to drive highlight / dim classes after a click.
   */
  private readonly adjacency = computed<Map<string, Set<string>>>(() => {
    const map = new Map<string, Set<string>>();
    for (const edge of this.graph().edges) {
      if (!map.has(edge.from)) map.set(edge.from, new Set());
      if (!map.has(edge.to)) map.set(edge.to, new Set());
      map.get(edge.from)!.add(edge.to);
      map.get(edge.to)!.add(edge.from);
    }
    return map;
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

  // URL ↔ selection deep-link wiring lives in `bindSelectionToUrl` —
  // see `selection-url-sync.ts` for the loop-guard contract. Called
  // from the constructor below.


  /**
   * Fingerprint of the loaded path set (NOT edges). Drives the "auto-fit
   * when a node is added or removed" effect below. Edge-only topology
   * changes (a new link extracted from an edited body, or a link that
   * disappeared) do NOT trip this fingerprint — the user kept the same
   * cards, just their wiring changed; jerking the viewport for that
   * would feel intrusive.
   */
  private readonly pathsFingerprint = computed(() =>
    this.loader.nodes().map((n) => n.path).sort().join('|'),
  );
  private lastPathsFingerprint: string | null = null;

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

    // Initial layout only — fit to screen once when the first batch of
    // nodes arrives. Filter changes do NOT trigger a re-fit: the layout
    // cache keeps unmoved nodes in place, and re-fitting would jump the
    // viewport every time the user toggles a kind. The "Fit to screen"
    // toolbar button is the explicit re-fit affordance.
    effect(() => {
      const visible = this.visibleNodes();
      if (this.hasCompletedInitialLayout) return;
      if (visible.length === 0) return;
      queueMicrotask(() => {
        this.hasCompletedInitialLayout = true;
        if (!this.savedViewport) {
          this.canvas()?.fitToScreen({ x: 40, y: 40 }, false);
        }
      });
    });

    // Auto-fit on add / remove of nodes via WS scan refresh.
    //
    // Filters do NOT trip this — they touch `visibleNodes`, not
    // `loader.nodes()`. Edge-only changes do not trip this either —
    // `pathsFingerprint` excludes edges by design. The first run during
    // boot only seeds `lastPathsFingerprint` (the initial fit is owned
    // by the effect above); subsequent runs animate-fit so the user
    // sees the new layout in full.
    effect(() => {
      const fp = this.pathsFingerprint();
      if (!this.hasCompletedInitialLayout) {
        this.lastPathsFingerprint = fp;
        return;
      }
      if (this.lastPathsFingerprint === fp) return;
      this.lastPathsFingerprint = fp;
      queueMicrotask(() => this.canvas()?.fitToScreen({ x: 40, y: 40 }, true));
    });

    // Garbage-collect `expandedNodeIds` against the current loaded set.
    // Without this, an id that was expanded in a previous session and
    // persisted to localStorage stays in the set forever — even after
    // the file behind it is deleted. The empty-array case (initial
    // boot before the first scan resolves) is skipped so we don't wipe
    // the set during the loading phase. Pure reconcile in
    // `graph-view.reconcile.ts#reconcileExpandedIds`.
    effect(() => {
      const allPaths = new Set(this.loader.nodes().map((n) => n.path));
      if (allPaths.size === 0) return;
      const result = reconcileExpandedIds(this.expandedNodeIds(), allPaths);
      if (!result.dirty) return;
      this.expandedNodeIds.set(result.next);
      writeStoredExpanded(result.next);
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
    // Intentional no-op — the effect above handles initial layout once the
    // graph data is ready. Kept as a template hook in case we need it later.
  }

  onCanvasChange(event: FCanvasChangeEvent): void {
    // Mirror the canvas's internal viewport into our bound signals so a
    // future change-detection pass doesn't reconcile the bindings and
    // snap the canvas back. See the doc on `viewportPosition` /
    // `viewportScale` for the full reasoning.
    this.viewportPosition.set({ x: event.position.x, y: event.position.y });
    this.viewportScale.set(event.scale);
    if (!this.hasCompletedInitialLayout) return;
    writeStoredViewport({
      x: event.position.x,
      y: event.position.y,
      scale: event.scale,
    });
  }

  onNodePositionChange(id: string, position: IPoint): void {
    // During drag, accumulate positions in a non-signal buffer. Writing
    // to `nodePositions` here would invalidate the `graph` computed
    // (which projects positions into the @for) on every move, forcing
    // Angular to reconcile all node + edge bindings 60–120×/sec — pure
    // overhead since Foblex already manages the dragged node's DOM
    // transform internally. We flush the buffer once at pointerup.
    if (!this.dragBuffer) this.dragBuffer = { ...this.nodePositions() };
    this.dragBuffer[id] = { x: position.x, y: position.y };
    this.nodeDragInProgress = true;
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
        // the current auto-layout, and reseeds every visible node — then
        // persists the freshly-computed positions to storage. That's why
        // "reset" ends up doing the full delete → re-arrange → save loop
        // without any explicit save call here.
        this.nodePositions.set({});
        // Reset layout also collapses every expanded card. The intent of
        // "reset" is "give me back a clean canvas" — leaving cards open
        // would re-introduce the size variation that made the user reach
        // for reset in the first place.
        this.expandedNodeIds.set(new Set());
        writeStoredExpanded(new Set());
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
  // applied to `.graph__canvas-wrap` in the template — handlers,
  // origin state, rAF coalescing, and cleanup all live there.

  onNodePointerDown(event: PointerEvent): void {
    this.pointerDownAt = { x: event.clientX, y: event.clientY };
    // Defer localStorage persistence + signal flush to mouseup. Foblex
    // intercepts pointer events via fDragHandle, so listening on
    // `mouseup` (the same channel the existing middle-mouse pan uses
    // successfully on `document`) is the reliable path. `queueMicrotask`
    // inside the handler defers the flush until after any final
    // fNodePositionChange that Foblex may emit synchronously.
    document.addEventListener('mouseup', this.onNodeMouseUp, { once: true });
  }

  private nodeDragInProgress = false;
  private dragBuffer: TNodePositions | null = null;

  private readonly onNodeMouseUp = (): void => {
    queueMicrotask(() => {
      if (!this.nodeDragInProgress) {
        this.dragBuffer = null;
        return;
      }
      this.nodeDragInProgress = false;
      if (this.dragBuffer) {
        this.nodePositions.set(this.dragBuffer);
        this.dragBuffer = null;
      }
      writeStoredNodePositions(this.nodePositions());
    });
  };

  selectNode(node: IGraphNode, event: MouseEvent): void {
    if (!this.isClickWithoutDrag(event)) return;
    this.selectedNodeId.set(node.id);
  }

  /**
   * Active tag selection — the tag whose matching node-set is currently
   * highlighted via Foblex's native selection (paths in the set carry
   * the `.f-selected` host class). `null` when no tag-driven selection
   * is active. Drives toggle semantics on chip click AND the chip
   * "active" visual state in the inspector annotations panel
   * (forwarded through `<app-inspector-view [activeTag]>`).
   * `protected` so the template can bind it for that pass-through.
   */
  protected readonly activeTagSelection = signal<string | null>(null);

  /**
   * Viewport snapshot captured the moment a tag selection first
   * activates. Restored when the same tag clicks again (toggle clear)
   * so the user lands back on the pan / zoom they were on before
   * the zoom-to-matching jump. `null` while no tag selection is
   * active. NOT updated on tag-to-tag swaps — the saved viewport
   * always points at the pre-tag state, so a long chain of swaps
   * still restores correctly.
   */
  private viewportBeforeTagSelect: { position: IPoint; scale: number } | null = null;

  /**
   * In-flight viewport animation token. Each `animateViewportTo` run
   * captures a fresh number; the rAF loop checks against this to
   * abort itself when a newer animation supersedes it. Avoids the
   * "two tweens fighting over the signals" symptom on rapid
   * tag-to-tag clicks.
   */
  private viewportAnimToken = 0;

  /**
   * Tag chip click forwarded from the embedded inspector panel.
   * Computes every node whose frontmatter.tags / sidecar.annotations.tags
   * carries the tag and feeds them to Foblex's native selection API
   * (`flow.select(paths, [])`). Foblex paints the matching nodes via
   * `.f-selected` so the multi-select halo is visible across the whole
   * graph.
   *
   * The single-focus selection is preserved — the inspector panel
   * stays open on the originally-clicked node so the user keeps their
   * reading context. The "selected node + adjacency-dim" visual that
   * normally fades non-neighbours to opacity 0.25 is suspended while
   * a tag selection is active (see `isDimmed` / `isEdgeDimmed`),
   * otherwise dim matching nodes would look "selected but ghosted".
   *
   * Toggle: clicking the chip whose tag is already the active tag
   * selection clears it (`flow.clearSelection()`).
   */
  onTagSelect(tag: string): void {
    const flow = this.flow();
    if (!flow) return;
    if (this.activeTagSelection() === tag) {
      flow.clearSelection();
      this.activeTagSelection.set(null);
      this.restoreViewportFromTagSnapshot();
      return;
    }
    const paths = this.loader
      .nodes()
      .filter((n) => nodeHasTag(n, tag))
      .map((n) => n.path);
    if (paths.length === 0) {
      // No matches — clearing keeps the visual honest (no stale
      // selection from a previous tag).
      flow.clearSelection();
      this.activeTagSelection.set(null);
      this.restoreViewportFromTagSnapshot();
      return;
    }
    // Snapshot the viewport on first activation only — swaps don't
    // overwrite, so toggling off after N swaps still lands on the
    // pre-tag pan / zoom the user came from.
    if (this.viewportBeforeTagSelect === null) {
      this.viewportBeforeTagSelect = {
        position: { ...this.viewportPosition() },
        scale: this.viewportScale(),
      };
    }
    flow.select(paths, []);
    this.activeTagSelection.set(tag);
    this.fitViewportToPaths(paths);
  }

  /**
   * Pan + zoom the viewport so the bounding box of `paths` fits inside
   * the canvas wrap with a comfortable padding. Math lives in
   * `viewport-animation.ts#computeFitTransform`; this method only
   * gathers inputs and hands the tween to `animateViewportTo`.
   */
  private fitViewportToPaths(paths: readonly string[]): void {
    const wrap = this.canvasWrap()?.nativeElement;
    if (!wrap) return;
    if (paths.length === 0) return;

    const layout = this.fullLayout();
    const points: IPoint[] = [];
    for (const p of paths) {
      const pt = layout.positions.get(p);
      if (pt) points.push(pt);
    }
    if (points.length === 0) return;

    const transform = computeFitTransform({
      points,
      wrap: { width: wrap.clientWidth, height: wrap.clientHeight },
      panelW: this.selectedNodeId() !== null ? this.clampedPanelWidth() : 0,
      zoomMin: ZOOM_MIN,
    });
    if (!transform) return;
    this.animateViewportTo(transform, VIEWPORT_ANIM_MS);
  }

  /**
   * Pop the viewport snapshot taken on the first tag-select activation
   * and restore the canvas to that pan / zoom. No-op if no snapshot
   * exists (called defensively from the no-match / external-clear
   * branches of `onTagSelect`).
   */
  private restoreViewportFromTagSnapshot(): void {
    const saved = this.viewportBeforeTagSelect;
    if (!saved) return;
    this.viewportBeforeTagSelect = null;
    this.animateViewportTo({ position: saved.position, scale: saved.scale }, VIEWPORT_ANIM_MS);
  }

  /**
   * Tween the viewport (position + scale) toward `target` over
   * `durationMs`. Delegates to `viewport-animation.ts#animateViewport`;
   * this method only manages the supersession token so back-to-back
   * tag clicks abort the previous tween cleanly.
   *
   * Foblex's `(fCanvasChange)` doesn't fire for programmatic input
   * updates (only for user gestures), so the loop's `viewportPosition.set`
   * / `viewportScale.set` calls don't bounce back via `onCanvasChange`.
   */
  private animateViewportTo(target: IViewportTransform, durationMs: number): void {
    const token = ++this.viewportAnimToken;
    animateViewport(
      {
        readPosition: () => this.viewportPosition(),
        readScale: () => this.viewportScale(),
        writePosition: (p) => this.viewportPosition.set(p),
        writeScale: (s) => this.viewportScale.set(s),
        isStaleToken: () => token !== this.viewportAnimToken,
      },
      target,
      durationMs,
    );
  }

  /** Close the embedded inspector panel and remove the URL `?path` param. */
  closePanel(): void {
    this.selectedNodeId.set(null);
  }

  /**
   * Escape closes the inspector panel — but only when no PrimeNG
   * overlay is open. A confirm dialog / settings modal / overlay panel
   * receives Escape first (its own keydown handler closes it), and
   * because HostListener does not control propagation, the same key
   * would otherwise ALSO collapse this panel in the same tick. The
   * selector covers ConfirmDialog, Dialog, OverlayPanel, and Popover
   * variants used in this app.
   */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.selectedNodeId() === null) return;
    if (typeof document !== 'undefined' && isAnyPrimengOverlayOpen(document)) return;
    this.closePanel();
  }

  /**
   * Window resize re-evaluates `clampedPanelWidth` against the new
   * viewport. The user's stored width signal is intentionally NOT
   * touched — the clamp computed handles "doesn't fit" at render
   * time, so resizing back wider restores the original size.
   */
  @HostListener('window:resize')
  onWindowResize(): void {
    if (typeof window === 'undefined') return;
    this.viewportWidth.set(window.innerWidth);
  }

  /**
   * Drag the panel's left edge to resize. Mouse events (not pointer)
   * mirror the middle-mouse pan handler in this component — `mouseup`
   * is the reliable channel since fDragHandle on graph nodes consumes
   * pointerup elsewhere; using the same channel keeps behaviour
   * consistent across the view (rule 9 of foblex-flow skill).
   */
  onPanelResizeStart(event: MouseEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.panelResizeStart = { mouseX: event.clientX, widthAtStart: this.clampedPanelWidth() };
    document.addEventListener('mousemove', this.onPanelResizeMove);
    document.addEventListener('mouseup', this.onPanelResizeEnd);
  }

  private readonly onPanelResizeMove = (event: MouseEvent): void => {
    if (!this.panelResizeStart) return;
    // Panel sits on the right edge of the canvas wrap. Dragging the
    // left handle to the LEFT (smaller clientX) grows the panel; to
    // the RIGHT (larger clientX) shrinks it. Hence subtraction.
    const dx = event.clientX - this.panelResizeStart.mouseX;
    const next = this.panelResizeStart.widthAtStart - dx;
    const max = Math.max(PANEL_WIDTH_MIN, this.viewportWidth() - PANEL_VIEWPORT_RESERVE);
    const clamped = Math.min(max, Math.max(PANEL_WIDTH_MIN, next));
    this.panelWidth.set(clamped);
  };

  private readonly onPanelResizeEnd = (): void => {
    if (!this.panelResizeStart) return;
    this.panelResizeStart = null;
    document.removeEventListener('mousemove', this.onPanelResizeMove);
    document.removeEventListener('mouseup', this.onPanelResizeEnd);
    // Persist the user's chosen width on drag-end (single localStorage
    // write per drag — same buffer-then-flush pattern as the node-drag
    // handler). The clamped/effective width is what gets stored, since
    // the move handler already clamped.
    writeStoredPanelWidth(this.panelWidth());
  };

  openNode(node: IGraphNode): void {
    // Embedded inspector mode: dblclick selects (single click already does
    // the same — kept the handler so the gesture has a clear intent).
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
    return this.selectedNodeId() === id;
  }

  isHighlighted(id: string): boolean {
    const sel = this.selectedNodeId();
    if (sel === null || sel === id) return false;
    return this.adjacency().get(sel)?.has(id) ?? false;
  }

  /**
   * Adjacency-driven dim — fades non-neighbours of the selected node
   * to focus the user's reading context. Suspended while a tag
   * selection is active: the multi-select halo (Foblex `.f-selected`)
   * is the dominant visual then, and stacking opacity 0.25 on top of
   * matching nodes made them read "selected but ghosted".
   */
  isDimmed(id: string): boolean {
    if (this.activeTagSelection() !== null) return false;
    const sel = this.selectedNodeId();
    if (sel === null) return false;
    if (sel === id) return false;
    return !(this.adjacency().get(sel)?.has(id) ?? false);
  }

  isExpanded(id: string): boolean {
    return this.expandedNodeIds().has(id);
  }

  setExpanded(id: string, value: boolean): void {
    const current = this.expandedNodeIds();
    if (current.has(id) === value) return;
    const next = new Set(current);
    if (value) next.add(id);
    else next.delete(id);
    this.expandedNodeIds.set(next);
    writeStoredExpanded(next);
  }

  onFavoriteToggle(payload: { path: string; value: boolean }): void {
    void this.loader.toggleFavorite(payload.path, payload.value);
  }

  isEdgeHighlighted(edge: IGraphEdge): boolean {
    const sel = this.selectedNodeId();
    return sel !== null && (edge.from === sel || edge.to === sel);
  }

  /**
   * Edge dim mirrors `isDimmed` — suspended while a tag selection is
   * active so edges between non-tag-matching nodes don't fade
   * underneath the multi-select halo.
   */
  isEdgeDimmed(edge: IGraphEdge): boolean {
    if (this.activeTagSelection() !== null) return false;
    const sel = this.selectedNodeId();
    if (sel === null) return false;
    return edge.from !== sel && edge.to !== sel;
  }

  private isClickWithoutDrag(event: MouseEvent): boolean {
    const start = this.pointerDownAt;
    this.pointerDownAt = null;
    if (!start) return true;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    return Math.hypot(dx, dy) <= 4;
  }
}

/**
 * True when a PrimeNG overlay (confirm dialog, modal dialog, overlay
 * panel, popover) is currently rendered. The Escape handler bails when
 * one is open so the key only collapses the inspector when nothing
 * else owns the dismiss semantics.
 *
 * `.p-overlay-mask` covers ConfirmDialog/Dialog modal scrims. `.p-dialog`
 * also catches non-modal dialogs whose mask is suppressed. `.p-overlay`
 * is PrimeNG v18's marker for OverlayPanel/Popover floating layers.
 */
function isAnyPrimengOverlayOpen(doc: Document): boolean {
  return doc.querySelector('.p-overlay-mask, .p-dialog, .p-overlay') !== null;
}
