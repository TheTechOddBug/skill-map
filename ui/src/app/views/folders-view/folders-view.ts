import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { MessageModule } from 'primeng/message';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';

import { FOLDERS_VIEW_TEXTS } from '../../../i18n/folders-view.texts';
import { LIST_VIEW_TEXTS } from '../../../i18n/list-view.texts';
import { NODE_CARD_TEXTS } from '../../../i18n/node-card.texts';
import { CollectionLoaderService } from '../../../services/collection-loader';
import { FilterStoreService } from '../../../services/filter-store';
import { IssuePathsService } from '../../../services/issue-paths';
import { FilterBar } from '../../components/filter-bar/filter-bar';
import { STABILITY_SEVERITY, type TTagSeverity } from '../../components/severity-map';
import {
  compactNumber,
  effectiveIsStale,
  effectiveStaleTooltip,
  effectiveStability,
  effectiveUserTags,
} from '../../../models/node-derived';
import { pathBasenameForLink } from '../../../services/trigger-resolve';
import type {
  INodeView,
  TStability,
} from '../../../models/node';
import type { IIssueApi, TIssueSeverityApi } from '../../../models/api';
import { readStoredCollapsed, writeStoredCollapsed } from './folders-view.storage';

interface IFolderLeafTagChip {
  tag: string;
  source: 'author' | 'user';
}

interface IFolderLeaf {
  readonly type: 'leaf';
  readonly path: string;
  readonly name: string;
  readonly depth: number;
  readonly tags: readonly IFolderLeafTagChip[];
  readonly tagsOverflow: number;
  readonly tagsOverflowTooltip: string;
  readonly linksIn: string;
  readonly linksOut: string;
  readonly tokens: string;
  readonly tokensRaw: number;
  readonly errors: number;
  readonly warns: number;
  readonly isStale: boolean;
  readonly staleTooltip: string;
  readonly stability: TStability;
  readonly stabilitySeverity: TTagSeverity;
}

interface IFolderRow {
  readonly type: 'folder';
  readonly path: string;
  readonly name: string;
  readonly depth: number;
  readonly expanded: boolean;
  readonly nodeCount: number;
}

type TFolderViewRow = IFolderRow | IFolderLeaf;

interface ITreeFolder {
  readonly path: string;
  readonly name: string;
  readonly subfolders: Map<string, ITreeFolder>;
  readonly leaves: INodeView[];
}

interface IAggregate {
  nodes: number;
}

@Component({
  selector: 'sm-folders-view',
  imports: [
    FilterBar,
    TableModule,
    TagModule,
    ProgressSpinnerModule,
    MessageModule,
    ButtonModule,
    TooltipModule,
  ],
  templateUrl: './folders-view.html',
  styleUrl: './folders-view.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FoldersView implements OnInit {
  private readonly loader = inject(CollectionLoaderService);
  private readonly filters = inject(FilterStoreService);
  private readonly issuePaths = inject(IssuePathsService);
  private readonly router = inject(Router);
  protected readonly texts = FOLDERS_VIEW_TEXTS;
  protected readonly listTexts = LIST_VIEW_TEXTS;

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

  constructor() {
    effect(() => {
      writeStoredCollapsed(this.collapsed());
    });
  }

  private readonly filteredNodes = computed<readonly INodeView[]>(() => {
    const severity = this.issuePaths.bySeverity();
    return this.filters.apply(this.loader.nodes(), severity);
  });

  private readonly tree = computed<ITreeFolder>(() => {
    const root: ITreeFolder = { path: '', name: '', subfolders: new Map(), leaves: [] };
    for (const node of this.filteredNodes()) {
      const segments = node.path.split('/');
      const fileName = segments.pop();
      if (fileName === undefined) continue;
      let cursor = root;
      const prefix: string[] = [];
      for (const seg of segments) {
        if (!seg) continue;
        prefix.push(seg);
        let child = cursor.subfolders.get(seg);
        if (!child) {
          child = {
            path: prefix.join('/'),
            name: seg,
            subfolders: new Map(),
            leaves: [],
          };
          cursor.subfolders.set(seg, child);
        }
        cursor = child;
      }
      cursor.leaves.push(node);
    }
    return root;
  });

  private readonly aggregates = computed<ReadonlyMap<string, IAggregate>>(() => {
    const out = new Map<string, IAggregate>();
    const visit = (folder: ITreeFolder): IAggregate => {
      let nodes = folder.leaves.length;
      for (const sub of folder.subfolders.values()) {
        nodes += visit(sub).nodes;
      }
      const agg: IAggregate = { nodes };
      out.set(folder.path, agg);
      return agg;
    };
    visit(this.tree());
    return out;
  });

  readonly rows = computed<TFolderViewRow[]>(() => {
    const tree = this.tree();
    const collapsed = this.collapsed();
    const aggregates = this.aggregates();
    const errorCounts = countIssuesByPath(this.loader.scan()?.issues, 'error');
    const warnCounts = countIssuesByPath(this.loader.scan()?.issues, 'warn');
    const rows: TFolderViewRow[] = [];

    const emitFolder = (folder: ITreeFolder, depth: number): void => {
      const isExpanded = !collapsed.has(folder.path);
      const agg = aggregates.get(folder.path) ?? { nodes: 0 };
      rows.push({
        type: 'folder',
        path: folder.path,
        name: folder.name,
        depth,
        expanded: isExpanded,
        nodeCount: agg.nodes,
      });
      if (!isExpanded) return;
      const subs = Array.from(folder.subfolders.values()).sort(byName);
      for (const sub of subs) emitFolder(sub, depth + 1);
      const leaves = [...folder.leaves].sort(byNodePath);
      for (const leaf of leaves) rows.push(this.makeLeafRow(leaf, depth + 1, errorCounts, warnCounts));
    };

    const rootSubs = Array.from(tree.subfolders.values()).sort(byName);
    for (const sub of rootSubs) emitFolder(sub, 0);
    const rootLeaves = [...tree.leaves].sort(byNodePath);
    for (const leaf of rootLeaves) rows.push(this.makeLeafRow(leaf, 0, errorCounts, warnCounts));

    return rows;
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

  /**
   * Mock preview slot, mirrors `<sm-list-view>`'s prototype: clicking a
   * leaf row captures it in this signal so the right-hand `<aside>`
   * re-renders against it. Folder rows still toggle expand / collapse
   * via `toggleFolder`; only file rows feed the preview. No router
   * navigation while the prototype lives, the existing /graph jump
   * comes back once the design is settled.
   */
  readonly previewRow = signal<IFolderLeaf | null>(null);

  openLeaf(row: IFolderLeaf): void {
    this.previewRow.set(row);
  }

  resetFilters(): void {
    this.filters.reset();
  }

  onRowClick(row: TFolderViewRow): void {
    if (row.type === 'folder') this.toggleFolder(row);
    else this.openLeaf(row);
  }

  private makeLeafRow(
    node: INodeView,
    depth: number,
    errorCounts: ReadonlyMap<string, number>,
    warnCounts: ReadonlyMap<string, number>,
  ): IFolderLeaf {
    const stability = rowStability(node);
    const isStale = effectiveIsStale(node);
    const allChips = collectTagChips(node);
    const tags = allChips.slice(0, TAG_CHIPS_CAP);
    const hiddenChips = allChips.slice(TAG_CHIPS_CAP);
    return {
      type: 'leaf',
      path: node.path,
      name: leafName(node),
      depth,
      tags,
      tagsOverflow: hiddenChips.length,
      tagsOverflowTooltip: hiddenChips.map((c) => c.tag).join('\n'),
      linksIn: node.linksInCount !== undefined ? String(node.linksInCount) : LIST_VIEW_TEXTS.missing,
      linksOut: node.linksOutCount !== undefined ? String(node.linksOutCount) : LIST_VIEW_TEXTS.missing,
      tokens: node.tokensTotal !== undefined ? compactNumber(node.tokensTotal) : LIST_VIEW_TEXTS.missing,
      tokensRaw: node.tokensTotal ?? 0,
      errors: errorCounts.get(node.path) ?? 0,
      warns: warnCounts.get(node.path) ?? 0,
      isStale,
      staleTooltip: isStale ? effectiveStaleTooltip(node, NODE_CARD_TEXTS.sidecar) : '',
      stability,
      stabilitySeverity: STABILITY_SEVERITY[stability],
    };
  }
}

const TAG_CHIPS_CAP = 3;

function leafName(n: INodeView): string {
  const fromFm = n.frontmatter.name?.trim();
  if (fromFm) return fromFm;
  return pathBasenameForLink(n.path) || FOLDERS_VIEW_TEXTS.missing;
}

function rowStability(n: INodeView): TStability {
  return effectiveStability(n) ?? 'stable';
}

function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name);
}

function byNodePath(a: INodeView, b: INodeView): number {
  return a.path.localeCompare(b.path);
}

function collectTagChips(n: INodeView): IFolderLeafTagChip[] {
  const out: IFolderLeafTagChip[] = [];
  const fm = n.frontmatter as Record<string, unknown>;
  const author = fm['tags'];
  if (Array.isArray(author)) {
    for (const t of author) {
      if (typeof t === 'string' && t.length > 0) out.push({ tag: t, source: 'author' });
    }
  }
  for (const t of effectiveUserTags(n)) out.push({ tag: t, source: 'user' });
  return out;
}

function countIssuesByPath(
  issues: readonly IIssueApi[] | undefined,
  severity: TIssueSeverityApi,
): Map<string, number> {
  const out = new Map<string, number>();
  if (!issues) return out;
  for (const issue of issues) {
    if (issue.severity !== severity) continue;
    for (const path of issue.nodeIds) {
      out.set(path, (out.get(path) ?? 0) + 1);
    }
  }
  return out;
}
