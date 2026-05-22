/**
 * Signal IR resolver phase. Phase 2 scaffold of the active-lens
 * migration. Consumes the `Signal[]` produced by extractors that opted
 * into `ctx.emitSignal()` and materialises a winning candidate per
 * Signal as a `Link`, identical in shape to a Link emitted via
 * `ctx.emitLink()` directly. The two emission paths converge here so
 * downstream code (persistence, analyzers, UI) sees a single source of
 * truth.
 *
 * **Scaffold scope** (this revision):
 *
 *   - Pure function over `Signal[] → Link[]`. No provider lookup, no
 *     `resolverRules`, no per-extractor priority. The first candidate
 *     of each Signal wins; ties are broken by `extractorId` declaration
 *     order (i.e. array order).
 *   - The kernel orchestrator does NOT yet feed Signals into this
 *     function; the buffer at `runExtractorsForNode` returns Signals
 *     unconsumed so callers (and analyzers via
 *     `IAnalyzerContext.signals`) can prototype against the IR.
 *
 * **Pending** (Phase 3+ of the migration):
 *
 *   - `IProvider.resolverRules`: rank candidates by `kind` priority
 *     (e.g. Antigravity's `agent > MCP > file`), tie-break by confidence
 *     descending, then by `range.end - range.start` descending
 *     (longest-match), then by `extractorId` registration order.
 *   - Per-extension enable check via
 *     `plugins.<id>.extensions.<extId>.enabled` overrides.
 *   - Confidence floor: drop the Signal entirely (emit no Link) when no
 *     candidate clears the threshold.
 *   - Per-candidate "drop below confidence floor" filter (a
 *     Phase 4+ analyzer setting). Today every surviving candidate
 *     materialises; the floor lands together with provider
 *     `resolverRules`.
 *
 * Off-Signal paths (`ctx.emitLink` direct) bypass this entirely; the
 * resolver only sees Signals.
 */

import type { Link, Signal, SignalCandidate } from '../types.js';

/**
 * Resolve a flat array of Signals into Links. Scaffold: first candidate
 * wins per Signal. The shape of the function is stable across the
 * migration; only the candidate-ranking logic inside `pickWinner` will
 * grow when `resolverRules` land.
 */
export function resolveSignals(signals: readonly Signal[]): Link[] {
  const links: Link[] = [];
  for (const signal of signals) {
    const winner = pickWinner(signal);
    if (!winner) continue;
    links.push(materialise(signal, winner));
  }
  return links;
}

/**
 * Scaffold ranking: first candidate wins, no rules applied. Returns
 * `null` only when the Signal carries no candidates (which the
 * orchestrator's `validateSignal` already rejects, so this branch is
 * defensive).
 */
function pickWinner(signal: Signal): SignalCandidate | null {
  return signal.candidates[0] ?? null;
}

/**
 * Materialise a winning candidate as a `Link` row. Confidence is
 * numeric on both sides post-Phase 4, so the assignment is direct.
 */
function materialise(signal: Signal, winner: SignalCandidate): Link {
  const link: Link = {
    source: signal.source,
    target: winner.target,
    kind: winner.kind,
    confidence: winner.confidence,
    sources: [winner.extractorId],
    raw: signal.raw,
  };
  if (winner.trigger) link.trigger = winner.trigger;
  if (signal.range) {
    link.location = { line: 1, offset: signal.range.start };
  }
  return link;
}
