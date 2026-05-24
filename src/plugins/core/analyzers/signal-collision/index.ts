/**
 * `signal-collision` rule. Surfaces the Signal IR resolver's rejection
 * decisions as `warn` issues so the operator can see WHY a candidate
 * edge did not materialise as a Link.
 *
 * Reads `IAnalyzerContext.signals`, which the kernel orchestrator
 * populates with the resolver's annotated Signals (winners AND losers,
 * each carrying a `resolution` outcome). The analyzer iterates every
 * Signal whose `resolution.outcome === 'rejected'` and emits one issue
 * attached to the Signal's source node, naming the loser's extractor +
 * matched text + byte range, the winner's extractor + range, and the
 * tiebreak reason (`kind-priority` / `higher-confidence` /
 * `longer-range` / `earlier-declaration`).
 *
 * Phase 4+ stubs `extractorDisabled` and `belowFloor` are handled too:
 * the resolver does not populate them today but the analyzer emits the
 * right message shape so the surface is forward-compatible the day
 * those filters land.
 *
 * Severity is `warn`. The rejected Signal does NOT enter the graph; the
 * issue exists so the operator can decide to:
 *   - rephrase one of the two detections (rename a token, adjust a
 *     markdown link),
 *   - accept the resolver's choice (silent, no further action),
 *   - or declare `IProvider.resolverRules.kindPriority` to flip the
 *     tiebreak.
 */

import type { IAnalyzer, IAnalyzerContext } from '../../../../kernel/extensions/index.js';
import type { Issue, Signal } from '../../../../kernel/types.js';
import { tx } from '../../../../kernel/util/tx.js';
import { SIGNAL_COLLISION_TEXTS } from './text.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

const ID = 'signal-collision';

export const signalCollisionAnalyzer: IAnalyzer = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'analyzer',
  version: '1.0.0',
  description:
    'Reports when two extractors fight over the same span of body text, or when a candidate link is dropped (extractor disabled, confidence too low) before it reaches the graph.',
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

// eslint-disable-next-line complexity
function makeIssue(signal: Signal): Issue | null {
  const resolution = signal.resolution;
  if (!resolution || resolution.outcome !== 'rejected') return null;

  if (resolution.rejectedBy) {
    const winner = resolution.rejectedBy;
    const winnerCandidate = signal.candidates[resolution.winnerIndex ?? 0]!;
    const loserRange = signal.range
      ? `${signal.range.start}-${signal.range.end}`
      : 'unknown';
    const winnerRange = `${winner.range.start}-${winner.range.end}`;
    return {
      analyzerId: ID,
      severity: 'warn',
      nodeIds: [signal.source],
      message: tx(SIGNAL_COLLISION_TEXTS.message, {
        loserExtractor: winnerCandidate.extractorId,
        loserRaw: signal.raw,
        loserRange,
        winnerExtractor: winner.extractorId,
        winnerRange,
        reason: winner.reason,
      }),
      data: {
        loser: {
          extractorId: winnerCandidate.extractorId,
          raw: signal.raw,
          range: signal.range ?? null,
          candidate: {
            kind: winnerCandidate.kind,
            target: winnerCandidate.target,
            confidence: winnerCandidate.confidence,
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

  if (resolution.extractorDisabled) {
    const loserRange = signal.range
      ? `${signal.range.start}-${signal.range.end}`
      : 'unknown';
    return {
      analyzerId: ID,
      severity: 'warn',
      nodeIds: [signal.source],
      message: tx(SIGNAL_COLLISION_TEXTS.messageExtractorDisabled, {
        extractorId: resolution.extractorDisabled.extractorId,
        loserRaw: signal.raw,
        loserRange,
      }),
      data: {
        extractorDisabled: resolution.extractorDisabled,
        raw: signal.raw,
        range: signal.range ?? null,
      },
    };
  }

  if (resolution.belowFloor) {
    const loserRange = signal.range
      ? `${signal.range.start}-${signal.range.end}`
      : 'unknown';
    const topCandidate = signal.candidates[0]!;
    return {
      analyzerId: ID,
      severity: 'warn',
      nodeIds: [signal.source],
      message: tx(SIGNAL_COLLISION_TEXTS.messageBelowFloor, {
        loserRaw: signal.raw,
        loserRange,
        confidence: topCandidate.confidence,
        threshold: resolution.belowFloor.threshold,
      }),
      data: {
        belowFloor: resolution.belowFloor,
        raw: signal.raw,
        range: signal.range ?? null,
      },
    };
  }

  return null;
}
