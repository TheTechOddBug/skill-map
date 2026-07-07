import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import { TableModule } from 'primeng/table';
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
  private readonly activityStats = inject(NodeActivityStatsService);
  private readonly followSelection = inject(FilesFollowSelectionService);
  private readonly route = inject(ActivatedRoute);
  private readonly injector = inject(Injector);
  private readonly host = inject(ElementRef) as ElementRef<HTMLElement>;
  protected readonly texts = FILES_VIEW_TEXTS;

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
   * Map selection tri-state, PREFIX-aware. The selection lives in the
   * shared `MapVisibilityService` as a set of folder PREFIXES + exact
   * leaf paths; it drives the map (the loader fetches the union). Per
   * folder:
   *   - `all`  : the folder's own path is in the selection (its whole
   *              subtree renders via the prefix);
   *   - `some` : a strict descendant (folder or leaf) is selected but the
   *              folder itself is not;
   *   - `none` : neither.
   * Computed in one post-order walk (each folder learns whether any
   * descendant is selected). Re-derived only when the tree or the
   * selection changes; the template reads `.get(row.path)` so no per-row
   * tree walk happens during render.
   */
  readonly folderStateMap = computed<Map<string, TFolderVisibility>>(() => {
    const selected = this.mapVisibility.paths();
    const out = new Map<string, TFolderVisibility>();
    // Returns whether the folder OR any strict descendant is selected.
    const visit = (folder: ITreeFolder): boolean => {
      const selfSelected = selected.has(folder.path);
      let descendantSelected = false;
      for (const leaf of folder.leaves) {
        if (selected.has(leaf.path)) descendantSelected = true;
      }
      for (const sub of folder.subfolders.values()) {
        if (visit(sub)) descendantSelected = true;
      }
      out.set(
        folder.path,
        selfSelected ? 'all' : descendantSelected ? 'some' : 'none',
      );
      return selfSelected || descendantSelected;
    };
    visit(this.tree());
    return out;
  });

  /**
   * Paths (folders AND leaves) that sit under a SELECTED STRICT ANCESTOR
   * folder. Such a row renders its checkbox checked but DISABLED: a
   * selected folder includes its whole subtree as one prefix, so a
   * descendant cannot be toggled on its own; to change it the user
   * unchecks the ancestor (then, if wanted, re-selects a finer folder /
   * leaf).
   *
   * Derived together with `visibleLeaves` in ONE post-order walk per
   * tree / selection change (same memoization the folder tri-state
   * already uses via `folderStateMap`). The previous shape was a
   * per-call scan of the whole selection set with `startsWith`, invoked
   * up to six times per row per CD pass, O(rows x |selection|) on every
   * checkbox click / sort / expand over the full corpus tree.
   */
  readonly coveredByAncestor = computed<ReadonlySet<string>>(
    () => this.selectionCoverage().covered,
  );

  /**
   * Leaves currently on the map: their exact path is in the selection OR
   * an ancestor folder prefix is (a selected folder includes all its
   * descendants). Template reads `.has(row.path)` via a `@let`, so no
   * per-row selection scan happens during render.
   */
  readonly visibleLeaves = computed<ReadonlySet<string>>(
    () => this.selectionCoverage().visible,
  );

  /**
   * Shared walk behind `coveredByAncestor` / `visibleLeaves`. A leaf
   * path can never prefix another path (files have no children), so
   * "strict ancestor prefix selected" is exactly "some enclosing folder
   * on the tree walk is selected", no `startsWith` needed.
   */
  private readonly selectionCoverage = computed<{
    covered: ReadonlySet<string>;
    visible: ReadonlySet<string>;
  }>(() => {
    const selected = this.mapVisibility.paths();
    const covered = new Set<string>();
    const visible = new Set<string>();
    const visit = (folder: ITreeFolder, underSelected: boolean): void => {
      if (underSelected && folder.path) covered.add(folder.path);
      // The root folder's path is '' and an empty prefix never covers
      // (mirrors the `prefix !== ''` guard of the pre-memoized scan).
      const childrenUnder =
        underSelected || (folder.path !== '' && selected.has(folder.path));
      for (const leaf of folder.leaves) {
        if (childrenUnder) {
          covered.add(leaf.path);
          visible.add(leaf.path);
        } else if (selected.has(leaf.path)) {
          visible.add(leaf.path);
        }
      }
      for (const sub of folder.subfolders.values()) visit(sub, childrenUnder);
    };
    visit(this.tree(), false);
    return { covered, visible };
  });

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

  /** Toggle a single file's visibility on the map. */
  onToggleLeafVisibility(row: IFolderLeaf, event: Event): void {
    event.stopPropagation();
    this.mapVisibility.toggleLeaf(row.path);
  }

  /** Toggle a folder's PREFIX in the map selection. The prefix is sent
   *  verbatim to `/api/branch`; the server expands it to the capped
   *  subtree union (so this stays small regardless of subtree size). */
  onToggleFolderVisibility(row: IFolderRow, event: Event): void {
    event.stopPropagation();
    this.mapVisibility.toggleFolder(row.path);
  }

  /**
   * Sitemap icon on a leaf row: isolate the node's whole link-chain on
   * the map (and select it).
   */
  onSitemapClick(row: IFolderLeaf, event: Event): void {
    event.stopPropagation();
    this.mapIsolate.isolate(row.path);
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
    // Scroll after the (possibly expansion-triggered) render, so the target
    // row exists in the DOM. The files table is not virtualised, so an
    // expanded row is always present to scroll to.
    afterNextRender(() => this.scrollToLeaf(path), { injector: this.injector });
  }

  /** Scroll the selected leaf's row into the rail viewport. Smooth unless
   *  the OS asks to reduce motion. */
  private scrollToLeaf(path: string): void {
    const selector = `[data-testid="files-leaf-${escapeAttrValue(path)}"]`;
    const row = this.host.nativeElement.querySelector(selector);
    row?.scrollIntoView({ block: 'nearest', behavior: this.revealBehavior() });
  }

  private revealBehavior(): ScrollBehavior {
    const mq = this.host.nativeElement.ownerDocument.defaultView?.matchMedia?.(
      '(prefers-reduced-motion: reduce)',
    );
    return mq?.matches ? 'auto' : 'smooth';
  }
}

/** Escape a value for use inside a `[data-testid="…"]` attribute selector.
 *  Node paths can carry characters that would break the quoted string. */
function escapeAttrValue(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}
