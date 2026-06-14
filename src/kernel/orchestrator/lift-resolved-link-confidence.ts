/**
 * Post-resolution confidence transform for links whose normalized
 * trigger or target resolves against a known node in the merged graph.
 * Sits as a post-walk transform (see `post-walk-transforms.ts`), runs
 * AFTER `dedupeLinks` so the merged edge state is final.
 *
 * Five outcomes per link below confidence 1.0:
 *
 *   - **Genuinely broken**: target matches no node path AND the
 *     stripped trigger matches no entry in the cross-kind name index
 *     (the same kind-agnostic notion `core/reference-broken` uses).
 *     Confidence is lowered to `BROKEN_TARGET_CONFIDENCE` (capped, only
 *     lowered) so a dangling edge renders fainter than a resolved one.
 *     The `core/reference-broken` analyzer still flags the link as an
 *     issue separately; this is the matching visual signal.
 *
 *   - **Not broken, not bumped**: the strict kind/lens rule below did
 *     not bump the link, but its trigger DOES match a name in the
 *     index (it resolves to a real node, just not as a valid target
 *     for this `link.kind`). Confidence stays at the extractor-emitted
 *     value, the edge is not broken, so it is not demoted.
 *
 *   - **Resolved to a non-reserved target**: confidence is bumped to
 *     `1.0`. The graph reflects "this edge points at a real entity the
 *     runtime can act on".
 *
 *   - **Resolved to a VIRTUAL target** (the target node carries
 *     `virtual: true`, e.g. an `mcp://` server node fabricated from
 *     frontmatter, never verified on disk): `resolvedTarget` is set so
 *     the edge stays navigable, but confidence stays at the extractor
 *     emit value, an unverified entity is not full certainty.
 *
 *   - **Resolved to a RESERVED target** (target node's name normalises
 *     to an entry in its Provider's `reservedNames[kind]` list): the
 *     edge is downgraded to `RESERVED_TARGET_CONFIDENCE` (today
 *     `0.1`). The file exists on disk but the runtime ignores it in
 *     favour of the built-in with the same name; the graph reflects
 *     "the edge resolves to something the runtime will NOT execute".
 *     The `core/name-reserved` analyzer emits the matching warn issue
 *     on the target node so the operator sees both signals.
 *
 * Two resolution rules feed the outcome above:
 *
 *   1. **Path match**: `link.target` equals a node's `path`. Applies
 *      to any link.kind.
 *   2. **Name match**: stripped `trigger.normalizedTrigger` matches a
 *      node identifier (per `IProviderKind.identifiers`), AND the
 *      candidate node's kind is in the ACTIVE PROVIDER LENS's
 *      `resolution[link.kind]` list (per `spec/architecture.md`
 *      §Provider · resolution rules). The lookup keys on the lens
 *      (not on the source node's provider) so trigger-style links
 *      emitted by lens-gated extractors on universal-provider bodies
 *      (e.g. `/handle` in `notes/todo.md` under `claude`) resolve
 *      under the same authority that authorised the emission.
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
 * Confidence assigned to a genuinely-broken link (target resolves to
 * nothing: no node path, no name-index entry). Sits ABOVE
 * `RESERVED_TARGET_CONFIDENCE = 0.1` on purpose: a reserved target
 * resolves to a real-but-runtime-ignored file (the subtler trap, flagged
 * most faintly), whereas a broken target merely points at nothing.
 * Below the typical 0.8 / 0.85 / 0.95 emit floors so the dangling edge
 * is visibly demoted, while staying well above reserved.
 */
export const BROKEN_TARGET_CONFIDENCE = 0.5;

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
    if (link.confidence < 1) applyResolution(link, indexes, ctx);
  }
}

/**
 * Set of genuinely-broken links: those whose target resolves to no node
 * at all (no `path` match, and the stripped `trigger.normalizedTrigger`
 * matches no entry in the cross-kind name index). This is the kind-
 * AGNOSTIC "the name exists nowhere" notion the spec pins for both the
 * broken-confidence downgrade above and `core/reference-broken`
 * (`spec/architecture.md` §Provider · resolution rules): the rule
 * projects this verdict instead of re-deriving a narrower index. Built
 * from the same `deriveNodeIdentifiers`-backed `byName` the lift uses,
 * so a `@filed-agent` / `/nameless-skill` that resolves only via the
 * filename / dirname identifier is NOT broken, matching what the lift
 * resolved and the graph drew.
 *
 * Checks EVERY link regardless of confidence: annotation-derived links
 * emit at `1.0` yet can still dangle, and `liftResolvedLinkConfidence`
 * skips already-confident links. Membership is by object identity; the
 * orchestrator threads the SAME link objects on to the analyzer phase,
 * so `ctx.brokenLinks.has(link)` is exact.
 */
export function collectBrokenLinks(
  links: readonly Link[],
  nodes: readonly Node[],
  ctx: IPostWalkTransformCtx,
): Set<Link> {
  const broken = new Set<Link>();
  if (links.length === 0) return broken;
  const indexes = buildIndexes(nodes, ctx);
  for (const link of links) {
    if (isGenuinelyBroken(link, indexes)) broken.add(link);
  }
  return broken;
}

/**
 * Per-link confidence decision against the resolved graph, mutating the
 * link in place. Split out of `liftResolvedLinkConfidence` to keep that
 * function's branch count under the lint complexity cap; the five
 * outcomes are documented on the exported function above.
 */
function applyResolution(link: Link, indexes: IIndexes, ctx: IPostWalkTransformCtx): void {
  const resolution = resolve(link, indexes, ctx);
  if (resolution === 'none') {
    // Strict resolution failed. Demote to the broken floor ONLY when the
    // link is genuinely broken (no path, no name match), mirroring
    // core/reference-broken. A name match that failed the strict kind/lens
    // bump (not-broken + not-bumped) keeps its emit.
    if (isGenuinelyBroken(link, indexes)) {
      link.confidence = Math.min(link.confidence, BROKEN_TARGET_CONFIDENCE);
    }
    return;
  }
  // The edge resolves to a real graph node. Record the resolved path so
  // consumers (BFF incoming query, rename tooling, the UI's incoming list)
  // can navigate by node identity even when `link.target` keeps a trigger
  // string like `@foo` / `/deploy`. Set unconditionally, regardless of the
  // confidence outcome below.
  link.resolvedTarget = resolution;
  // Virtual target (e.g. an `mcp://<server>` node fabricated from
  // frontmatter, never verified on disk): the edge resolves and stays
  // navigable, but an unverified entity is not full certainty, so the link
  // keeps its extractor emit value instead of bumping to 1.0. Mirrors the
  // reserved-target downgrade.
  if (indexes.nodeByPath.get(resolution)?.virtual) return;
  link.confidence = ctx.reservedNodePaths.has(resolution)
    ? RESERVED_TARGET_CONFIDENCE
    : 1.0;
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

/**
 * A link is genuinely broken when its target resolves to nothing: no
 * node path matches `link.target` AND the stripped trigger handle
 * matches no entry in the cross-kind name index. This is the same
 * kind-agnostic "the name exists nowhere" notion `core/reference-broken`
 * uses, deliberately broader than the strict kind/lens rule in
 * `resolve`: a link that matches a name but fails the kind matrix
 * (not-broken + not-bumped) is NOT broken and keeps its emit value.
 * Only called on the `resolution === 'none'` path, so `byPath` is
 * already known to miss; the name check is what discriminates broken
 * from not-broken-not-bumped.
 */
function isGenuinelyBroken(link: Link, indexes: IIndexes): boolean {
  if (indexes.byPath.has(link.target)) return false;
  const stripped = stripTriggerSigil(link.trigger?.normalizedTrigger);
  if (stripped !== null && indexes.byName.has(stripped)) return false;
  return true;
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
  _indexes: IIndexes,
  ctx: IPostWalkTransformCtx,
): readonly string[] | undefined {
  // Per `spec/architecture.md` §Provider · resolution rules, the
  // resolver authority mirrors the extractor authority (the active
  // provider lens). The source node's provider is intentionally NOT
  // consulted: a lens-gated extractor (e.g. `claude/slash-command`
  // under the `claude` lens) emits links from universal-provider
  // bodies (`notes/todo.md` classified by `core/markdown`); resolving
  // by the source's provider would short-circuit those emissions to
  // `confidence: 0.8` forever and leave `linksInCount` at 0 on the
  // target. An unlensed project (`activeProvider === null`)
  // short-circuits the name path uniformly.
  if (ctx.activeProvider === null) return undefined;
  return ctx.providerResolution.get(ctx.activeProvider)?.[link.kind];
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
