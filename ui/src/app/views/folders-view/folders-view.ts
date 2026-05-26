import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TagModule } from 'primeng/tag';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { MessageModule } from 'primeng/message';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';

import { FOLDERS_VIEW_TEXTS } from '../../../i18n/folders-view.texts';
import { NODE_CARD_TEXTS } from '../../../i18n/node-card.texts';
import { CollectionLoaderService } from '../../../services/collection-loader';
import { FilterStoreService } from '../../../services/filter-store';
import { IssuePathsService } from '../../../services/issue-paths';
import { KindRegistryService } from '../../../services/kind-registry';
import { FilterBar } from '../../components/filter-bar/filter-bar';
import { STABILITY_SEVERITY, type TTagSeverity } from '../../components/severity-map';
import {
  effectiveIsStale,
  effectiveStaleTooltip,
  effectiveStability,
} from '../../../models/node-derived';
import { pathBasenameForLink } from '../../../services/trigger-resolve';
import type {
  TNodeKind,
  INodeView,
  TStability,
} from '../../../models/node';
import type { IIssueApi, TIssueSeverityApi } from '../../../models/api';

interface IFolderLeaf {
  readonly type: 'leaf';
  readonly path: string;
  readonly name: string;
  readonly depth: number;
  readonly kind: TNodeKind;
  readonly kindLabel: string;
  readonly kindStyle: Readonly<Record<string, string>>;
  readonly errors: number;
  readonly warns: number;
  readonly isStale: boolean;
  readonly staleTooltip: string;
  readonly stability: TStability;
  readonly stabilitySeverity: TTagSeverity;
}

interface IFolderRow {
  readonly type: 'folder';
  /** Full folder path including trailing segment, used as expand-state key. */
  readonly path: string;
  /** Last segment of the folder path (e.g. `guides` for `docs/guides`). */
  readonly name: string;
  readonly depth: number;
  readonly expanded: boolean;
  /** Total leaves in the subtree (recursive). */
  readonly nodeCount: number;
  /** Aggregate error / warn counts across the subtree. */
  readonly errors: number;
  readonly warns: number;
}

type TFolderViewRow = IFolderRow | IFolderLeaf;

/**
 * Internal tree node used during the build pass. The `children` map keys
 * are the next path segment for a folder, and an array of node leaves.
 * Folders sort alphabetically before leaves at render time.
 */
interface ITreeFolder {
  /** Full path including any leading segments. Empty string for root. */
  readonly path: string;
  readonly name: string;
  readonly subfolders: Map<string, ITreeFolder>;
  readonly leaves: INodeView[];
}

@Component({
  selector: 'sm-folders-view',
  imports: [
    FilterBar,
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
  private readonly kindRegistry = inject(KindRegistryService);

  protected readonly texts = FOLDERS_VIEW_TEXTS;

  readonly loading = this.loader.loading;
  readonly error = this.loader.error;
  readonly total = this.loader.count;
  readonly filtersActive = this.filters.isActive;

  /**
   * Expand state for folders, keyed by the folder's full path. A folder
   * is expanded iff its key is present in the set. Default is "all
   * collapsed", except the root level is implicitly expanded (root
   * folders always render as the top of the tree).
   */
  private readonly expanded = signal<ReadonlySet<string>>(new Set());

  /**
   * Filtered node list, mirrors list-view. Built once per render so the
   * tree-build pass and the visibility pass share the same projection.
   */
  private readonly filteredNodes = computed<readonly INodeView[]>(() => {
    const severity = this.issuePaths.bySeverity();
    return this.filters.apply(this.loader.nodes(), severity);
  });

  /**
   * Tree projection: builds an ITreeFolder root from the filtered node
   * list by splitting `node.path` on `/` and walking the segments.
   * Folders are created lazily as paths require them. The root folder
   * has `path === ''` and is not rendered itself, only its children
   * (top-level folders and root-level leaves).
   */
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
        const key = seg;
        let child = cursor.subfolders.get(key);
        if (!child) {
          child = {
            path: prefix.join('/'),
            name: seg,
            subfolders: new Map(),
            leaves: [],
          };
          cursor.subfolders.set(key, child);
        }
        cursor = child;
      }
      cursor.leaves.push(node);
    }
    return root;
  });

  /**
   * Aggregate counts per folder path, computed once from the tree.
   * Used to render the chip next to each folder name. Issues are summed
   * across every leaf in the subtree, so a parent folder reflects the
   * total severity weight beneath it (matches VSCode's per-folder
   * problem indicators in the file explorer).
   */
  private readonly aggregates = computed<ReadonlyMap<string, { nodes: number; errors: number; warns: number }>>(() => {
    const errorCounts = countIssuesByPath(this.loader.scan()?.issues, 'error');
    const warnCounts = countIssuesByPath(this.loader.scan()?.issues, 'warn');
    const out = new Map<string, { nodes: number; errors: number; warns: number }>();
    const visit = (folder: ITreeFolder): { nodes: number; errors: number; warns: number } => {
      let nodes = 0;
      let errors = 0;
      let warns = 0;
      for (const leaf of folder.leaves) {
        nodes += 1;
        errors += errorCounts.get(leaf.path) ?? 0;
        warns += warnCounts.get(leaf.path) ?? 0;
      }
      for (const sub of folder.subfolders.values()) {
        const inner = visit(sub);
        nodes += inner.nodes;
        errors += inner.errors;
        warns += inner.warns;
      }
      out.set(folder.path, { nodes, errors, warns });
      return { nodes, errors, warns };
    };
    visit(this.tree());
    return out;
  });

  /**
   * Flattened, depth-aware row list for rendering. DFS walk of the
   * tree, emits a folder row for every folder (top-level folders always
   * visible, deeper folders emitted only when their parent is
   * expanded), followed by leaf rows for files in the current folder
   * when that folder is expanded. Folders sort alphabetically before
   * leaves at every level.
   */
  readonly rows = computed<TFolderViewRow[]>(() => {
    const tree = this.tree();
    const expanded = this.expanded();
    const aggregates = this.aggregates();
    const errorCounts = countIssuesByPath(this.loader.scan()?.issues, 'error');
    const warnCounts = countIssuesByPath(this.loader.scan()?.issues, 'warn');
    const rows: TFolderViewRow[] = [];

    const emitFolder = (folder: ITreeFolder, depth: number): void => {
      const isExpanded = expanded.has(folder.path);
      const agg = aggregates.get(folder.path) ?? { nodes: 0, errors: 0, warns: 0 };
      rows.push({
        type: 'folder',
        path: folder.path,
        name: folder.name,
        depth,
        expanded: isExpanded,
        nodeCount: agg.nodes,
        errors: agg.errors,
        warns: agg.warns,
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

  openLeaf(row: IFolderLeaf): void {
    void this.router.navigate(['/graph'], { queryParams: { path: row.path } });
  }

  resetFilters(): void {
    this.filters.reset();
  }

  private makeLeafRow(
    node: INodeView,
    depth: number,
    errorCounts: ReadonlyMap<string, number>,
    warnCounts: ReadonlyMap<string, number>,
  ): IFolderLeaf {
    const stability = rowStability(node);
    const isStale = effectiveIsStale(node);
    return {
      type: 'leaf',
      path: node.path,
      name: leafName(node),
      depth,
      kind: node.kind,
      kindLabel: this.kindRegistry.labelOf(node.kind),
      kindStyle: kindStyleFor(node.kind),
      errors: errorCounts.get(node.path) ?? 0,
      warns: warnCounts.get(node.path) ?? 0,
      isStale,
      staleTooltip: isStale ? effectiveStaleTooltip(node, NODE_CARD_TEXTS.sidecar) : '',
      stability,
      stabilitySeverity: STABILITY_SEVERITY[stability],
    };
  }
}

/**
 * Display name for a leaf, mirrors `list-view.rowName`: prefer the
 * frontmatter `name` when present, otherwise derive a friendly basename
 * via `pathBasenameForLink` (honours `<dir>/<name>/SKILL.md`).
 */
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

function kindStyleFor(kind: TNodeKind): Readonly<Record<string, string>> {
  return {
    background: `var(--sm-kind-${kind}-bg)`,
    color: `var(--sm-kind-${kind}-fg)`,
  };
}

/**
 * Per-node issue count keyed by `node.path`. Duplicated from list-view
 * intentionally, the function is small and the two views project the
 * same shape; promoting it to a shared util would create a single-call
 * dependency that adds indirection without payoff today.
 */
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
