/**
 * `extractor-collision` rule. Surfaces the Signal IR resolver's
 * range-overlap rejections as `warn` issues: when two extractors detect
 * something at OVERLAPPING byte ranges in the same node, the resolver
 * keeps ONE (the winner) and drops the other, and this rule names the
 * loser, the winner, and the tiebreak reason so the operator can see why
 * a candidate edge did not materialise as a Link.
 *
 * Pure projector of `IAnalyzerContext.signals` (the resolver's annotated
 * winners + losers). Iterates every Signal whose
 * `resolution.outcome === 'rejected'` (the resolver rejects only on range
 * overlap today, populating `rejectedBy`) and emits one issue on the
 * Signal's source node.
 *
 * Was `signal-collision`; renamed because "Signal" is internal IR
 * vocabulary the operator does not share. The forward-compat
 * `extractorDisabled` / `belowFloor` rejection stubs were removed (the
 * resolver never populated them and neither was a collision).
 *
 * Severity is `warn`. The rejected Signal does NOT enter the graph; the
 * issue exists so the operator can rephrase one detection or accept the
 * resolver's choice (the `fix.summary` hint); a Provider can additionally
 * declare `resolverRules.kindPriority` to flip the tiebreak.
 */

import type { IAnalyzer, IAnalyzerContext, IBuiltInManifest } from '../../../../kernel/extensions/index.js';
import type { Issue, Signal } from '../../../../kernel/types.js';
import { tx } from '../../../../kernel/util/tx.js';
import { formatFinding } from '../../../../kernel/util/finding-format.js';
import { EXTRACTOR_COLLISION_TEXTS } from './text.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

const ID = 'extractor-collision';

/** Body line of the dropped signal, for the canonical `L<line>:` finding prefix. */
function signalLines(signal: Signal): number[] | undefined {
  return signal.range && typeof signal.range.line === 'number' ? [signal.range.line] : undefined;
}

export const extractorCollisionAnalyzer: IBuiltInManifest<IAnalyzer> = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'analyzer',
  description:
    'Reports when two extractors detect something at the same span of body text and the resolver drops one.',
  mode: 'deterministic',

  evaluate(ctx: IAnalyzerContext): Issue[] {
    const signals = ctx.signals;
    if (!signals || signals.length === 0) return [];
    const issues: Issue[] = [];
    for (const signal of signals) {
      const issue = makeIssue(signal);
      if (issue) issues.push(issue);
    }
    return issues;
  },
};

/**
 * Project one rejected Signal into a `warn` issue. Returns `null` for
 * materialised Signals and for any rejection without a `rejectedBy`
 * (the only rejection reason the resolver produces today).
 */
function makeIssue(signal: Signal): Issue | null {
  const resolution = signal.resolution;
  if (!resolution || resolution.outcome !== 'rejected' || !resolution.rejectedBy) return null;

  const winner = resolution.rejectedBy;
  // `winnerIndex` indexes THIS loser-Signal's own candidates[] (the
  // candidate that would have won within this Signal); `winner`
  // (`rejectedBy`) is the OTHER Signal that beat it on the tiebreak.
  const loserCandidate = signal.candidates[resolution.winnerIndex ?? 0]!;
  const loserRange = signal.range ? `${signal.range.start}-${signal.range.end}` : 'unknown';
  const winnerRange = `${winner.range.start}-${winner.range.end}`;
  return {
    analyzerId: ID,
    severity: 'warn',
    nodeIds: [signal.source],
    message: formatFinding({
      subject: signal.raw,
      lines: signalLines(signal),
      body: tx(EXTRACTOR_COLLISION_TEXTS.message, {
        loserExtractor: loserCandidate.extractorId,
        loserRange,
        winnerExtractor: winner.extractorId,
        winnerRange,
        reason: winner.reason,
      }),
    }),
    fix: { summary: tx(EXTRACTOR_COLLISION_TEXTS.rejectedFixSummary) },
    data: {
      loser: {
        extractorId: loserCandidate.extractorId,
        raw: signal.raw,
        range: signal.range ?? null,
        candidate: {
          kind: loserCandidate.kind,
          target: loserCandidate.target,
          confidence: loserCandidate.confidence,
        },
      },
      winner: {
        extractorId: winner.extractorId,
        range: winner.range,
      },
      reason: winner.reason,
    },
  };
}
