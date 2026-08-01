/**
 * How raw `scan.links` entries resolve to drawn graph edges: the shared
 * primitives (`edgeId`, `edgeTargetPath`) plus the per-reason breakdown
 * (`analyzeLinks`) of why some links never become edges.
 *
 * Lives in the domain layer (not under `app/views/graph-view/`) because
 * the topbar consumes `analyzeLinks` for its links-vs-edges tooltip and
 * the shell must not depend on a feature view's internals; the graph
 * view's `resolveTopology` imports the same primitives so the drawn set
 * and the breakdown can never disagree.
 */

import type { INodeView } from '../models/node';
import type { ILinkApi, IScanResultApi } from '../models/api';

/**
 * Per-reason breakdown of why some raw `scan.links` entries do not
 * become drawn graph edges. Used by the topbar to reconcile the
 * "links found by the scan" count (`scan.links.length`) with the
 * "edges visible on the canvas" count (`graph.edges.length`).
 *
 *   raw          = `scan.links.length`
 *   drawn        = unique edges after resolution (same number Foblex
 *                  renders, assuming no kind / visibility filters).
 *   brokenSource = links whose `source` is not a loaded node (rare,
 *                  the kernel guarantees the source is a real node).
 *   brokenTarget = links whose kernel-resolved target
 *                  (`link.resolvedTarget`, else the raw `target`) is not
 *                  a loaded node. The kernel-side `core/reference-broken`
 *                  already flags these as issues, the graph just declines
 *                  to draw a dangling arrow.
 *   selfLoops    = links where `source === resolvedTarget`. Drawing
 *                  them would either congest the layout (a tiny loop
 *                  on top of the node) or render invisibly.
 *   duplicates   = extra emissions collapsed by the `(kind, source,
 *                  target)` dedupe. The MAX-confidence emission wins,
 *                  the others contribute nothing visual.
 */
export interface ILinkAnalysis {
  raw: number;
  drawn: number;
  brokenSource: number;
  brokenTarget: number;
  selfLoops: number;
  duplicates: number;
}

/**
 * The node path an edge lands on. Reads `link.resolvedTarget`, the
 * authoritative path the kernel's post-walk lift stamped (kind/lens-
 * aware, the same field the `LinkedNodesPanel` and the BFF incoming
 * list navigate by). Path-style links and unresolved triggers carry no
 * `resolvedTarget`, so fall back to the raw `link.target`, which the
 * caller's `validPaths` check then drops if it names no loaded node.
 *
 * The graph view no longer recomputes trigger resolution with its own
 * name index: resolution happens once in the kernel and rides along in
 * the API payload, so the drawn topology cannot drift from what the
 * kernel resolved.
 */
export function edgeTargetPath(link: ILinkApi): string {
  return link.resolvedTarget ?? link.target;
}

export function edgeId(prefix: string, from: string, to: string): string {
  // Direction matters, A→B and B→A are distinct edges so the graph
  // renders both arrows (entering from the top, leaving from the
  // bottom) when two nodes reference each other. Dedup still kicks in
  // when the SAME directed link appears twice (multi-extractor
  // collision), since the id is fully deterministic on (kind, from,
  // to).
  return `${prefix}:${from}::${to}`;
}

/**
 * Mirror of `resolveTopology`'s edge filtering, returning per-reason
 * counts instead of the edge set. Kept as a sibling helper so the
 * topbar can present the breakdown without recomputing the dedupe
 * map twice (the graph view's `resolveTopology` already pays the same
 * cost for its rendering pipeline, and Angular's `computed` memoises
 * both calls per `(nodes, scan)` pair).
 */
export function analyzeLinks(
  allNodes: INodeView[],
  scan: IScanResultApi | null,
): ILinkAnalysis {
  const links: ILinkApi[] = scan?.links ?? [];
  const validPaths = new Set(allNodes.map((n) => n.path));
  const seenEdgeIds = new Set<string>();
  let brokenSource = 0;
  let brokenTarget = 0;
  let selfLoops = 0;
  let duplicates = 0;
  let drawn = 0;
  for (const link of links) {
    if (!validPaths.has(link.source)) {
      brokenSource++;
      continue;
    }
    const resolvedTarget = edgeTargetPath(link);
    if (!validPaths.has(resolvedTarget)) {
      brokenTarget++;
      continue;
    }
    if (link.source === resolvedTarget) {
      selfLoops++;
      continue;
    }
    const id = edgeId(link.kind, link.source, resolvedTarget);
    if (seenEdgeIds.has(id)) {
      duplicates++;
      continue;
    }
    seenEdgeIds.add(id);
    drawn++;
  }
  return {
    raw: links.length,
    drawn,
    brokenSource,
    brokenTarget,
    selfLoops,
    duplicates,
  };
}
