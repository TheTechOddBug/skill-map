/**
 * Combination algebra for plugin-contributed link-confidence adjustments.
 *
 * Confidence ([0,1]) starts at the extractor-emitted base. `score`-phase
 * analyzers then contribute attributed operations via
 * `ctx.adjustConfidence(link, op)`; the orchestrator buffers them and
 * folds all ops for a link into a final value with `foldConfidence`.
 * The kernel's own resolution rules dogfood this exact API through the
 * built-in `core/score-resolution` scorer (resolved → `set 1.0`,
 * reserved → `set 0.1`, broken → `ceil 0.5`).
 *
 * The fold is deterministic and order-independent across the four
 * buckets (set / delta / floor / ceil are each commutative):
 *   1. base = the extractor-emitted confidence.
 *   2. `set`: a hard override. When more than one `set` lands on a link
 *      the LAST in the caller's canonical order wins (the caller pre-
 *      sorts ops by `(pluginId, extensionId)` so the winner is stable);
 *      a single `set` simply replaces the base.
 *   3. `delta`: additive (may be negative), summed.
 *   4. `floor`: raise to at least the value (`max`).
 *   5. `ceil`: lower to at most the value (`min`) — today's broken cap.
 *      Applied AFTER floor so a cap dominates a floor/ceil collision.
 *   6. clamp to [0,1] ONCE at the end, so opposing deltas round-trip
 *      (e.g. `-0.4` then `+0.4` returns to base, never clipped midway).
 *
 * A link no scorer touches folds to `clamp(base)`, identical to an
 * un-scored link. With only the built-in scorer active (which emits at
 * most one mutually-exclusive op per link), the fold reduces to the old
 * single assignment, so the migration is behaviour-identical.
 */

import type { Link, TConfidenceOp } from '../types.js';

export type { TConfidenceOp };

/**
 * One attributed adjustment, buffered by the orchestrator as a scorer
 * calls `adjustConfidence`. `link` is held by object identity (the same
 * link objects flow through the post-walk pipeline). Persisted to
 * `scan_link_scores` for the "why is this link at X?" audit trail.
 */
export interface IConfidenceAdjustment {
  readonly link: Link;
  readonly pluginId: string;
  readonly extensionId: string;
  readonly op: TConfidenceOp;
}

/**
 * Fold a base confidence and its ops (in caller's canonical order) into
 * a final value clamped to [0,1]. See the module doc for the algebra.
 *
 * Inherently a multi-accumulator fold: one ordered pass per op bucket
 * (set / delta / floor / ceil) is the clearest expression of the
 * documented algebra; splitting the four passes into helpers would hide
 * the order dependence the module doc pins. Hence the complexity disable.
 */
// eslint-disable-next-line complexity
export function foldConfidence(base: number, ops: readonly TConfidenceOp[]): number {
  let running = base;
  // `set`: last in canonical order wins; replaces the running value.
  for (const op of ops) {
    if (op.kind === 'set') running = op.value;
  }
  // `delta`: additive sum.
  for (const op of ops) {
    if (op.kind === 'delta') running += op.value;
  }
  // `floor` (raise) then `ceil` (cap), so a ceil dominates.
  for (const op of ops) {
    if (op.kind === 'floor') running = Math.max(running, op.value);
  }
  for (const op of ops) {
    if (op.kind === 'ceil') running = Math.min(running, op.value);
  }
  return clamp01(running);
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Fold every buffered adjustment into its link's `confidence`, IN PLACE.
 * Groups by link object identity, sorts each link's ops canonically by
 * `(pluginId, extensionId)` (so the `set` winner and the float sum are
 * reproducible across runs), folds via `foldConfidence`, and writes the
 * clamped result back to `link.confidence`. No-op when empty.
 */
export function applyConfidenceAdjustments(adjustments: readonly IConfidenceAdjustment[]): void {
  if (adjustments.length === 0) return;
  const byLink = new Map<Link, IConfidenceAdjustment[]>();
  for (const adj of adjustments) {
    const bucket = byLink.get(adj.link);
    if (bucket) bucket.push(adj);
    else byLink.set(adj.link, [adj]);
  }
  for (const [link, adjs] of byLink) {
    const ops = [...adjs].sort(compareAdjustments).map((a) => a.op);
    link.confidence = foldConfidence(link.confidence, ops);
  }
}

function compareAdjustments(a: IConfidenceAdjustment, b: IConfidenceAdjustment): number {
  if (a.pluginId !== b.pluginId) return a.pluginId < b.pluginId ? -1 : 1;
  if (a.extensionId !== b.extensionId) return a.extensionId < b.extensionId ? -1 : 1;
  return 0;
}
