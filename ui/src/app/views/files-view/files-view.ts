import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { MessageModule } from 'primeng/message';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';

import { FILES_VIEW_TEXTS } from '../../../i18n/files-view.texts';
import { CollectionLoaderService } from '../../../services/collection-loader';
import { FilterStoreService } from '../../../services/filter-store';
import { IssuePathsService } from '../../../services/issue-paths';
import { FilterBar } from '../../components/filter-bar/filter-bar';
import { NODE_OPEN_INTENT } from '../../slots/node-open-intent';
import type { INodeView } from '../../../models/node';
import { readStoredCollapsed, writeStoredCollapsed } from './files-view.storage';
import {
  buildRows,
  buildTree,
  computeAggregates,
  countIssuesByPath,
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
    FilterBar,
    TableModule,
    TagModule,
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
  protected readonly texts = FILES_VIEW_TEXTS;

  readonly loading = this.loader.loading;
  readonly error = this.loader.error;
  readonly total = this.loader.count;
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

  readonly visibleCount = computed(() => this.filteredNodes().length);

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
   * Mock preview slot, prototype only: clicking a leaf row captures
   * it in this signal so the right-hand `<aside>` re-renders against
   * the captured row. Folder rows still toggle expand / collapse via
   * `toggleFolder`; only file rows feed the preview.
   */
  readonly previewRow = signal<IFolderLeaf | null>(null);

  openLeaf(row: IFolderLeaf): void {
    this.previewRow.set(row);
  }

  /**
   * "Open in Map" affordance: navigate to the graph route focused on
   * this node (`/map?path=<path>`), via the shared `NODE_OPEN_INTENT`
   * the inspector uses. Distinct from `openLeaf`, which only feeds the
   * local preview aside, so the row click and the button do different
   * things.
   */
  openInMap(row: IFolderLeaf): void {
    this.nodeOpenIntent.open(row.path);
  }

  resetFilters(): void {
    this.filters.reset();
  }

  onRowClick(row: TFolderViewRow): void {
    if (row.type === 'folder') this.toggleFolder(row);
    else this.openLeaf(row);
  }
}
