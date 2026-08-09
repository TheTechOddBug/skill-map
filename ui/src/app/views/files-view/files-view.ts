import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
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
import { DOCUMENT } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import { Table, TableModule } from 'primeng/table';
import type { ScrollerOptions } from 'primeng/api';
import type { TablePassThrough } from 'primeng/types/table';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { MessageModule } from 'primeng/message';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';

import { FILES_VIEW_TEXTS } from '../../../i18n/files-view.texts';
import { CollectionLoaderService } from '../../../services/collection-loader';
import { FilterStoreService } from '../../../services/filter-store';
import { FilesFollowSelectionService } from '../../../services/files-follow-selection';
import { MapVisibilityService, type TFolderVisibility } from '../../../services/map-visibility';
import { NodeActivityStatsService } from '../../../services/node-activity-stats';
import { ProjectIgnoreService } from '../../../services/project-ignore';
import { UsageTrackerService } from '../../services/usage-tracker';
import { MAP_ISOLATE_INTENT } from '../../slots/map-isolate-intent';
import { NODE_OPEN_INTENT } from '../../slots/node-open-intent';
import type { INodeView } from '../../../models/node';
import { readStoredExpanded, writeStoredExpanded } from './files-view.storage';
import {
  buildRows,
  buildTree,
  computeAggregates,
  issueMapsFromLite,
  leafAncestorFolderPaths,
  type IFolderLeaf,
  type IFolderRow,
  type IIssueMaps,
  type ITreeFolder,
  type TFolderViewRow,
} from './files-view.rows';
import {
  nextSort,
  readStoredSort,
  writeStoredSort,
  type IFilesSort,
  type TSortColumn,
} from './files-view.sort';

/**
 * Uniform body-row height, in pixels. Single source of truth for BOTH the
 * CSS row box (bound onto the table as `--files-row-h`) and the virtual
 * scroller's `[virtualScrollItemSize]`.
 *
 * PrimeNG's scroller is a FIXED-item-size virtualizer: it sizes its spacer
 * as `rows * itemSize` and positions the rendered window with a
 * `translate3d` computed from the same number. A row that renders taller
 * or shorter than this constant makes the content drift away from the
 * scrollbar the further you scroll, with no error anywhere. Changing this
 * value is therefore a two-sided edit that this constant makes atomic; the
 * padding that lands a row on it lives in `files-view.css`.
 */
export const FILES_ROW_HEIGHT_PX = 36;

@Component({
  selector: 'sm-files-view',
  imports: [
    TableModule,
    ProgressSpinnerModule,
    MessageModule,
    ButtonModule,
    TooltipModule,
  ],
  templateUrl: './files-view.html',
  styleUrl: './files-view.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FilesView implements OnInit {
  private readonly loader = inject(CollectionLoaderService);
  private readonly filters = inject(FilterStoreService);
  private readonly nodeOpenIntent = inject(NODE_OPEN_INTENT);
  private readonly mapVisibility = inject(MapVisibilityService);
  private readonly mapIsolate = inject(MAP_ISOLATE_INTENT);
  protected readonly projectIgnore = inject(ProjectIgnoreService);
  private readonly usageTracker = inject(UsageTrackerService);
  private readonly activityStats = inject(NodeActivityStatsService);
  private readonly followSelection = inject(FilesFollowSelectionService);
  private readonly route = inject(ActivatedRoute);
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly texts = FILES_VIEW_TEXTS;

  /**
   * The PrimeNG table instance. `Table` declares no `exportAs`, so a
   * template reference variable would resolve to the ElementRef; a view
   * query is the only way to reach `scrollToVirtualIndex` / `scroller`.
   * Optional because the table sits behind `@if` branches (loading, error,
   * empty) and is absent until rows exist.
   */
  private readonly table = viewChild(Table);

  /** Fed to `[virtualScrollItemSize]`; paired with `rowHeightCss` below. */
  protected readonly rowHeightPx = FILES_ROW_HEIGHT_PX;

  /** Same number as a CSS length, bound onto the table as `--files-row-h`
   *  so the row box and the virtualizer can never disagree. */
  protected readonly rowHeightCss = `${FILES_ROW_HEIGHT_PX}px`;

  /**
   * Scroller tuning. MUST stay a stable object reference: the scroller's
   * `options` setter re-assigns its own fields on every identity change,
   * so an inline literal in the template would re-run it each CD pass.
   * Event keys (`onLazyLoad` / `onScroll` / `onScrollIndexChange`) must
   * NEVER go in here, they overwrite the Table's own EventEmitters.
   *
   * `autoSize: false` is required, not defensive. `p-table` hardcodes
   * `[autoSize]="true"`, and the scroller's `calculateAutoSize()` then
   * writes a literal pixel height onto its host whenever the content
   * measures shorter than the captured default. With `scrollHeight:
   * 'flex'` the scroller must stay at `height: 100%` and fill the rail,
   * so shrink-wrapping would stop a short listing from painting to the
   * bottom of the panel.
   */
  protected readonly scrollerOptions: ScrollerOptions = { autoSize: false };

  /**
   * Pass-through attributes for PrimeNG-owned DOM.
   *
   * - `virtualScroller.root`: a stable `data-testid` on the element that
   *   actually owns `scrollTop` / `clientHeight`, so tests never have to
   *   reach for the internal `.p-virtualscroller` class.
   * - `table.aria-rowcount`: only the rendered window is in the DOM, so
   *   without this assistive tech would announce ~45 rows instead of the
   *   real corpus size.
   */
  protected readonly tablePt = computed<TablePassThrough>(() => ({
    virtualScroller: {
      root: {
        'data-testid': 'files-scroller',
        'aria-label': FILES_VIEW_TEXTS.listAriaLabel,
        // Not in the Tab order (a row owns that, see `activeIndex`), but
        // focusable programmatically so the focus rescue has somewhere to
        // put focus when a focused row is recycled away.
        tabindex: '-1',
      },
    },
    table: { 'aria-rowcount': String(this.rows().length) },
  }));

  readonly loading = this.loader.loading;
  readonly error = this.loader.error;
  readonly filtersActive = this.filters.isActive;

  /**
   * The inspected node's path from the shared `?path` query param. The map
   * writes it on node click (and the rail's own row clicks write it too),
   * so it is the single selection bus between the two panels. `null` when
   * nothing is selected.
   */
  private readonly urlPath = toSignal(
    this.route.queryParamMap.pipe(map((m) => m.get('path'))),
    { initialValue: this.route.snapshot.queryParamMap.get('path') },
  );

  /**
   * Path to highlight and reveal in the tree, but only while the "files
   * follows selection" preference is on. When off (the default) this is
   * `null`, so the row highlight clears and the reveal effect is inert: the
   * rail ignores the map selection exactly as it did before the feature.
   */
  readonly highlightedPath = computed(() =>
    this.followSelection.enabled() ? (this.urlPath() ?? null) : null,
  );

  /**
   * Show the rail spinner ONLY while the corpus itself is loading and not
   * yet present (cold boot). A branch-only fetch (the map reacting to a
   * checkbox) flips the SAME shared loader `loading` flag, but the tree is
   * built from the whole-corpus lite list, which is already in hand, so it
   * must stay on screen instead of blinking back to a spinner.
   */
  readonly showLoading = computed(() => this.loading() && this.loader.corpusCount() === 0);

  /**
   * Folders the user has explicitly EXPANDED. The default state is
   * "all collapsed", so anything NOT in this set renders closed and the
   * tree opens light (only top-level folders, no children) even on a
   * large corpus. Seeded from `localStorage` on construction; an
   * `effect` mirrors mutations back so expansions persist across
   * reloads. New folders that appear after a future scan also render
   * collapsed out of the box (they are not in the expanded set yet).
   */
  private readonly expanded = signal<ReadonlySet<string>>(readStoredExpanded());

  /**
   * Active sort. `tree` (the default) renders the folder structure; any
   * data column flattens the table into a sorted file listing. Seeded
   * from `localStorage`; the `effect` mirrors changes back.
   */
  private readonly sort = signal<IFilesSort>(readStoredSort());
  readonly sortState = this.sort.asReadonly();
  readonly isFlat = computed(() => this.sort().column !== 'tree');

  /**
   * Stable row identity for the PrimeNG table. Without it the table
   * recreates every row on each `rows()` recompute, so expanding a folder
   * would re-mount its row with the chevron already rotated (no transition)
   * and the children would pop in. Tracking by `path` reuses the existing
   * rows' DOM (the chevron rotates IN PLACE) and mounts only the newly
   * revealed children fresh, which lets them animate in.
   */
  protected readonly trackByPath = (_index: number, row: TFolderViewRow): string => row.path;

  constructor() {
    effect(() => {
      writeStoredExpanded(this.expanded());
    });
    effect(() => {
      writeStoredSort(this.sort());
    });
    // Reveal the inspected node in the tree when "files follows selection"
    // is on. Only `highlightedPath` is tracked; the reveal work runs inside
    // `untracked` so setting `expanded` here does not re-fire this effect (a
    // self-write loop) and `afterNextRender` is not scheduled from a live
    // reactive context (NG0602).
    effect(() => {
      const path = this.highlightedPath();
      if (!path) return;
      untracked(() => this.revealLeaf(path));
    });
    // Collapsing, filtering or sorting can shrink the listing under the
    // roving focus; keep it addressable instead of pointing past the end.
    effect(() => {
      this.rows().length;
      untracked(() => this.clampActiveIndex());
    });
    // The scroller only exists once the table renders (it sits behind the
    // loading / error / empty branches), so the rescue listener is bound
    // the first time the view query resolves rather than on construction.
    effect(() => {
      if (!this.table() || this.focusRescueBound) return;
      this.focusRescueBound = true;
      untracked(() =>
        afterNextRender(() => this.bindFocusRescue(), { injector: this.injector }),
      );
    });
  }

  /**
   * Per-path error / warn maps from the whole-corpus lite folders list.
   * The lite rows carry their own per-node `errorCount` / `warnCount`,
   * so the tree's leaf badges AND the recursive per-folder badges
   * (rolled up in `computeAggregates`) read the SAME corpus-wide source
   * regardless of which branch the map currently renders.
   */
  private readonly issueMaps = computed<IIssueMaps>(() =>
    issueMapsFromLite(this.loader.liteNodes()),
  );

  /**
   * The folders tree is built from the whole-corpus LITE node list (path
   * + kind only), NOT the branch the map renders, so the rail always
   * shows the full corpus. The lite projection carries empty
   * name / description, so the text-search facet narrows on path + kind.
   */
  private readonly filteredNodes = computed<readonly INodeView[]>(() => {
    // Severity facet over the WHOLE-CORPUS issue counts (the lite folders
    // list via `issueMaps`), NOT the branch-scoped
    // `IssuePathsService.bySeverity()`. The tree shows the full corpus, so
    // its severity filter must be corpus-wide; depending on the branch
    // index also re-ran this computed (rebuilding the tree) on every map
    // branch change, so a checkbox click visibly refreshed the file list.
    const maps = this.issueMaps();
    const severity = {
      errors: new Set(maps.errorCounts.keys()),
      warns: new Set(maps.warnCounts.keys()),
    };
    return this.filters.apply(this.loader.liteNodeViews(), severity);
  });

  private readonly tree = computed<ITreeFolder>(() => buildTree(this.filteredNodes()));

  private readonly aggregates = computed(() =>
    computeAggregates(this.tree(), this.issueMaps()),
  );

  /**
   * Per-path session execution counts projected from the stats mirror
   * (`NodeActivityStatsService`), so the pure row engine consumes a
   * plain `path -> count` map instead of the API stats shape.
   */
  private readonly activityCounts = computed<ReadonlyMap<string, number>>(() => {
    const counts = new Map<string, number>();
    for (const [path, stats] of this.activityStats.stats()) counts.set(path, stats.count);
    return counts;
  });

  readonly rows = computed<TFolderViewRow[]>(() =>
    buildRows({
      tree: this.tree(),
      leaves: this.filteredNodes(),
      expanded: this.expanded(),
      aggregates: this.aggregates(),
      maps: this.issueMaps(),
      activityCounts: this.activityCounts(),
      sort: this.sort(),
    }),
  );

  /**
   * Effective visibility of every row under the map scope overrides
   * (`spec/cli-contract.md` §Map scope overrides), in ONE post-order
   * walk per tree / override change. Each folder inherits its parent's
   * effective state unless it carries its own override (the root key
   * `''` resolves naturally at the top of the walk); each leaf the
   * same. Folder tri-state derives from the subtree leaf tally:
   *   - `all`  : every leaf under it is visible (checked);
   *   - `none` : none is (unchecked);
   *   - `some` : mixed (indeterminate).
   * An EMPTY folder (no leaves anywhere below) renders its own
   * effective state as `all` / `none` so its checkbox still answers to
   * toggles. The template reads `.get(row.path)` / `.has(row.path)` via
   * `@let`, so no per-row walk happens during render. Every row is
   * TOGGLEABLE: the covered-by-ancestor disabled state died with the
   * include-set model (a toggle under an overridden ancestor just
   * writes a deeper override).
   */
  private readonly visibilityWalk = computed<{
    folderStates: Map<string, TFolderVisibility>;
    visibleLeaves: ReadonlySet<string>;
  }>(() => {
    const overrides = this.mapVisibility.overrides();
    const folderStates = new Map<string, TFolderVisibility>();
    const visible = new Set<string>();
    // Returns [visibleLeafCount, totalLeafCount] for the subtree.
    const visit = (folder: ITreeFolder, parentState: 'include' | 'exclude'): [number, number] => {
      const selfState = overrides.get(folder.path) ?? parentState;
      let shown = 0;
      let total = 0;
      for (const leaf of folder.leaves) {
        const leafState = overrides.get(leaf.path) ?? selfState;
        total += 1;
        if (leafState === 'include') {
          shown += 1;
          visible.add(leaf.path);
        }
      }
      for (const sub of folder.subfolders.values()) {
        const [subShown, subTotal] = visit(sub, selfState);
        shown += subShown;
        total += subTotal;
      }
      folderStates.set(
        folder.path,
        total === 0
          ? selfState === 'include'
            ? 'all'
            : 'none'
          : shown === 0
            ? 'none'
            : shown === total
              ? 'all'
              : 'some',
      );
      return [shown, total];
    };
    // The root folder's own key is '' in the override map; above it sits
    // only the model default (include).
    visit(this.tree(), 'include');
    return { folderStates, visibleLeaves: visible };
  });

  readonly folderStateMap = computed<Map<string, TFolderVisibility>>(
    () => this.visibilityWalk().folderStates,
  );

  /** Leaves currently on the map (effective state = include). */
  readonly visibleLeaves = computed<ReadonlySet<string>>(
    () => this.visibilityWalk().visibleLeaves,
  );

  /**
   * The master checkbox's tri-state: the root folder's derived state
   * from the same walk (`''` is the tree root's path).
   */
  readonly rootState = computed<TFolderVisibility>(
    () => this.visibilityWalk().folderStates.get('') ?? 'all',
  );

  ngOnInit(): void {
    if (this.loader.liteNodes().length === 0 && !this.loader.loading()) {
      void this.loader.load();
    }
  }

  /**
   * Folder row / chevron click: PURE expand / collapse toggle. The whole
   * lite tree is already loaded via `/api/folders`, so this is an
   * in-memory state flip with no map fetch. The map selection is driven
   * exclusively by the folder CHECKBOX (`onToggleFolderVisibility`), so
   * collapsing a row never changes what the map renders.
   */
  toggleFolder(row: IFolderRow): void {
    const next = new Set(this.expanded());
    if (next.has(row.path)) next.delete(row.path);
    else next.add(row.path);
    this.expanded.set(next);
  }

  expandAll(): void {
    const all = new Set<string>();
    const visit = (folder: ITreeFolder): void => {
      if (folder.path) all.add(folder.path);
      for (const sub of folder.subfolders.values()) visit(sub);
    };
    visit(this.tree());
    this.expanded.set(all);
  }

  collapseAll(): void {
    this.expanded.set(new Set());
  }

  /** Column-header sort handler. Delegates the transition to the pure
   *  `nextSort` (tree resets, same column toggles, fresh column opens at
   *  its default direction). */
  onSortColumn(column: TSortColumn): void {
    this.sort.set(nextSort(this.sort(), column));
  }

  /** `aria-sort` value for a column header. */
  ariaSortFor(column: TSortColumn): 'ascending' | 'descending' | 'none' {
    const current = this.sort();
    if (current.column !== column) return 'none';
    return current.dir === 'asc' ? 'ascending' : 'descending';
  }

  /**
   * Leaf row activation: fire the open-intent so the adjacent map centers
   * on the node and the inspector slides in.
   */
  onLeafActivate(row: IFolderLeaf): void {
    this.openInMap(row);
  }

  /**
   * "Open in Map" affordance: focus the adjacent map on this node via the
   * shared `NODE_OPEN_INTENT` (the workspace override writes the `?path`
   * query param so the graph view centers + opens the inspector).
   */
  openInMap(row: IFolderLeaf): void {
    this.nodeOpenIntent.open(row.path);
  }

  /**
   * Shared checkbox toggle for any row (click handlers + the Space
   * key). Leaves flip to the opposite of their current visibility;
   * folders follow the user decision "a mixed folder clicks to fully
   * visible" (the native tri-state convention: indeterminate ->
   * checked), so only a fully-checked folder excludes on click.
   * `setSubtree` canonicalizes (drops the subtree's own overrides,
   * writes only a non-redundant one), so toggling under an overridden
   * ancestor writes exactly the deeper override the gesture means.
   */
  toggleRowVisibility(row: TFolderViewRow): void {
    if (row.type === 'folder') {
      const state = this.folderStateMap().get(row.path) ?? 'all';
      this.mapVisibility.setSubtree(row.path, state === 'all' ? 'exclude' : 'include');
      return;
    }
    const visible = this.visibleLeaves().has(row.path);
    this.mapVisibility.setSubtree(row.path, visible ? 'exclude' : 'include');
  }

  /** Toggle a single file's visibility on the map. */
  onToggleLeafVisibility(row: IFolderLeaf, event: Event): void {
    event.stopPropagation();
    this.toggleRowVisibility(row);
  }

  /** Toggle a folder's whole subtree on the map. */
  onToggleFolderVisibility(row: IFolderRow, event: Event): void {
    event.stopPropagation();
    this.toggleRowVisibility(row);
  }

  /**
   * Master checkbox in the tree-column header: toggles the whole corpus
   * (the root override, path `''`). Mixed -> all visible, mirroring the
   * per-folder convention.
   */
  onToggleAllVisibility(): void {
    const state = this.rootState();
    this.mapVisibility.setSubtree('', state === 'all' ? 'exclude' : 'include');
  }

  /**
   * Sitemap icon on a leaf row: isolate the node's whole link-chain on
   * the map (and select it).
   */
  onSitemapClick(row: IFolderLeaf, event: Event): void {
    event.stopPropagation();
    this.mapIsolate.isolate(row.path);
  }

  /**
   * Ignore (ban) icon on a leaf row: append the file's root-anchored
   * pattern to `.skillmapignore` behind the confirmation dialog
   * (`ProjectIgnoreService`). The `auto` outcome (confirmation
   * suppressed by `ui.confirmIgnore`) emits its telemetry HERE: the
   * dialog owns the once / always / declined values, but on the
   * suppressed path no dialog ever shows.
   */
  onIgnoreLeafClick(row: IFolderLeaf, event: Event): void {
    event.stopPropagation();
    void this.projectIgnore.requestIgnore(row.path, 'file', 'files').then((outcome) => {
      if (outcome === 'auto') this.usageTracker.trackFeature('ignore-path', 'auto', 'files');
    });
  }

  /** Ignore icon on a folder row: same flow, subtree pattern. */
  onIgnoreFolderClick(row: IFolderRow, event: Event): void {
    event.stopPropagation();
    void this.projectIgnore.requestIgnore(row.path, 'folder', 'files').then((outcome) => {
      if (outcome === 'auto') this.usageTracker.trackFeature('ignore-path', 'auto', 'files');
    });
  }

  /** Ignore-write failure text for the rail's closable error message. */
  protected readonly ignoreError = this.projectIgnore.errorText;

  protected onIgnoreErrorClose(): void {
    this.projectIgnore.clearError();
  }

  resetFilters(): void {
    this.filters.reset();
  }

  /**
   * Reveal a leaf in the tree: expand its ancestor folders (tree mode only)
   * so the row renders, then scroll it into view once that render lands.
   * Called from `untracked`, so the reads of `isFlat` / `expanded` here do
   * not subscribe the reveal effect and `afterNextRender` is legal.
   */
  private revealLeaf(path: string): void {
    if (!this.isFlat()) {
      const ancestors = leafAncestorFolderPaths(path);
      if (ancestors.length > 0) {
        const next = new Set(this.expanded());
        let changed = false;
        for (const ancestor of ancestors) {
          if (!next.has(ancestor)) {
            next.add(ancestor);
            changed = true;
          }
        }
        if (changed) this.expanded.set(next);
      }
    }
    // Scroll after the (possibly expansion-triggered) render, so `rows()`
    // already contains the revealed row and its index is final. The row
    // itself may well NOT be in the DOM: the table is virtualised, which is
    // exactly why the scroll is driven by index instead of by element.
    afterNextRender(() => this.scrollToLeaf(path), { injector: this.injector });
  }

  // ---------------------------------------------------------------------
  // Keyboard navigation
  //
  // Virtualisation means only a window of rows exists in the DOM, so the
  // pre-virtual model (every `<tr>` `tabindex="0"`, walk them with Tab)
  // silently stopped being able to reach row 500. This is a roving
  // tabindex over rows: exactly one row is tabbable at a time, arrows move
  // it, and the listing scrolls to follow.
  //
  // The table deliberately keeps `role="table"` rather than claiming
  // `role="treegrid"`. Per the WAI-ARIA APG, treegrid obliges
  // `role="gridcell"` on every cell plus two-dimensional cell navigation
  // with a mode switch for widgets inside cells; a treegrid that announces
  // itself and then does not answer cell navigation is worse for assistive
  // tech than an honest table. WCAG 2.1 AA wants operability (2.1.1),
  // visible focus (2.4.7) and coherent focus order (2.4.3), all of which
  // this satisfies without over-promising semantics.
  // ---------------------------------------------------------------------

  /** Index into `rows()` of the row that currently owns `tabindex="0"`. */
  protected readonly activeIndex = signal(0);

  /** Keep the roving index inside the listing as rows appear / disappear. */
  private clampActiveIndex(): void {
    const max = this.rows().length - 1;
    if (max < 0) return;
    if (this.activeIndex() > max) this.activeIndex.set(max);
  }

  /**
   * Whether the keyboard is currently "inside" the listing. Gates the focus
   * rescue below so scrolling with the mouse never steals focus from
   * somewhere else on the page.
   */
  private keyboardEngaged = false;

  /** One-shot guard for the scroll listener wired in the constructor. */
  private focusRescueBound = false;

  /** A row took focus (click, Tab, or our own `focus()` call). */
  protected onRowFocus(index: number): void {
    this.activeIndex.set(index);
    this.keyboardEngaged = true;
  }

  /** Focus left the listing for another element: stop rescuing. */
  protected onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    // A null relatedTarget means focus went nowhere, which is the very case
    // the rescue exists for, so engagement is deliberately left on.
    if (next === null) return;
    const host = this.scrollerEl();
    if (host && host.contains(next)) return;
    this.keyboardEngaged = false;
  }

  /**
   * Focus rescue for recycled rows (WCAG 2.4.3).
   *
   * When the focused row scrolls out of the render window Angular destroys
   * it, and the browser silently resets focus to `<body>`: the keyboard user
   * is stranded mid-list with no way back except Tab from the top. Removing
   * a focused element does NOT reliably fire `focusout`, so this cannot be
   * event-driven off the row; it hangs off the scroller's own scroll instead
   * and re-homes focus onto the viewport (which is `tabindex="-1"`, so it
   * takes focus programmatically without joining the Tab order).
   *
   * `activeIndex` is deliberately left untouched, so the next arrow key
   * resumes exactly where the user was rather than jumping to the top.
   */
  private bindFocusRescue(): void {
    const el = this.scrollerEl();
    if (!el) return;
    const onScroll = (): void => {
      if (!this.keyboardEngaged) return;
      if (this.document.activeElement !== this.document.body) return;
      el.focus({ preventScroll: true });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    this.destroyRef.onDestroy(() => el.removeEventListener('scroll', onScroll));
  }

  /**
   * Single delegated key handler for the whole listing (one listener
   * instead of the three per row the template used to carry).
   */
  protected onKeydown(event: KeyboardEvent): void {
    const rows = this.rows();
    if (rows.length === 0) return;
    const current = Math.min(this.activeIndex(), rows.length - 1);
    const row = rows[current];

    switch (event.key) {
      case 'ArrowDown':
        this.moveActive(current + 1);
        break;
      case 'ArrowUp':
        this.moveActive(current - 1);
        break;
      case 'Home':
        this.moveActive(0);
        break;
      case 'End':
        this.moveActive(rows.length - 1);
        break;
      case 'PageDown':
        this.moveActive(current + this.rowsPerViewport());
        break;
      case 'PageUp':
        this.moveActive(current - this.rowsPerViewport());
        break;
      case 'ArrowRight':
        // Tree semantics: open a closed folder, otherwise walk forward.
        if (row.type === 'folder' && !row.expanded) this.toggleFolder(row);
        else this.moveActive(current + 1);
        break;
      case 'ArrowLeft':
        // Close an open folder, otherwise climb to the enclosing one.
        if (row.type === 'folder' && row.expanded) this.toggleFolder(row);
        else this.moveActive(this.parentIndex(current));
        break;
      case 'Enter':
        if (row.type === 'folder') this.toggleFolder(row);
        else this.openInMap(row);
        break;
      case ' ':
      case 'Spacebar':
        // Space operates the row's checkbox, matching what Space does to a
        // checkbox everywhere else. Enter keeps the "activate" gesture.
        this.toggleRowVisibility(row);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  /** How many whole rows fit in the scroll viewport, for Page Up / Down. */
  private rowsPerViewport(): number {
    const el = this.scrollerEl();
    const height = el?.clientHeight ?? 0;
    return Math.max(1, Math.floor(height / FILES_ROW_HEIGHT_PX));
  }

  /**
   * Index of the row that encloses `index`: the nearest preceding row at a
   * shallower depth. Returns `index` itself when already at the top level,
   * so Arrow Left is a no-op there rather than jumping somewhere random.
   */
  private parentIndex(index: number): number {
    const rows = this.rows();
    const depth = rows[index]?.depth ?? 0;
    for (let i = index - 1; i >= 0; i -= 1) {
      if (rows[i].depth < depth) return i;
    }
    return index;
  }

  /**
   * Move the roving focus: clamp, scroll the row into view, then focus it
   * once the render lands. The focus has to wait for the render because
   * the target row may not be mounted yet, which is the whole reason the
   * scroll is index-driven.
   */
  private moveActive(next: number): void {
    const rows = this.rows();
    const target = Math.max(0, Math.min(next, rows.length - 1));
    this.activeIndex.set(target);
    this.scrollToIndex(target);
    afterNextRender(() => this.focusRow(target), { injector: this.injector });
  }

  /** Focus the `<tr>` for `index`, if the render window contains it. */
  private focusRow(index: number): void {
    const el = this.scrollerEl()?.querySelector<HTMLElement>(`[data-row-index="${index}"]`);
    el?.focus({ preventScroll: true });
  }

  /** The element that actually owns `scrollTop` under virtual scroll: the
   *  scroller's viewport, not the table host. Null before the scroller's
   *  own view init. */
  private scrollerEl(): HTMLElement | null {
    return (this.table()?.scroller?.getElementRef()?.nativeElement as HTMLElement | undefined) ?? null;
  }

  /**
   * Bring row `index` into view, reproducing `scrollIntoView({ block:
   * 'nearest' })`: a row that is already fully visible does not move.
   *
   * Deliberately NOT `Table.scrollToVirtualIndex`, which drops the scroll
   * behavior (losing the reduced-motion handling) and always parks the row
   * at the top of the viewport. Under "files follows selection" that would
   * yank the listing on every map click, including clicks on rows that were
   * already on screen.
   *
   * The arithmetic reads the same fixed item size the virtualizer uses, so
   * the two cannot disagree about where a row lives.
   */
  private scrollToIndex(index: number): void {
    const el = this.scrollerEl();
    if (!el || index < 0) return;
    const rowTop = index * FILES_ROW_HEIGHT_PX;
    const rowBottom = rowTop + FILES_ROW_HEIGHT_PX;
    if (rowTop >= el.scrollTop && rowBottom <= el.scrollTop + el.clientHeight) return;
    const target = rowTop < el.scrollTop ? rowTop : rowBottom - el.clientHeight;
    el.scrollTo({ top: Math.max(0, target), behavior: this.revealBehavior() });
  }

  /** Scroll the selected leaf's row into the rail viewport. Smooth unless
   *  the OS asks to reduce motion. */
  private scrollToLeaf(path: string): void {
    this.scrollToIndex(this.rows().findIndex((row) => row.path === path));
  }

  private revealBehavior(): ScrollBehavior {
    const mq = this.document.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)');
    return mq?.matches ? 'auto' : 'smooth';
  }
}
