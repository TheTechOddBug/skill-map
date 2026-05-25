/**
 * Post-walk link transforms. Internal-only orchestration: a small
 * registry of polish passes that run over the merged link graph AFTER
 * extraction (Signal resolver + direct `ctx.emitLink`) and BEFORE
 * analyzers / link-count denormalisation.
 *
 * Why this exists: extractors run in isolation per node, so the merged
 * graph still needs cross-emit reconciliation (collapse identical
 * edges) and post-resolution polish (bump confidence once the full node
 * set is known). Each of those steps used to live as a stand-alone
 * function call in `runScanInternal`. With more transforms inbound (the
 * conversation in bd-owi already hinted at confidence bumps tied to
 * provider kinds), unifying them under a single shape keeps the
 * orchestrator linear and makes the transform sequence obvious at a
 * glance.
 *
 * **Scope boundary:** this is NOT the Signal IR resolver phase from
 * `spec/architecture.md` §Resolver phase. That phase materialises
 * `Signal[] → Link[]` (candidate winner selection); transforms here run
 * on the already-merged Link graph, after both Signal-resolved and
 * direct-emit links converge. Keeping the two surfaces separate
 * preserves the spec contract: `emitLink` direct path bypasses the
 * resolver, by design.
 *
 * **No plugin surface.** This module exports an internal type only.
 * Plugin authors get five extension kinds (extractor, analyzer, action,
 * hook, formatter) plus provider; post-walk transforms are kernel
 * internals.
 */

import { dedupeLinks } from './extractors.js';
import { liftResolvedLinkConfidence } from './lift-resolved-link-confidence.js';
import type { IProviderKind } from '../extensions/index.js';
import type { Link, Node } from '../types.js';

/**
 * Side context passed to every transform's `run`. Built once at the
 * scan entry point and shared across transforms so each one stays
 * narrow (links + nodes + context, no kernel handle).
 *
 * - `kindRegistry`: maps `<providerId>/<kindName>` to the kind's
 *   descriptor (with `identifiers`). Two Providers can declare the same
 *   kind name (e.g. both `claude` and `openai` ship `agent`), so the
 *   key includes the provider id to disambiguate.
 * - `providerResolution`: maps providerId → `resolution` map. The
 *   `liftResolvedLinkConfidence` transform reads
 *   `providerResolution[activeProvider][link.kind]` to decide
 *   which target kinds count as a valid resolution. The lookup keys
 *   on the active provider lens (see `activeProvider` below), not on
 *   the source node's provider id, so a `/handle` token authored in
 *   a `core/markdown` body still resolves under the active provider's
 *   runtime grammar (per `spec/architecture.md` §Provider · resolution
 *   rules).
 * - `activeProvider`: the lens governing this scan (mirrors
 *   `RunScanOptions.activeProvider`). The resolver consults
 *   `providerResolution.get(activeProvider)` for trigger-style links;
 *   when `null` (unlensed project), the name path short-circuits and
 *   only the path-match rule fires.
 */
export interface IPostWalkTransformCtx {
  readonly kindRegistry: ReadonlyMap<string, IProviderKind>;
  readonly providerResolution: ReadonlyMap<string, Readonly<Record<string, readonly string[]>>>;
  readonly activeProvider: string | null;
  /**
   * Paths of nodes whose normalised identifier(s) intersect the
   * Provider's `reservedNames[kind]` catalog. The set is computed once
   * per scan by the orchestrator (see `buildPostWalkTransformCtx`) and
   * read here by `liftResolvedLinkConfidence` so a link resolving to a
   * reserved target is downgraded to `RESERVED_TARGET_CONFIDENCE`
   * instead of bumped to 1.0. The `core/name-reserved` analyzer
   * consumes the same set through `IAnalyzerContext.reservedNodePaths`
   * to emit its warn issue.
   */
  readonly reservedNodePaths: ReadonlySet<string>;
}

/**
 * A single post-walk transform. `run` MAY mutate `links` in place or
 * return a fresh array; the runner uses the returned value when
 * present, the input array otherwise. `id` and `description` are for
 * tracing and future log lines (no behavioural use today).
 */
export interface IPostWalkTransform {
  readonly id: string;
  readonly description: string;
  run(links: Link[], nodes: readonly Node[], ctx: IPostWalkTransformCtx): Link[] | void;
}

/**
 * Sequence is significant:
 *
 *   1. `dedupe-links` first, so cross-extractor `sources[]` are
 *      unioned and confidence-max is settled BEFORE downstream
 *      transforms read final per-edge state.
 *   2. `lift-resolved-link-confidence` after dedup, so a `mentions` /
 *      `invokes` / `references` link produced by two extractors
 *      arrives here already merged; the bump runs once against the
 *      final edge.
 *
 * New transforms append to this list; the first two positions are
 * load-bearing for the analyzer pipeline downstream.
 */
export const POST_WALK_TRANSFORMS: readonly IPostWalkTransform[] = [
  {
    id: 'dedupe-links',
    description:
      'Collapse identical (source, target, kind, normalizedTrigger) edges across extractors; union sources[] and pick max confidence on merge.',
    run(links: Link[]): Link[] {
      return dedupeLinks(links);
    },
  },
  {
    id: 'lift-resolved-link-confidence',
    description:
      'Bump invocation links to confidence 1.0 when target / trigger resolves against the full node graph per the source Provider rules.',
    run(links: Link[], nodes: readonly Node[], ctx: IPostWalkTransformCtx): void {
      liftResolvedLinkConfidence(links, nodes, ctx);
    },
  },
];

/**
 * Run every transform in order and return the final link graph.
 * Threading through the return value (instead of mutating one shared
 * array) keeps transforms free to choose either style: `dedupeLinks`
 * builds a fresh array, `liftResolvedLinkConfidence` mutates in place.
 */
export function applyPostWalkTransforms(
  links: Link[],
  nodes: readonly Node[],
  ctx: IPostWalkTransformCtx,
  transforms: readonly IPostWalkTransform[] = POST_WALK_TRANSFORMS,
): Link[] {
  let current = links;
  for (const transform of transforms) {
    const next = transform.run(current, nodes, ctx);
    if (next) current = next;
  }
  return current;
}
