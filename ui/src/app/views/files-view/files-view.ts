import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { MessageModule } from 'primeng/message';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';

import { FILES_VIEW_TEXTS } from '../../../i18n/files-view.texts';
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
} from '../../../models/node-derived';
import { pathBasenameForLink } from '../../../services/trigger-resolve';
import { NODE_OPEN_INTENT } from '../../slots/node-open-intent';
import type {
  INodeView,
  TStability,
} from '../../../models/node';
import type { IIssueApi, TIssueSeverityApi } from '../../../models/api';
import { readStoredCollapsed, writeStoredCollapsed } from './files-view.storage';

interface IFolderLeaf {
  readonly type: 'leaf';
  readonly path: string;
  readonly name: string;
  /**
   * Collapsed folder chain shown dimmed before the name when a
   * single-child branch folds down to one file (e.g. `docs/guides/`).
   * Empty for ordinary leaves that render under a folder row.
   */
  readonly prefix: string;
  readonly depth: number;
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

    // Compact single-child folder chains into one row (VS Code
    // "compact folders"): while a folder holds exactly one subfolder
    // and no files of its own, fold the child's name into the chain.
    // When the chain bottoms out at a folder with a single file and no
    // subfolders, the file folds in too, so a branch leading to a lone
    // file is one line (`docs/guides/intro.md`) instead of a nested
    // arrowhead.
    const emitFolder = (folder: ITreeFolder, depth: number): void => {
      const chain = [folder.name];
      let terminal = folder;
      while (terminal.subfolders.size === 1 && terminal.leaves.length === 0) {
        const [only] = terminal.subfolders.values();
        chain.push(only.name);
        terminal = only;
      }
      const chainName = chain.join('/');

      if (terminal.subfolders.size === 0 && terminal.leaves.length === 1) {
        rows.push(this.makeLeafRow(terminal.leaves[0], depth, errorCounts, warnCounts, `${chainName}/`));
        return;
      }

      const isExpanded = !collapsed.has(terminal.path);
      const agg = aggregates.get(terminal.path) ?? { nodes: 0 };
      rows.push({
        type: 'folder',
        path: terminal.path,
        name: chainName,
        depth,
        expanded: isExpanded,
        nodeCount: agg.nodes,
      });
      if (!isExpanded) return;
      const subs = Array.from(terminal.subfolders.values()).sort(byName);
      for (const sub of subs) emitFolder(sub, depth + 1);
      const leaves = [...terminal.leaves].sort(byNodePath);
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

  private makeLeafRow(
    node: INodeView,
    depth: number,
    errorCounts: ReadonlyMap<string, number>,
    warnCounts: ReadonlyMap<string, number>,
    prefix = '',
  ): IFolderLeaf {
    const stability = rowStability(node);
    const isStale = effectiveIsStale(node);
    return {
      type: 'leaf',
      path: node.path,
      name: leafName(node),
      prefix,
      depth,
      linksIn: node.linksInCount !== undefined ? String(node.linksInCount) : FILES_VIEW_TEXTS.missing,
      linksOut: node.linksOutCount !== undefined ? String(node.linksOutCount) : FILES_VIEW_TEXTS.missing,
      tokens: node.tokensTotal !== undefined ? compactNumber(node.tokensTotal) : FILES_VIEW_TEXTS.missing,
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

function leafName(n: INodeView): string {
  const fromFm = n.frontmatter.name?.trim();
  if (fromFm) return fromFm;
  return pathBasenameForLink(n.path) || FILES_VIEW_TEXTS.missing;
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
