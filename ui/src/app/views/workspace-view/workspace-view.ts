import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, forwardRef, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { TooltipModule } from 'primeng/tooltip';

import { WORKSPACE_VIEW_TEXTS } from '../../../i18n/workspace-view.texts';
import { CollectionLoaderService } from '../../../services/collection-loader';
import { FilterStoreService } from '../../../services/filter-store';
import { MapVisibilityService } from '../../../services/map-visibility';
import { setupEdgeResize } from '../../core/edge-resize.controller';
import { MAP_ISOLATE_INTENT, type IMapIsolateIntent } from '../../slots/map-isolate-intent';
import { NODE_OPEN_INTENT } from '../../slots/node-open-intent';
import { FilesView } from '../files-view/files-view';
import { GraphView } from '../graph-view/graph-view';
import { WorkspaceNodeOpenIntent } from './workspace-open-intent';
import {
  readStoredRailCollapsed,
  readStoredRailWidth,
  writeStoredRailCollapsed,
  writeStoredRailWidth,
} from './workspace-view.storage';

const RAIL_WIDTH_DEFAULT = 440;
const RAIL_WIDTH_MIN = 280;
/** Minimum map area to keep visible at any viewport width. */
const RAIL_VIEWPORT_RESERVE = 480;

/**
 * Fused single-screen workspace: a resizable files rail on the left, the
 * map canvas in the center (which brings its own floating inspector slide-
 * over), and the shared `?path` query param as the selection bus between
 * them. Clicking a file row writes `?path`; the graph view centers on that
 * node and opens the inspector, all without leaving the route.
 *
 * The rail's only chrome is a compact search (driving the shared
 * `FilterStoreService`, so it filters both the table and the map) plus the
 * collapse handle, both in the top bar. Width is drag-resizable like the
 * inspector; faceted filters live on the map's floating palettes.
 *
 * This is the only primary view (route `/`); the former standalone
 * `/files` and `/map` destinations were retired in favour of it.
 */
@Component({
  selector: 'sm-workspace-view',
  imports: [
    FilesView,
    GraphView,
    FormsModule,
    IconFieldModule,
    InputIconModule,
    InputTextModule,
    TooltipModule,
  ],
  templateUrl: './workspace-view.html',
  styleUrl: './workspace-view.css',
  // Override the open-intent so "open node" stays on this screen instead
  // of navigating to `/map`. Also self-provide the isolate-intent so the
  // rail's chain gesture forwards to the mounted graph view. Both are
  // scoped to this element injector, so the files rail (a view child)
  // resolves these implementations.
  providers: [
    { provide: NODE_OPEN_INTENT, useClass: WorkspaceNodeOpenIntent },
    { provide: MAP_ISOLATE_INTENT, useExisting: forwardRef(() => WorkspaceView) },
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceView implements IMapIsolateIntent {
  private readonly store = inject(FilterStoreService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly loader = inject(CollectionLoaderService);
  private readonly mapVisibility = inject(MapVisibilityService);

  protected readonly texts = WORKSPACE_VIEW_TEXTS;

  /**
   * Enabled only when there is actually something to reset: an active
   * facet filter (search / kind / severity / favorites) OR a map folder
   * selection. Keeps the rail control from sitting permanently lit with
   * nothing to undo.
   */
  protected readonly canReset = computed(
    () => this.store.isActive() || this.mapVisibility.isActive(),
  );

  /**
   * Saved rail preference (`true` collapsed, `false` open), or `null` when
   * the user has never toggled it, so the corpus-size auto-default can
   * decide without overriding an explicit choice.
   */
  private readonly storedRailPref = readStoredRailCollapsed();

  /**
   * In-rail toggle: collapses the files panel to a thin strip. A saved
   * preference is restored as-is; otherwise the rail starts collapsed
   * (map front-and-center) and the constructor effect opens it once the
   * corpus is known to exceed the map render cap (the folders tree is then
   * needed to navigate). A manual toggle persists and always wins over the
   * auto-default.
   */
  protected readonly railCollapsed = signal(this.storedRailPref ?? true);

  /** Guards so the corpus-size auto-default applies at most once and never
   *  fights a manual toggle. */
  private autoRailApplied = false;
  private userToggledRail = false;

  /**
   * True for a beat around a collapse/expand toggle. Gates the width
   * transition so it animates ONLY on toggle, never during a drag resize
   * (where a permanent `transition: width` would lag every frame, the
   * same trap the inspector dodges by animating `transform`, not width).
   */
  protected readonly railAnimating = signal(false);
  private railAnimTimer: ReturnType<typeof setTimeout> | null = null;

  /** Compact search, shared with the table and the map via the store. */
  protected readonly searchText = this.store.searchText;

  /**
   * Search → map coupling preference (persisted by the store). Drives
   * the toggle button next to the search input: OFF (default) keeps
   * the map intact while the rail narrows; ON restores the legacy
   * filter-everything behavior.
   */
  protected readonly searchAffectsMap = this.store.searchAffectsMap;

  /** The mounted map, reached so the rail's isolate gesture (routed
   *  here via `MAP_ISOLATE_INTENT`) forwards to it. */
  private readonly graphView = viewChild(GraphView);

  /** `IMapIsolateIntent`: forward the rail's isolate gesture to the map. */
  isolate(path: string): void {
    this.graphView()?.isolateNeighborhood(path);
  }

  // Rail sits on the LEFT edge (handle on its right), so dragging
  // right grows it; the clamp reserves map width on the other side.
  private readonly resize = setupEdgeResize({
    destroyRef: this.destroyRef,
    edge: 'left',
    defaultWidth: RAIL_WIDTH_DEFAULT,
    minWidth: RAIL_WIDTH_MIN,
    viewportReserve: RAIL_VIEWPORT_RESERVE,
    initialWidth: readStoredRailWidth() ?? RAIL_WIDTH_DEFAULT,
    onCommit: (width) => writeStoredRailWidth(width),
  });
  protected readonly clampedRailWidth = this.resize.clampedWidth;
  protected readonly onRailResizeStart = this.resize.onResizeStart;

  constructor() {
    // The toggle animation timer outlives its 220ms window only when the
    // view unmounts mid-animation; clear it so the deferred signal write
    // never fires against a destroyed component.
    this.destroyRef.onDestroy(() => {
      if (this.railAnimTimer !== null) clearTimeout(this.railAnimTimer);
    });

    // Auto-open the rail when the corpus has more nodes than the map can
    // render (corpusCount > maxRenderNodes, default 256): the map shows a
    // focused subset, so the folders tree must be visible to navigate it.
    // Applies only when there is no saved rail preference and the user has
    // not toggled, fires once, and never re-collapses. A manual toggle
    // (which persists) wins from then on.
    effect(() => {
      // Guards (plain fields, not signals) BEFORE the first signal read, so
      // a saved preference / prior decision skips reading the corpus and the
      // effect simply never subscribes (no re-run, no dependency).
      if (this.autoRailApplied || this.userToggledRail || this.storedRailPref !== null) return;
      const count = this.loader.corpusCount();
      if (count === 0) return;
      this.autoRailApplied = true;
      const cap = this.loader.scanMeta()?.maxRenderNodes ?? 256;
      if (count > cap) this.railCollapsed.set(false);
    });
  }

  protected toggleRail(): void {
    this.userToggledRail = true;
    this.railCollapsed.update((v) => !v);
    writeStoredRailCollapsed(this.railCollapsed());
    this.railAnimating.set(true);
    if (this.railAnimTimer !== null) clearTimeout(this.railAnimTimer);
    this.railAnimTimer = setTimeout(() => this.railAnimating.set(false), 220);
  }

  protected onSearchChange(value: string): void {
    this.store.setSearchText(value);
  }

  protected onToggleSearchMap(): void {
    this.store.toggleSearchAffectsMap();
  }

  /**
   * Reset the workspace to its default overview: clear the map folder
   * selection (show every node again, the map's "Show all") AND reset
   * every facet filter (search, kind, severity, favorites). Same pair of
   * actions the map's floating "Show all" + the empty-state "Reset
   * filters" expose, surfaced as one control at the top of the rail.
   */
  protected resetView(): void {
    this.mapVisibility.clear();
    this.store.reset();
  }

  // Rail width / collapse persistence lives in `./workspace-view.storage`
  // (the shared `*.storage.ts` convention: guarded reads, quota-safe
  // writes, keys owned by the storage module).
}
