/**
 * Pure row engine for `<sm-files-view>`. No Angular imports: the
 * component owns the signals and feeds resolved inputs here, so the
 * tree compaction, the flat-list sorting, and the comparators are a
 * unit-testable surface (the component itself has no spec). Mirrors the
 * graph-view "logic in a sibling module, component stays thin" pattern.
 *
 * Two render shapes, both producing `TFolderViewRow[]` so the template
 * body is identical:
 *   - TREE (`sort.column === 'tree'`): folder rows + leaves, with the
 *     VS Code single-child compaction.
 *   - FLAT (any data column): every leaf as a depth-0 row, no folders,
 *     sorted by the chosen column. The directory path rides in `prefix`
 *     so the existing dimmed `.files__name-prefix` span shows it.
 */

import {
  compactNumber,
  effectiveIsStale,
  effectiveStaleTooltip,
  effectiveStability,
} from '../../../models/node-derived';
import { pathBasenameForLink } from '../../../services/trigger-resolve';
import { STABILITY_SEVERITY, type TTagSeverity } from '../../components/severity-map';
import { FILES_VIEW_TEXTS } from '../../../i18n/files-view.texts';
import { NODE_CARD_TEXTS } from '../../../i18n/node-card.texts';
import type { INodeView, TStability } from '../../../models/node';
import type { IIssueApi, TIssueSeverityApi } from '../../../models/api';
import type { IFilesSort, TSortColumn, TSortDir } from './files-view.sort';

export interface IFolderLeaf {
  readonly type: 'leaf';
  readonly path: string;
  readonly name: string;
  /**
   * Dimmed folder context shown next to the name. In TREE mode it is
   * the folded single-child chain rendered BEFORE the name with a
   * trailing slash (`docs/guides/`intro.md). In FLAT mode it is the
   * file's directory path (no trailing slash) rendered AFTER the name
   * and truncated with an ellipsis, so the listing stays unambiguous
   * without folder rows. Empty for ordinary tree leaves and root files.
   */
  readonly prefix: string;
  readonly depth: number;
  readonly linksIn: string;
  readonly linksOut: string;
  readonly tokens: string;
  /** Raw counts for the comparators; `undefined` mirrors a missing
   *  count (`·`) and always sorts to the bottom. */
  readonly linksInRaw: number | undefined;
  readonly linksOutRaw: number | undefined;
  readonly tokensRaw: number | undefined;
  readonly errors: number;
  readonly warns: number;
  readonly isStale: boolean;
  readonly staleTooltip: string;
  readonly stability: TStability;
  readonly stabilitySeverity: TTagSeverity;
}

export interface IFolderRow {
  readonly type: 'folder';
  readonly path: string;
  readonly name: string;
  readonly depth: number;
  readonly expanded: boolean;
  readonly nodeCount: number;
}

export type TFolderViewRow = IFolderRow | IFolderLeaf;

export interface ITreeFolder {
  readonly path: string;
  readonly name: string;
  readonly subfolders: Map<string, ITreeFolder>;
  readonly leaves: INodeView[];
}

export interface IAggregate {
  nodes: number;
}

export interface IIssueMaps {
  readonly errorCounts: ReadonlyMap<string, number>;
  readonly warnCounts: ReadonlyMap<string, number>;
}

export interface IBuildRowsInput {
  readonly tree: ITreeFolder;
  readonly leaves: readonly INodeView[];
  readonly collapsed: ReadonlySet<string>;
  readonly aggregates: ReadonlyMap<string, IAggregate>;
  readonly maps: IIssueMaps;
  readonly sort: IFilesSort;
}

/** Build the folder tree from a flat node list (each node keyed by its path). */
export function buildTree(nodes: readonly INodeView[]): ITreeFolder {
  const root: ITreeFolder = { path: '', name: '', subfolders: new Map(), leaves: [] };
  for (const node of nodes) {
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
        child = { path: prefix.join('/'), name: seg, subfolders: new Map(), leaves: [] };
        cursor.subfolders.set(seg, child);
      }
      cursor = child;
    }
    cursor.leaves.push(node);
  }
  return root;
}

/** Recursive leaf-count per folder path (used for the folder count chip). */
export function computeAggregates(tree: ITreeFolder): ReadonlyMap<string, IAggregate> {
  const out = new Map<string, IAggregate>();
  const visit = (folder: ITreeFolder): IAggregate => {
    let nodes = folder.leaves.length;
    for (const sub of folder.subfolders.values()) nodes += visit(sub).nodes;
    const agg: IAggregate = { nodes };
    out.set(folder.path, agg);
    return agg;
  };
  visit(tree);
  return out;
}

/**
 * Resolve the `ITreeFolder` at a folder path (root has path ''). Traverses
 * by path segment, so it resolves a compacted folder row's terminal `.path`
 * just as well (the tree itself is never compacted, only its rendering).
 */
export function findFolder(root: ITreeFolder, folderPath: string): ITreeFolder | null {
  if (folderPath === '' || folderPath === root.path) return root;
  let cursor: ITreeFolder | undefined = root;
  for (const seg of folderPath.split('/')) {
    if (!seg) continue;
    cursor = cursor.subfolders.get(seg);
    if (!cursor) return null;
  }
  return cursor ?? null;
}

/** Every descendant leaf node path under a folder (recursive). */
export function collectLeafPaths(folder: ITreeFolder): string[] {
  const out: string[] = [];
  const visit = (f: ITreeFolder): void => {
    for (const leaf of f.leaves) out.push(leaf.path);
    for (const sub of f.subfolders.values()) visit(sub);
  };
  visit(folder);
  return out;
}

export function makeLeafRow(
  node: INodeView,
  depth: number,
  maps: IIssueMaps,
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
    linksOut:
      node.linksOutCount !== undefined ? String(node.linksOutCount) : FILES_VIEW_TEXTS.missing,
    tokens: node.tokensTotal !== undefined ? compactNumber(node.tokensTotal) : FILES_VIEW_TEXTS.missing,
    linksInRaw: node.linksInCount,
    linksOutRaw: node.linksOutCount,
    tokensRaw: node.tokensTotal,
    errors: maps.errorCounts.get(node.path) ?? 0,
    warns: maps.warnCounts.get(node.path) ?? 0,
    isStale,
    staleTooltip: isStale ? effectiveStaleTooltip(node, NODE_CARD_TEXTS.sidecar) : '',
    stability,
    stabilitySeverity: STABILITY_SEVERITY[stability],
  };
}

/**
 * TREE rows. Compacts single-child folder chains (VS Code "compact
 * folders"): while a folder holds exactly one subfolder and no files,
 * fold the child's name into the chain. When the chain bottoms out at a
 * folder with a single file and no subfolders, the file folds in too,
 * so a branch leading to a lone file is one line.
 */
export function buildTreeRows(
  tree: ITreeFolder,
  collapsed: ReadonlySet<string>,
  aggregates: ReadonlyMap<string, IAggregate>,
  maps: IIssueMaps,
): TFolderViewRow[] {
  const rows: TFolderViewRow[] = [];

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
      rows.push(makeLeafRow(terminal.leaves[0], depth, maps, `${chainName}/`));
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
    for (const leaf of leaves) rows.push(makeLeafRow(leaf, depth + 1, maps));
  };

  const rootSubs = Array.from(tree.subfolders.values()).sort(byName);
  for (const sub of rootSubs) emitFolder(sub, 0);
  const rootLeaves = [...tree.leaves].sort(byNodePath);
  for (const leaf of rootLeaves) rows.push(makeLeafRow(leaf, 0, maps));

  return rows;
}

/** FLAT rows: every leaf at depth 0, directory path in `prefix`, sorted. */
export function buildFlatRows(
  leaves: readonly INodeView[],
  sort: IFilesSort,
  maps: IIssueMaps,
): IFolderLeaf[] {
  const rows = leaves.map((node) => makeLeafRow(node, 0, maps, dirPrefix(node.path)));
  if (sort.column === 'tree') return rows; // defensive; flat path is never called with 'tree'
  rows.sort(leafComparator(sort.column, sort.dir));
  return rows;
}

export function buildRows(input: IBuildRowsInput): TFolderViewRow[] {
  if (input.sort.column === 'tree') {
    return buildTreeRows(input.tree, input.collapsed, input.aggregates, input.maps);
  }
  return buildFlatRows(input.leaves, input.sort, input.maps);
}

/**
 * Numeric weight for the Issues column: errors dominate, then warns,
 * then stale. The multipliers guarantee any error outranks any
 * realistic warn count and any warn outranks a stale flag, while
 * preserving intra-tier ordering (more errors first).
 */
export function issueWeight(leaf: Pick<IFolderLeaf, 'errors' | 'warns' | 'isStale'>): number {
  return leaf.errors * 1_000_000 + leaf.warns * 1_000 + (leaf.isStale ? 1 : 0);
}

/**
 * Comparator for a data column. Missing numeric values (`undefined`)
 * always sink to the bottom regardless of direction (a `·` is "no
 * data", not zero). Ties break on `path.localeCompare` so the output
 * is deterministic and stable across re-renders.
 */
export function leafComparator(
  column: Exclude<TSortColumn, 'tree'>,
  dir: TSortDir,
): (a: IFolderLeaf, b: IFolderLeaf) => number {
  const sign = dir === 'asc' ? 1 : -1;
  return (a, b) => {
    const va = sortValue(a, column);
    const vb = sortValue(b, column);
    if (va === undefined && vb === undefined) return a.path.localeCompare(b.path);
    if (va === undefined) return 1; // a to the bottom
    if (vb === undefined) return -1; // b to the bottom
    if (va !== vb) return (va - vb) * sign;
    return a.path.localeCompare(b.path);
  };
}

function sortValue(leaf: IFolderLeaf, column: Exclude<TSortColumn, 'tree'>): number | undefined {
  switch (column) {
    case 'linksIn':
      return leaf.linksInRaw;
    case 'linksOut':
      return leaf.linksOutRaw;
    case 'tokens':
      return leaf.tokensRaw;
    case 'issues':
      return issueWeight(leaf);
  }
}

/**
 * Directory portion of a path (no trailing slash), or '' at root. In
 * FLAT mode it renders dimmed AFTER the file name and truncates with an
 * ellipsis, so the slash separator is not wanted at the end.
 */
function dirPrefix(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx);
}

export function leafName(n: INodeView): string {
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

export function countIssuesByPath(
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
