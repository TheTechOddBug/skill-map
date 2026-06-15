/**
 * Signal IR resolver phase. Phase 2.A of the active-lens migration. The
 * function consumes the `Signal[]` produced by extractors that opted into
 * `ctx.emitSignal()` and:
 *
 *   1. Ranks candidates INSIDE each Signal using the active Provider's
 *      `resolverRules.kindPriority` (when declared), then `confidence` DESC,
 *      then extractor registration order.
 *   2. Builds overlap clusters among body-scoped Signals with a `range`
 *      (transitive closure of byte-range intersection, per source).
 *   3. For each cluster of size 2+, re-applies the same tiebreak chain to
 *      each Signal's winning candidate (plus a `range` length tiebreak)
 *      to pick the cluster winner. Losers carry
 *      `resolution = { outcome: 'rejected', rejectedBy: { ... } }` naming
 *      WHO won and WHY (`kind-priority` / `higher-confidence` /
 *      `longer-range` / `earlier-declaration`).
 *   4. Materialises every Signal whose final `outcome === 'materialised'`
 *      as a `Link` with the winning candidate's `extractorId` in
 *      `sources[]`.
 *
 * External pseudo-link clusters (every member targets `http://` /
 * `https://`) skip cross-cluster ranking, every member materialises. URL
 * targets cannot conflict with internal-graph targets and cannot conflict
 * with each other (they leave the local graph regardless).
 *
 * Off-Signal paths (`ctx.emitLink` direct) bypass this entirely; the
 * resolver only sees Signals. The caller merges the resolver's Links with
 * the direct-emit Links before `dedupeLinks` runs.
 */

import type { IProvider } from '../extensions/provider.js';
import type {
  ISignalResolution,
  Link,
  Signal,
  SignalCandidate,
  SignalRange,
} from '../types.js';

export interface IResolveSignalsOpts {
  signals: readonly Signal[];
  /**
   * The Provider matching `activeProvider`, when one is resolved. Used for
   * its `resolverRules.kindPriority`. `null` means no lens active (every
   * candidate is ranked by the default chain).
   */
  activeProvider: IProvider | null;
  /**
   * Qualified extractor ids (`<plugin>/<extractor>`) in registration order.
   * Used as the final declaration-order tiebreak when two candidates are
   * otherwise indistinguishable.
   */
  extractorOrder: readonly string[];
}

export interface IResolveSignalsResult {
  /** Materialised Links from winning candidates. */
  links: Link[];
  /**
   * Every input Signal with `resolution` populated. Winners and losers
   * both stay in the array so analyzers (notably `core/extractor-collision`)
   * can surface the collisions to the operator.
   */
  resolvedSignals: Signal[];
}

/**
 * Resolve a flat array of Signals into Links + annotated Signals. Pure
 * function; mutates each Signal's `.resolution` field in place but does
 * not write to any other state.
 */
// eslint-disable-next-line complexity
export function resolveSignals(opts: IResolveSignalsOpts): IResolveSignalsResult {
  const kindPriority = opts.activeProvider?.resolverRules?.kindPriority ?? [];
  const extractorRank = buildExtractorRank(opts.extractorOrder);

  // Step 1: pick intra-Signal winner per Signal.
  for (const signal of opts.signals) {
    signal.resolution = pickIntraWinner(signal, kindPriority, extractorRank);
  }

  // Step 2: group materialised Signals by source for overlap analysis.
  const bySource = new Map<string, Signal[]>();
  for (const signal of opts.signals) {
    if (signal.resolution?.outcome !== 'materialised') continue;
    const bucket = bySource.get(signal.source) ?? [];
    bucket.push(signal);
    bySource.set(signal.source, bucket);
  }

  // Step 3: cluster body-scoped Signals by range overlap; tiebreak per cluster.
  for (const [, signals] of bySource) {
    const clusters = buildOverlapClusters(signals);
    for (const cluster of clusters) {
      if (cluster.length < 2) continue;
      if (everyCandidateIsExternalUrl(cluster)) continue;
      resolveCluster(cluster, kindPriority, extractorRank);
    }
  }

  // Step 4: materialise winners.
  const links: Link[] = [];
  for (const signal of opts.signals) {
    if (signal.resolution?.outcome !== 'materialised') continue;
    const winnerIndex = signal.resolution.winnerIndex ?? 0;
    const winner = signal.candidates[winnerIndex];
    if (!winner) continue;
    links.push(materialise(signal, winner));
  }

  return { links, resolvedSignals: [...opts.signals] };
}

function buildExtractorRank(order: readonly string[]): Map<string, number> {
  const rank = new Map<string, number>();
  for (let i = 0; i < order.length; i += 1) rank.set(order[i]!, i);
  return rank;
}

/**
 * Rank the candidates of one Signal and pick a winner. Tiebreak order:
 *   1. `kindPriority` (lower index wins). Absent kinds rank after every
 *      listed kind.
 *   2. `confidence` DESC.
 *   3. Extractor registration order (lower wins).
 *
 * Returns the materialised resolution; the cluster pass may later flip
 * it to `rejected` if the Signal loses an overlap collision.
 */
function pickIntraWinner(
  signal: Signal,
  kindPriority: readonly string[],
  extractorRank: ReadonlyMap<string, number>,
): ISignalResolution {
  let bestIndex = 0;
  for (let i = 1; i < signal.candidates.length; i += 1) {
    if (compareCandidates(signal.candidates[i]!, signal.candidates[bestIndex]!, kindPriority, extractorRank) < 0) {
      bestIndex = i;
    }
  }
  return { outcome: 'materialised', winnerIndex: bestIndex };
}

/**
 * Negative when `a` ranks ABOVE `b` (a wins). Positive when `b` wins.
 * Zero when indistinguishable.
 */
function compareCandidates(
  a: SignalCandidate,
  b: SignalCandidate,
  kindPriority: readonly string[],
  extractorRank: ReadonlyMap<string, number>,
): number {
  const kindCmp = compareKindPriority(a.kind, b.kind, kindPriority);
  if (kindCmp !== 0) return kindCmp;
  if (a.confidence !== b.confidence) return b.confidence - a.confidence;
  const aRank = extractorRank.get(a.extractorId) ?? Number.MAX_SAFE_INTEGER;
  const bRank = extractorRank.get(b.extractorId) ?? Number.MAX_SAFE_INTEGER;
  return aRank - bRank;
}

/**
 * `kindPriority` lookup. Lower index wins. A kind that does not appear in
 * the array ranks AFTER every listed kind.
 */
function compareKindPriority(
  aKind: string,
  bKind: string,
  kindPriority: readonly string[],
): number {
  if (kindPriority.length === 0) return 0;
  const aIdx = kindPriority.indexOf(aKind);
  const bIdx = kindPriority.indexOf(bKind);
  const aEff = aIdx === -1 ? Number.MAX_SAFE_INTEGER : aIdx;
  const bEff = bIdx === -1 ? Number.MAX_SAFE_INTEGER : bIdx;
  return aEff - bEff;
}

/**
 * Build transitive-closure overlap clusters from a list of Signals
 * sharing the same source. Two Signals overlap when both have a
 * body-scope `range` AND the intervals intersect (`a.end > b.start &&
 * b.end > a.start`). Frontmatter / sidecar Signals (no range) form
 * singleton clusters and never participate in collision detection.
 */
function buildOverlapClusters(signals: readonly Signal[]): Signal[][] {
  const bodySignals = signals.filter((s) => s.scope === 'body' && s.range);
  const others = signals.filter((s) => !(s.scope === 'body' && s.range));

  // Union-find over body signals.
  const parent: number[] = bodySignals.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let i = 0; i < bodySignals.length; i += 1) {
    for (let j = i + 1; j < bodySignals.length; j += 1) {
      if (rangesOverlap(bodySignals[i]!.range!, bodySignals[j]!.range!)) {
        union(i, j);
      }
    }
  }
  const byRoot = new Map<number, Signal[]>();
  for (let i = 0; i < bodySignals.length; i += 1) {
    const root = find(i);
    const bucket = byRoot.get(root) ?? [];
    bucket.push(bodySignals[i]!);
    byRoot.set(root, bucket);
  }
  return [...byRoot.values(), ...others.map((s) => [s])];
}

function rangesOverlap(a: SignalRange, b: SignalRange): boolean {
  return a.end > b.start && b.end > a.start;
}

/**
 * Every Signal in the cluster has a winning candidate whose target is an
 * external URL (`http://` or `https://`). Used to skip cluster-level
 * tiebreaks: URL-targeted Signals cannot collide with internal-graph
 * Signals and cannot conflict with each other (the pseudo-link
 * extractor's job is to count them, not to model edges).
 */
function everyCandidateIsExternalUrl(cluster: readonly Signal[]): boolean {
  for (const signal of cluster) {
    const winnerIndex = signal.resolution?.winnerIndex ?? 0;
    const winner = signal.candidates[winnerIndex];
    if (!winner) return false;
    if (!isExternalUrl(winner.target)) return false;
  }
  return true;
}

function isExternalUrl(target: string): boolean {
  return target.startsWith('http://') || target.startsWith('https://');
}

/**
 * Resolve one overlap cluster. Picks the cluster winner using the
 * compareCandidates chain on each Signal's winning candidate, with a
 * `range` length tiebreak (longer wins) inserted between confidence and
 * extractor order. Losers flip to `outcome: 'rejected'` carrying
 * `rejectedBy` populated with the winning Signal's source, range,
 * extractor, and the tiebreak reason.
 */
function resolveCluster(
  cluster: Signal[],
  kindPriority: readonly string[],
  extractorRank: ReadonlyMap<string, number>,
): void {
  // Single linear pass picks the cluster winner. We do NOT track the
  // reason champion held the title on the way through: per-loser reasons
  // are recomputed in the second pass via `whyLost()` so each rejected
  // Signal's `rejectedBy.reason` reflects ITS specific tiebreak (not the
  // last challenger's). Cheaper than building a per-loser map up front.
  let winnerIdx = 0;
  for (let i = 1; i < cluster.length; i += 1) {
    const result = compareClusterMembers(cluster[i]!, cluster[winnerIdx]!, kindPriority, extractorRank);
    if (result.winner === 'challenger') winnerIdx = i;
  }
  const winner = cluster[winnerIdx]!;
  const winnerCandidate = winner.candidates[winner.resolution?.winnerIndex ?? 0]!;
  for (let i = 0; i < cluster.length; i += 1) {
    if (i === winnerIdx) continue;
    const loser = cluster[i]!;
    loser.resolution = {
      outcome: 'rejected',
      rejectedBy: {
        source: winner.source,
        range: winner.range!,
        extractorId: winnerCandidate.extractorId,
        reason: whyLost(loser, winner, kindPriority, extractorRank),
      },
    };
  }
}

interface IClusterCompareResult {
  winner: 'challenger' | 'champion' | 'tie';
  reason: 'kind-priority' | 'higher-confidence' | 'longer-range' | 'earlier-declaration';
}

/**
 * Tiebreak between two cluster members. Chain:
 *   1. `kind-priority` on each Signal's winning candidate.
 *   2. `higher-confidence` on each Signal's winning candidate.
 *   3. `longer-range` (`range.end - range.start` DESC).
 *   4. `earlier-declaration` (extractor registration order).
 */
// eslint-disable-next-line complexity
function compareClusterMembers(
  challenger: Signal,
  champion: Signal,
  kindPriority: readonly string[],
  extractorRank: ReadonlyMap<string, number>,
): IClusterCompareResult {
  const cWinner = challenger.candidates[challenger.resolution?.winnerIndex ?? 0]!;
  const xWinner = champion.candidates[champion.resolution?.winnerIndex ?? 0]!;

  const kindCmp = compareKindPriority(cWinner.kind, xWinner.kind, kindPriority);
  if (kindCmp < 0) return { winner: 'challenger', reason: 'kind-priority' };
  if (kindCmp > 0) return { winner: 'champion', reason: 'kind-priority' };

  if (cWinner.confidence !== xWinner.confidence) {
    return cWinner.confidence > xWinner.confidence
      ? { winner: 'challenger', reason: 'higher-confidence' }
      : { winner: 'champion', reason: 'higher-confidence' };
  }

  const cLen = rangeLength(challenger.range);
  const xLen = rangeLength(champion.range);
  if (cLen !== xLen) {
    return cLen > xLen
      ? { winner: 'challenger', reason: 'longer-range' }
      : { winner: 'champion', reason: 'longer-range' };
  }

  const cRank = extractorRank.get(cWinner.extractorId) ?? Number.MAX_SAFE_INTEGER;
  const xRank = extractorRank.get(xWinner.extractorId) ?? Number.MAX_SAFE_INTEGER;
  if (cRank !== xRank) {
    return cRank < xRank
      ? { winner: 'challenger', reason: 'earlier-declaration' }
      : { winner: 'champion', reason: 'earlier-declaration' };
  }
  return { winner: 'tie', reason: 'earlier-declaration' };
}

function rangeLength(range: SignalRange | null | undefined): number {
  if (!range) return 0;
  return range.end - range.start;
}

/**
 * Compute the tiebreak reason a loser holds against the winner. Mirrors
 * `compareClusterMembers` exactly but returns just the reason for the
 * loser's `rejectedBy.reason`.
 */
function whyLost(
  loser: Signal,
  winner: Signal,
  kindPriority: readonly string[],
  extractorRank: ReadonlyMap<string, number>,
): 'kind-priority' | 'higher-confidence' | 'longer-range' | 'earlier-declaration' {
  return compareClusterMembers(winner, loser, kindPriority, extractorRank).reason;
}

/**
 * Materialise a winning candidate as a `Link` row. Same shape a direct
 * `ctx.emitLink(link)` call would produce; `dedupeLinks` downstream can
 * merge the two emission paths without special-casing. Includes the
 * synthesised `occurrences[]` entry (one per Signal) so multi-extractor
 * merges accumulate occurrences via the same code path as direct
 * emissions.
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
    link.location = { line: signal.range.line ?? 1, offset: signal.range.start };
  }
  const occurrenceTrigger = winner.trigger?.originalTrigger ?? signal.raw;
  const occurrenceLocation = signal.range ? { line: signal.range.line ?? 1 } : null;
  link.occurrences = [
    {
      extractor: winner.extractorId,
      originalTrigger: occurrenceTrigger,
      location: occurrenceLocation,
    },
  ];
  return link;
}
