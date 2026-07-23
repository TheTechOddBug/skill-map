/**
 * Unit tests for `core/extractor-collision`. The analyzer reads
 * `IAnalyzerContext.signals` (populated by the kernel resolver) and
 * emits one `warn` issue per Signal whose `resolution.outcome === 'rejected'`.
 *
 * The tests build Signals with hand-crafted `resolution` objects to
 * exercise the range-overlap rejection (the only reason the resolver
 * produces) without going through the full orchestrator.
 */

import { describe, it } from 'node:test';
import { strictEqual, deepStrictEqual, ok } from 'node:assert';

import { extractorCollisionAnalyzer } from '../index.js';
import type { Issue, Signal } from '../../../../../kernel/types.js';

function makeSignal(opts: Partial<Signal> & { source: string; candidates: Signal['candidates'] }): Signal {
  return {
    scope: opts.scope ?? 'body',
    raw: opts.raw ?? 'raw',
    range: opts.range ?? null,
    candidates: opts.candidates,
    source: opts.source,
    ...(opts.resolution ? { resolution: opts.resolution } : {}),
    ...(opts.fieldPath ? { fieldPath: opts.fieldPath } : {}),
    ...(opts.context ? { context: opts.context } : {}),
  };
}

function runAnalyzer(signals: readonly Signal[]): Issue[] {
  const result = extractorCollisionAnalyzer.evaluate!({
    nodes: [],
    links: [],
    settings: {},
    orphanSidecars: [],
    sidecarRoots: new Map(),
    annotationContributions: [],
    viewContributions: [],
    signals,
    emitContribution: () => undefined,
  });
  return result as Issue[];
}

describe('extractor-collision analyzer · empty + materialised signals', () => {
  it('emits nothing when ctx.signals is empty', () => {
    const issues = runAnalyzer([]);
    deepStrictEqual(issues, []);
  });

  it('emits nothing for Signals that materialised (outcome === materialised)', () => {
    const signal = makeSignal({
      source: 'a.md',
      raw: '[link](b.md)',
      range: { start: 0, end: 12, line: 1 },
      candidates: [
        {
          extractorId: 'markdown-link',
          kind: 'references',
          target: 'b.md',
          confidence: 1.0,
        },
      ],
      resolution: { outcome: 'materialised', winnerIndex: 0 },
    });
    deepStrictEqual(runAnalyzer([signal]), []);
  });

  it('emits nothing for a rejected Signal with no `rejectedBy` (defensive)', () => {
    const signal = makeSignal({
      source: 'a.md',
      raw: 'x',
      range: { start: 0, end: 1, line: 1 },
      candidates: [{ extractorId: 'x', kind: 'mentions', target: 'x', confidence: 0.5 }],
      resolution: { outcome: 'rejected' },
    });
    deepStrictEqual(runAnalyzer([signal]), []);
  });
});

describe('extractor-collision analyzer · range-overlap rejection (the primary surface)', () => {
  it('emits a warn issue naming loser, winner, and reason for a longer-range tiebreak', () => {
    const loser = makeSignal({
      source: '.claude/agents/architect.md',
      raw: '@./api.md',
      range: { start: 15, end: 24, line: 3 },
      candidates: [
        {
          extractorId: 'at-directive',
          kind: 'references',
          target: '.claude/agents/api.md',
          confidence: 0.85,
        },
      ],
      resolution: {
        outcome: 'rejected',
        rejectedBy: {
          source: '.claude/agents/architect.md',
          range: { start: 10, end: 30, line: 3 },
          extractorId: 'markdown-link',
          reason: 'longer-range',
        },
      },
    });
    const issues = runAnalyzer([loser]);
    strictEqual(issues.length, 1);
    const issue = issues[0]!;
    strictEqual(issue.analyzerId, 'extractor-collision');
    strictEqual(issue.severity, 'warn');
    deepStrictEqual(issue.nodeIds, ['.claude/agents/architect.md']);
    ok(issue.message.includes('at-directive'));
    ok(issue.message.includes('markdown-link'));
    ok(issue.message.includes('longer-range'));
    ok(issue.message.includes('@./api.md'));
    ok(issue.message.includes('15-24'));
    ok(issue.message.includes('10-30'));
    // Canonical finding grammar: the loser's body line as an `L<line>:` prefix.
    ok(issue.message.includes('\nL3:'));
    // Remediation hint lives in `fix.summary` on the live rejection case.
    ok(issue.fix?.summary?.includes('overlapping tokens'));
    const data = issue.data as Record<string, unknown>;
    strictEqual(data['reason'], 'longer-range');
  });

  it('handles each tiebreak reason verbatim in the message + data', () => {
    const reasons = ['kind-priority', 'higher-confidence', 'longer-range', 'earlier-declaration'] as const;
    for (const reason of reasons) {
      const signal = makeSignal({
        source: 'a.md',
        raw: 'x',
        range: { start: 0, end: 1, line: 1 },
        candidates: [{ extractorId: 'loser', kind: 'references', target: 't.md', confidence: 0.5 }],
        resolution: {
          outcome: 'rejected',
          rejectedBy: {
            source: 'a.md',
            range: { start: 0, end: 5, line: 1 },
            extractorId: 'winner',
            reason,
          },
        },
      });
      const issues = runAnalyzer([signal]);
      strictEqual(issues.length, 1);
      ok(issues[0]!.message.includes(reason));
      strictEqual((issues[0]!.data as Record<string, unknown>)['reason'], reason);
    }
  });

  it('emits one issue per rejected Signal (does not collapse losers from a cluster of size 3+)', () => {
    const winner = makeSignal({
      source: 'a.md',
      raw: 'A',
      range: { start: 0, end: 10, line: 1 },
      candidates: [{ extractorId: 'winner', kind: 'references', target: 't.md', confidence: 0.9 }],
      resolution: { outcome: 'materialised', winnerIndex: 0 },
    });
    const loserA = makeSignal({
      source: 'a.md',
      raw: 'B',
      range: { start: 2, end: 7, line: 1 },
      candidates: [{ extractorId: 'loser-a', kind: 'mentions', target: 't', confidence: 0.5 }],
      resolution: {
        outcome: 'rejected',
        rejectedBy: { source: 'a.md', range: { start: 0, end: 10, line: 1 }, extractorId: 'winner', reason: 'longer-range' },
      },
    });
    const loserB = makeSignal({
      source: 'a.md',
      raw: 'C',
      range: { start: 5, end: 8, line: 1 },
      candidates: [{ extractorId: 'loser-b', kind: 'mentions', target: 't', confidence: 0.5 }],
      resolution: {
        outcome: 'rejected',
        rejectedBy: { source: 'a.md', range: { start: 0, end: 10, line: 1 }, extractorId: 'winner', reason: 'longer-range' },
      },
    });
    const issues = runAnalyzer([winner, loserA, loserB]);
    strictEqual(issues.length, 2);
  });
});
