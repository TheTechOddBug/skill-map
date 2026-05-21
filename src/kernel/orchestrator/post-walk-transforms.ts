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
import { liftMentionConfidence } from './lift-mention-confidence.js';
import type { Link, Node } from '../types.js';

/**
 * A single post-walk transform. `run` MAY mutate `links` in place or
 * return a fresh array; the runner uses the returned value when
 * present, the input array otherwise. `id` and `description` are for
 * tracing and future log lines (no behavioural use today).
 */
export interface IPostWalkTransform {
  readonly id: string;
  readonly description: string;
  run(links: Link[], nodes: readonly Node[]): Link[] | void;
}

/**
 * Sequence is significant:
 *
 *   1. `dedupe-links` first, so cross-extractor `sources[]` are
 *      unioned and confidence-max is settled BEFORE downstream
 *      transforms read final per-edge state.
 *   2. `lift-mention-confidence` after dedup, so a `mentions` link
 *      produced by two extractors arrives here already merged; the
 *      bump runs once against the final edge.
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
    id: 'lift-mention-confidence',
    description:
      'Bump resolved `mentions` links to confidence 1.0 once the full node graph is known (post-merge polish).',
    run(links: Link[], nodes: readonly Node[]): void {
      liftMentionConfidence(links, nodes);
    },
  },
];

/**
 * Run every transform in order and return the final link graph.
 * Threading through the return value (instead of mutating one shared
 * array) keeps transforms free to choose either style: `dedupeLinks`
 * builds a fresh array, `liftMentionConfidence` mutates in place.
 */
export function applyPostWalkTransforms(
  links: Link[],
  nodes: readonly Node[],
  transforms: readonly IPostWalkTransform[] = POST_WALK_TRANSFORMS,
): Link[] {
  let current = links;
  for (const transform of transforms) {
    const next = transform.run(current, nodes);
    if (next) current = next;
  }
  return current;
}
