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
  formatModifiedAt,
  formatModifiedAtFull,
} from '../../../models/node-derived';
import { pathBasenameForLink } from '../../../services/path-basename';
import { STABILITY_SEVERITY, type TTagSeverity } from '../../components/severity-map';
import { FILES_VIEW_TEXTS } from '../../../i18n/files-view.texts';
import { NODE_CARD_TEXTS } from '../../../i18n/node-card.texts';
import type { INodeView, TStability } from '../../../models/node';
import type { IFolderNodeLite } from '../../../models/api';
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
  /** ISO short date (`2026-06-13`) for the Modified cell, or `·` when the
   *  node carries no file mtime (virtual / derived nodes). */
  readonly modifiedAt: string;
  /** Full date + time (`2026-06-13 14:32:47Z`) for the cell tooltip;
   *  empty string when there is no mtime. */
  readonly modifiedAtFull: string;
  /** Raw counts for the comparators; `undefined` mirrors a missing
   *  count (`·`) and always sorts to the bottom. */
  readonly linksInRaw: number | undefined;
  readonly linksOutRaw: number | undefined;
  readonly tokensRaw: number | undefined;
  /** Raw mtime (Unix ms) for the Modified comparator; `undefined` sinks
   *  fileless nodes to the bottom regardless of direction. */
  readonly modifiedAtRaw: number | undefined;
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
  /** Recursive sum of descendant error issue incidence (per-folder badge). */
  readonly errors: number;
  /** Recursive sum of descendant warn issue incidence (per-folder badge). */
  readonly warns: number;
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
  /** Recursive sum of descendant error issue incidence. */
  errors: number;
  /** Recursive sum of descendant warn issue incidence. */
  warns: number;
}

export interface IIssueMaps {
  readonly errorCounts: ReadonlyMap<string, number>;
  readonly warnCounts: ReadonlyMap<string, number>;
}

export interface IBuildRowsInput {
  readonly tree: ITreeFolder;
  readonly leaves: readonly INodeView[];
  readonly expanded: ReadonlySet<string>;
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

/**
 * Recursive per-folder aggregate: descendant leaf count plus the rolled-
 * up error / warn issue incidence (same shape as the leaf `nodeCount`
 * chip, extended with the severity badges). The per-path error / warn
 * counts come from `maps` (the lite folders list's `errorCount` /
 * `warnCount`); a folder's badge is the recursive sum across its
 * descendants.
 */
export function computeAggregates(
  tree: ITreeFolder,
  maps: IIssueMaps,
): ReadonlyMap<string, IAggregate> {
  const out = new Map<string, IAggregate>();
  const visit = (folder: ITreeFolder): IAggregate => {
    let nodes = folder.leaves.length;
    let errors = 0;
    let warns = 0;
    for (const leaf of folder.leaves) {
      errors += maps.errorCounts.get(leaf.path) ?? 0;
      warns += maps.warnCounts.get(leaf.path) ?? 0;
    }
    for (const sub of folder.subfolders.values()) {
      const childAgg = visit(sub);
      nodes += childAgg.nodes;
      errors += childAgg.errors;
      warns += childAgg.warns;
    }
    const agg: IAggregate = { nodes, errors, warns };
    out.set(folder.path, agg);
    return agg;
  };
  visit(tree);
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
  const modifiedRaw = node.modifiedAtMs;
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
    modifiedAt: modifiedRaw !== undefined ? formatModifiedAt(modifiedRaw) : FILES_VIEW_TEXTS.missing,
    modifiedAtFull: modifiedRaw !== undefined ? formatModifiedAtFull(modifiedRaw) : '',
    linksInRaw: node.linksInCount,
    linksOutRaw: node.linksOutCount,
    tokensRaw: node.tokensTotal,
    modifiedAtRaw: modifiedRaw,
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
  expanded: ReadonlySet<string>,
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

    const isExpanded = expanded.has(terminal.path);
    const agg = aggregates.get(terminal.path) ?? { nodes: 0, errors: 0, warns: 0 };
    rows.push({
      type: 'folder',
      path: terminal.path,
      name: chainName,
      depth,
      expanded: isExpanded,
      nodeCount: agg.nodes,
      errors: agg.errors,
      warns: agg.warns,
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
    return buildTreeRows(input.tree, input.expanded, input.aggregates, input.maps);
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
    case 'modified':
      return leaf.modifiedAtRaw;
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

/**
 * Build the per-path error / warn count maps from the whole-corpus lite
 * folders list (`IFolderNodeLite`), the canonical source for the tree's
 * per-folder severity badges. Each lite row already carries its own
 * `errorCount` / `warnCount` (issue incidence per node), so this is a
 * direct keying by path, no issue iteration.
 */
export function issueMapsFromLite(
  lite: readonly IFolderNodeLite[],
): IIssueMaps {
  const errorCounts = new Map<string, number>();
  const warnCounts = new Map<string, number>();
  for (const node of lite) {
    if (node.errorCount > 0) errorCounts.set(node.path, node.errorCount);
    if (node.warnCount > 0) warnCounts.set(node.path, node.warnCount);
  }
  return { errorCounts, warnCounts };
}
