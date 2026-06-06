import { ChangeDetectionStrategy, Component, DestroyRef, forwardRef, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { TooltipModule } from 'primeng/tooltip';

import { WORKSPACE_VIEW_TEXTS } from '../../../i18n/workspace-view.texts';
import { FilterStoreService } from '../../../services/filter-store';
import { MAP_ISOLATE_INTENT, type IMapIsolateIntent } from '../../slots/map-isolate-intent';
import { NODE_OPEN_INTENT } from '../../slots/node-open-intent';
import { FilesView } from '../files-view/files-view';
import { GraphView } from '../graph-view/graph-view';
import { RAIL_WIDTH_DEFAULT, setupRailResize } from './workspace-rail-resize';
import { WorkspaceNodeOpenIntent } from './workspace-open-intent';

const RAIL_WIDTH_KEY = 'sm.workspace.rail-width';
const RAIL_COLLAPSED_KEY = 'sm.workspace.rail-collapsed';

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

  protected readonly texts = WORKSPACE_VIEW_TEXTS;

  /**
   * In-rail toggle: collapses the files panel to a thin strip. Defaults
   * to collapsed (the workspace opens with the map front-and-center) and
   * remembers the user's choice in `localStorage`, mirroring how the rail
   * width is persisted, so re-opening it sticks across reloads.
   */
  protected readonly railCollapsed = signal(this.readStoredCollapsed());

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

  /** The mounted map, reached so the rail's isolate gesture (routed
   *  here via `MAP_ISOLATE_INTENT`) forwards to it. */
  private readonly graphView = viewChild(GraphView);

  /** `IMapIsolateIntent`: forward the rail's isolate gesture to the map. */
  isolate(path: string): void {
    this.graphView()?.isolateNeighborhood(path);
  }

  private readonly resize = setupRailResize({
    destroyRef: this.destroyRef,
    initialWidth: this.readStoredWidth(),
    onCommit: (width) => this.writeStoredWidth(width),
  });
  protected readonly clampedRailWidth = this.resize.clampedRailWidth;
  protected readonly onRailResizeStart = this.resize.onRailResizeStart;

  protected toggleRail(): void {
    this.railCollapsed.update((v) => !v);
    this.writeStoredCollapsed(this.railCollapsed());
    this.railAnimating.set(true);
    if (this.railAnimTimer !== null) clearTimeout(this.railAnimTimer);
    this.railAnimTimer = setTimeout(() => this.railAnimating.set(false), 220);
  }

  protected onSearchChange(value: string): void {
    this.store.setSearchText(value);
  }

  private readStoredWidth(): number {
    if (typeof localStorage === 'undefined') return RAIL_WIDTH_DEFAULT;
    const raw = Number(localStorage.getItem(RAIL_WIDTH_KEY));
    return Number.isFinite(raw) && raw > 0 ? raw : RAIL_WIDTH_DEFAULT;
  }

  private writeStoredWidth(width: number): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(RAIL_WIDTH_KEY, String(width));
    } catch {
      // localStorage disabled / quota exceeded; width just won't persist.
    }
  }

  /**
   * Files rail collapse, persisted. Absent key → collapsed by default
   * (the workspace opens map-first); `'1'` collapsed, `'0'` open.
   */
  private readStoredCollapsed(): boolean {
    if (typeof localStorage === 'undefined') return true;
    const raw = localStorage.getItem(RAIL_COLLAPSED_KEY);
    if (raw === null) return true;
    return raw === '1';
  }

  private writeStoredCollapsed(collapsed: boolean): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(RAIL_COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch {
      // localStorage disabled / quota exceeded; collapse just won't persist.
    }
  }
}
