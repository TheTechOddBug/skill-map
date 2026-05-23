/**
 * Post-resolution confidence transform for links whose normalized
 * trigger or target resolves against a known node in the merged graph.
 * Sits as a post-walk transform (see `post-walk-transforms.ts`), runs
 * AFTER `dedupeLinks` so the merged edge state is final.
 *
 * Three outcomes per link below confidence 1.0:
 *
 *   - **Unresolved**: target neither matches a node path nor a name in
 *     the index (with the source Provider's `resolution` matrix
 *     applied). Confidence stays at the extractor-emitted value (the
 *     `core/broken-ref` analyzer flags the link separately).
 *
 *   - **Resolved to a non-reserved target**: confidence is bumped to
 *     `1.0`. The graph reflects "this edge points at a real entity the
 *     runtime can act on".
 *
 *   - **Resolved to a RESERVED target** (target node's name normalises
 *     to an entry in its Provider's `reservedNames[kind]` list): the
 *     edge is downgraded to `RESERVED_TARGET_CONFIDENCE` (today
 *     `0.1`). The file exists on disk but the runtime ignores it in
 *     favour of the built-in with the same name; the graph reflects
 *     "the edge resolves to something the runtime will NOT execute".
 *     The `core/reserved-name` analyzer emits the matching warn issue
 *     on the target node so the operator sees both signals.
 *
 * Two resolution rules feed the outcome above:
 *
 *   1. **Path match**: `link.target` equals a node's `path`. Applies
 *      to any link.kind.
 *   2. **Name match**: stripped `trigger.normalizedTrigger` matches a
 *      node identifier (per `IProviderKind.identifiers`), AND the
 *      candidate node's kind is in the source Provider's
 *      `resolution[link.kind]` list.
 *
 * Mutates `links` in place to align with `dedupeLinks` style; the
 * orchestrator passes the same array on to the analyzer phase.
 */

import { deriveNodeIdentifiers } from './node-identifiers.js';
import type { Link, Node } from '../types.js';
import type { IPostWalkTransformCtx } from './post-walk-transforms.js';

/**
 * Floor confidence value assigned to a link whose target is reserved
 * by its Provider runtime. Chosen low enough to be visually obvious in
 * the UI (well below the typical 0.5 / 0.8 emit floors) while staying
 * non-zero so the edge keeps rendering, downgraded but visible.
 */
export const RESERVED_TARGET_CONFIDENCE = 0.1;

/**
 * Per-candidate row stored in the name index. Carries the kind for the
 * strict-kind filter and the candidate's path so the resolved-target
 * "is this reserved?" lookup runs in O(1).
 */
interface INameIndexEntry {
  readonly kind: string;
  readonly path: string;
}

/**
 * Apply the resolved-confidence transform to every link below 1.0
 * in place. No-op when every link is already at >= 1.0.
 */
export function liftResolvedLinkConfidence(
  links: Link[],
  nodes: readonly Node[],
  ctx: IPostWalkTransformCtx,
): void {
  if (!links.some((l) => l.confidence < 1)) return;
  const indexes = buildIndexes(nodes, ctx);
  for (const link of links) {
    if (link.confidence >= 1) continue;
    const resolution = resolve(link, indexes, ctx);
    if (resolution === 'none') continue;
    link.confidence = ctx.reservedNodePaths.has(resolution)
      ? RESERVED_TARGET_CONFIDENCE
      : 1.0;
    // Record the resolved node path so consumers reading the link
    // (BFF incoming query, rename / refactor tooling, the UI's
    // incoming list) can navigate by node identity even when
    // `link.target` keeps a trigger-style string like `@foo` or
    // `/deploy`. Path-style links also write this (it equals
    // `link.target`); keeping the field set unconditionally simplifies
    // the query layer (single column to filter on).
    link.resolvedTarget = resolution;
  }
}

interface IIndexes {
  readonly byPath: ReadonlySet<string>;
  readonly byName: ReadonlyMap<string, INameIndexEntry[]>;
  readonly nodeByPath: ReadonlyMap<string, Node>;
}

function buildIndexes(nodes: readonly Node[], ctx: IPostWalkTransformCtx): IIndexes {
  const byPath = new Set<string>();
  const byName = new Map<string, INameIndexEntry[]>();
  const nodeByPath = new Map<string, Node>();
  for (const node of nodes) {
    byPath.add(node.path);
    nodeByPath.set(node.path, node);
    indexNode(node, ctx, byName);
  }
  return { byPath, byName, nodeByPath };
}

/**
 * Per-link decision: return the resolved target node's `path` (so the
 * caller can consult `reservedNodePaths`), or `'none'` when neither
 * rule fires. Path match runs first; name match goes through the
 * source Provider's `resolution[link.kind]` matrix.
 */
function resolve(link: Link, indexes: IIndexes, ctx: IPostWalkTransformCtx): string | 'none' {
  if (indexes.byPath.has(link.target)) return link.target;
  return resolveByName(link, indexes, ctx);
}

function resolveByName(
  link: Link,
  indexes: IIndexes,
  ctx: IPostWalkTransformCtx,
): string | 'none' {
  const stripped = stripTriggerSigil(link.trigger?.normalizedTrigger);
  if (stripped === null) return 'none';
  const candidates = indexes.byName.get(stripped);
  if (!candidates?.length) return 'none';
  const allowedKinds = lookupAllowedKinds(link, indexes, ctx);
  if (!allowedKinds?.length) return 'none';
  const winner = candidates.find((c) => allowedKinds.includes(c.kind));
  return winner ? winner.path : 'none';
}

function lookupAllowedKinds(
  link: Link,
  indexes: IIndexes,
  ctx: IPostWalkTransformCtx,
): readonly string[] | undefined {
  const sourceNode = indexes.nodeByPath.get(link.source);
  if (!sourceNode) return undefined;
  return ctx.providerResolution.get(sourceNode.provider)?.[link.kind];
}

/**
 * Strip the leading `@` or `/` sigil from a normalized trigger so the
 * remaining handle aligns with the name index entries (which are
 * stored sigil-free). Returns `null` when the trigger is empty / absent
 * so the caller can short-circuit.
 */
function stripTriggerSigil(normalized: string | undefined): string | null {
  if (!normalized) return null;
  const trimmed = normalized.replace(/^[/@]/, '').trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Index this node's identifiers (per its kind's declared `identifiers`
 * sources) into `byName`. Multiple sources contribute multiple bucket
 * entries (each carrying the kind for the strict-kind filter and the
 * path for the reserved-target lookup).
 */
function indexNode(
  node: Node,
  ctx: IPostWalkTransformCtx,
  byName: Map<string, INameIndexEntry[]>,
): void {
  const kindDescriptor = ctx.kindRegistry.get(kindKey(node));
  const normalised = deriveNodeIdentifiers(node, kindDescriptor);
  for (const name of normalised) {
    const entry: INameIndexEntry = { kind: node.kind, path: node.path };
    const bucket = byName.get(name);
    if (bucket) {
      bucket.push(entry);
    } else {
      byName.set(name, [entry]);
    }
  }
}

/**
 * The kind registry built by the orchestrator keys entries by the
 * `<providerId>/<kindName>` tuple so two Providers can declare the
 * same kind name (e.g. both `claude` and `openai` ship `agent`)
 * without collision. This helper mirrors the key shape on the lookup
 * side.
 */
function kindKey(node: Node): string {
  return `${node.provider}/${node.kind}`;
}
