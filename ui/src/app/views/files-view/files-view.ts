import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { TableModule } from 'primeng/table';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { MessageModule } from 'primeng/message';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';

import { FILES_VIEW_TEXTS } from '../../../i18n/files-view.texts';
import { CollectionLoaderService } from '../../../services/collection-loader';
import { FilterStoreService } from '../../../services/filter-store';
import { IssuePathsService } from '../../../services/issue-paths';
import { MapVisibilityService, type TFolderVisibility } from '../../../services/map-visibility';
import { MAP_ISOLATE_INTENT } from '../../slots/map-isolate-intent';
import { NODE_OPEN_INTENT } from '../../slots/node-open-intent';
import type { INodeView } from '../../../models/node';
import { readStoredCollapsed, writeStoredCollapsed } from './files-view.storage';
import {
  buildRows,
  buildTree,
  collectLeafPaths,
  computeAggregates,
  countIssuesByPath,
  findFolder,
  type IFolderLeaf,
  type IFolderRow,
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
  private readonly issuePaths = inject(IssuePathsService);
  private readonly nodeOpenIntent = inject(NODE_OPEN_INTENT);
  private readonly mapVisibility = inject(MapVisibilityService);
  private readonly mapIsolate = inject(MAP_ISOLATE_INTENT);
  protected readonly texts = FILES_VIEW_TEXTS;

  readonly loading = this.loader.loading;
  readonly error = this.loader.error;
  readonly filtersActive = this.filters.isActive;

  /**
   * Folders the user has explicitly COLLAPSED. The default state is
   * "all expanded", so anything NOT in this set renders open. Seeded
   * from `localStorage` on construction; an `effect` mirrors mutations
   * back so the choice persists across reloads. Inverting the semantic
   * (collapsed vs expanded) keeps new folders that appear after a
   * future scan open out of the box, matching the "first time =
   * expanded" UX.
   */
  private readonly collapsed = signal<ReadonlySet<string>>(readStoredCollapsed());

  /**
   * Active sort. `tree` (the default) renders the folder structure; any
   * data column flattens the table into a sorted file listing. Seeded
   * from `localStorage`; the `effect` mirrors changes back.
   */
  private readonly sort = signal<IFilesSort>(readStoredSort());
  readonly sortState = this.sort.asReadonly();
  readonly isFlat = computed(() => this.sort().column !== 'tree');

  constructor() {
    effect(() => {
      writeStoredCollapsed(this.collapsed());
    });
    effect(() => {
      writeStoredSort(this.sort());
    });
  }

  private readonly filteredNodes = computed<readonly INodeView[]>(() => {
    const severity = this.issuePaths.bySeverity();
    return this.filters.apply(this.loader.nodes(), severity);
  });

  private readonly tree = computed<ITreeFolder>(() => buildTree(this.filteredNodes()));

  private readonly aggregates = computed(() => computeAggregates(this.tree()));

  readonly rows = computed<TFolderViewRow[]>(() => {
    const errorCounts = countIssuesByPath(this.loader.scan()?.issues, 'error');
    const warnCounts = countIssuesByPath(this.loader.scan()?.issues, 'warn');
    return buildRows({
      tree: this.tree(),
      leaves: this.filteredNodes(),
      collapsed: this.collapsed(),
      aggregates: this.aggregates(),
      maps: { errorCounts, warnCounts },
      sort: this.sort(),
    });
  });

  /**
   * Map visibility curation. The set lives in the shared
   * `MapVisibilityService` and only affects the map; the tree here stays
   * full. Per the cascade decision, folder operations act over the
   * FILTERED tree (`this.tree()` is built from `filteredNodes()`), so a
   * folder checkbox under an active search curates only the visible leaves.
   *
   * Tri-state of every folder in one walk (post-order accumulation of
   * total vs included descendant leaves). Re-derived only when the tree
   * or the curation set changes; the template reads `.get(row.path)` so
   * no per-row tree walk happens during render.
   */
  readonly folderStateMap = computed<Map<string, TFolderVisibility>>(() => {
    const included = this.mapVisibility.paths();
    const out = new Map<string, TFolderVisibility>();
    const visit = (folder: ITreeFolder): [number, number] => {
      let total = 0;
      let inc = 0;
      for (const leaf of folder.leaves) {
        total++;
        if (included.has(leaf.path)) inc++;
      }
      for (const sub of folder.subfolders.values()) {
        const [t, i] = visit(sub);
        total += t;
        inc += i;
      }
      out.set(folder.path, total === 0 || inc === 0 ? 'none' : inc === total ? 'all' : 'some');
      return [total, inc];
    };
    visit(this.tree());
    return out;
  });

  leafVisible(path: string): boolean {
    return this.mapVisibility.paths().has(path);
  }

  /** Folder depth of a node, 0-based: a root file is depth 0, a file one
   *  folder deep is 1, and so on (the count of path separators). */
  private nodeDepth(path: string): number {
    let depth = 0;
    for (const ch of path) if (ch === '/') depth++;
    return depth;
  }

  /**
   * Node paths (within the FILTERED/visible tree, per the cascade
   * decision) up to a folder depth. Basis for the 0 / 1 / 2 depth presets:
   * level 0 = root, 1 = up to one folder deep, 2 = up to two deep.
   */
  private depthSet(level: number): Set<string> {
    const out = new Set<string>();
    for (const node of this.filteredNodes()) {
      if (this.nodeDepth(node.path) <= level) out.add(node.path);
    }
    return out;
  }

  /** True when the current map selection is exactly `target`. */
  private pathsAre(target: ReadonlySet<string>): boolean {
    const current = this.mapVisibility.paths();
    if (current.size !== target.size) return false;
    for (const p of target) if (!current.has(p)) return false;
    return true;
  }

  /**
   * Which depth preset (0 / 1 / 2), if any, the current map selection
   * exactly matches, so the tree header can highlight the active button.
   * Null when the set is empty or was hand-curated to a non-depth slice.
   */
  readonly activeDepthLevel = computed<number | null>(() => {
    if (this.mapVisibility.paths().size === 0) return null;
    for (const level of [0, 1, 2]) {
      if (this.pathsAre(this.depthSet(level))) return level;
    }
    return null;
  });

  /**
   * Depth preset: check every node up to `level` so the map shows exactly
   * that folder-depth slice. Clicking the already-active preset clears the
   * selection (shows everything again).
   */
  setDepthLevel(level: number): void {
    const target = this.depthSet(level);
    if (this.pathsAre(target)) this.mapVisibility.clear();
    else this.mapVisibility.setOnly(target);
  }

  ngOnInit(): void {
    if (this.loader.nodes().length === 0 && !this.loader.loading()) {
      void this.loader.load();
    }
  }

  toggleFolder(row: IFolderRow): void {
    const next = new Set(this.collapsed());
    if (next.has(row.path)) next.delete(row.path);
    else next.add(row.path);
    this.collapsed.set(next);
  }

  expandAll(): void {
    this.collapsed.set(new Set());
  }

  collapseAll(): void {
    const all = new Set<string>();
    const visit = (folder: ITreeFolder): void => {
      if (folder.path) all.add(folder.path);
      for (const sub of folder.subfolders.values()) visit(sub);
    };
    visit(this.tree());
    this.collapsed.set(all);
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

  /** Toggle a folder's visibility on the map, cascading to its visible
   *  descendant leaves (tri-state). */
  onToggleFolderVisibility(row: IFolderRow, event: Event): void {
    event.stopPropagation();
    const folder = findFolder(this.tree(), row.path);
    if (folder) this.mapVisibility.toggleFolder(collectLeafPaths(folder));
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
}
