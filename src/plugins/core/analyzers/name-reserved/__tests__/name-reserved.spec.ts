/**
 * Coverage for the `core/name-reserved` built-in rule
 * (`plugins/core/analyzers/name-reserved/index.ts`).
 *
 * Behaviour pinned by these tests:
 *   - One `warn` issue per path in `ctx.reservedNodePaths`.
 *   - Absent / empty `reservedNodePaths` ⇒ no issues (cheap no-op).
 *   - `nodeIds` carries the offending node's path; `data.provider` /
 *     `data.kind` mirror the node's attributes so the UI can render
 *     the issue without re-deriving them.
 *   - Reserved paths that do not match any node in `ctx.nodes` are
 *     silently skipped (defensive, the orchestrator only adds paths
 *     of nodes it iterated, so divergence here would indicate an
 *     out-of-sync ctx).
 *   - Pure projection: detection lives in the orchestrator
 *     (`buildReservedNodePaths`), the rule emits one issue per entry.
 *
 * Score-phase coverage (added with the scorer decomposition): besides
 * emitting issues, this analyzer now applies the reserved-target
 * confidence penalty. In its source-side loop it calls
 * `ctx.adjustConfidence(link, { kind: 'delta', value: -RESERVED_PENALTY })`
 * for every reserved-resolving link. The kernel seeds a 1.0 baseline on
 * every link, so the penalty folds to `1.0 - 0.9 = 0.1`. There is NO
 * confidence gate anymore: the delta fires regardless of the link's
 * confidence; only the score-phase `adjustConfidence` presence bounds the
 * adjustment (a detect/aggregate ctx supplies none). Detection (the warn)
 * is independent of both. The ops are captured via a recording
 * `adjustConfidence`.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { nameReservedAnalyzer } from '../index.js';
import { RESERVED_PENALTY } from '../../../../../kernel/orchestrator/confidence-constants.js';
import type { IAnalyzerContext } from '../../../../../kernel/extensions/index.js';
import type { Link, Node, TConfidenceOp } from '../../../../../kernel/types.js';

function mockNode(over: Partial<Node>): Node {
  return {
    path: 'fixture.md',
    kind: 'command',
    provider: 'claude',
    bodyHash: '0'.repeat(64),
    frontmatterHash: '0'.repeat(64),
    bytes: { frontmatter: 0, body: 0, total: 0 },
    frontmatter: {},
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
    ...over,
  };
}

/**
 * One recorded `adjustConfidence` call, by link object identity.
 */
interface IRecordedOp {
  link: Link;
  op: TConfidenceOp;
}

/**
 * Build a ctx whose `adjustConfidence` records `{ link, op }` into the
 * shared `ops` array the calling test reads back. The array lives on the
 * returned ctx via a non-enumerable side channel is overkill here, so the
 * convention is: pass `ops` in, the closure pushes into it. When a test
 * wants the legacy/detect shape (no scoring), it omits `ops` and the ctx
 * carries no `adjustConfidence` at all.
 */
function ctxWith(over: Partial<IAnalyzerContext>, ops?: IRecordedOp[]): IAnalyzerContext {
  const base: Partial<IAnalyzerContext> = {
    nodes: [],
    links: [],
    settings: {},
    emitContribution: () => {
      /* unused */
    },
  };
  if (ops) {
    base.adjustConfidence = (link: Link, op: TConfidenceOp) => {
      ops.push({ link, op });
    };
  }
  return { ...base, ...over } as IAnalyzerContext;
}

describe('core/name-reserved rule', () => {
  it('emits no issues when reservedNodePaths is absent', async () => {
    const issues = await nameReservedAnalyzer.evaluate(ctxWith({}));
    assert.deepEqual(issues, []);
  });

  it('emits no issues when reservedNodePaths is empty', async () => {
    const issues = await nameReservedAnalyzer.evaluate(
      ctxWith({ reservedNodePaths: new Set() }),
    );
    assert.deepEqual(issues, []);
  });

  it('emits one warn issue per reserved path with the matching node', async () => {
    const helpCmd = mockNode({
      path: '.claude/commands/help.md',
      kind: 'command',
      provider: 'claude',
      frontmatter: { name: 'help' },
    });
    const generalAgent = mockNode({
      path: '.claude/agents/general-purpose.md',
      kind: 'agent',
      provider: 'claude',
      frontmatter: { name: 'general-purpose' },
    });
    const okNode = mockNode({
      path: '.claude/commands/release.md',
      kind: 'command',
      provider: 'claude',
      frontmatter: { name: 'release' },
    });
    const issues = await nameReservedAnalyzer.evaluate(
      ctxWith({
        nodes: [helpCmd, generalAgent, okNode],
        reservedNodePaths: new Set([helpCmd.path, generalAgent.path]),
      }),
    );
    assert.equal(issues.length, 2);
    const byPath = new Map(issues.map((i) => [i.nodeIds[0], i]));
    const helpIssue = byPath.get(helpCmd.path);
    assert.ok(helpIssue);
    assert.equal(helpIssue.severity, 'warn');
    assert.equal(helpIssue.analyzerId, 'name-reserved');
    assert.deepEqual(helpIssue.data, { provider: 'claude', kind: 'command', surface: 'target' });
    assert.match(helpIssue.message, /Name collision; this command name is shadowed by the claude/);
    const generalIssue = byPath.get(generalAgent.path);
    assert.ok(generalIssue);
    assert.deepEqual(generalIssue.data, { provider: 'claude', kind: 'agent', surface: 'target' });
  });

  it('silently skips reserved paths that do not match any node (defensive)', async () => {
    const issues = await nameReservedAnalyzer.evaluate(
      ctxWith({
        nodes: [],
        reservedNodePaths: new Set(['.claude/commands/ghost.md']),
      }),
    );
    assert.deepEqual(issues, []);
  });

  it('emits a source-side warn for every link that resolves to a reserved name (any confidence)', async () => {
    // hub mentions @general-purpose, whose resolved target is a reserved
    // node. Detection is by `resolvedTarget ∈ reservedNodePaths`, NOT by
    // the confidence value, so the link below carries an arbitrary 0.7 (as
    // if a `score`-phase plugin had moved it) and the source-side warn
    // must still fire. The score side ALSO records a single
    // `delta -RESERVED_PENALTY` op on the link, regardless of confidence
    // (there is no gate): folded onto the kernel's 1.0 baseline this lands
    // the edge at 0.1.
    const hub = mockNode({
      path: '.claude/agents/hub-mentions.md',
      kind: 'agent',
      provider: 'claude',
      frontmatter: { name: 'hub-mentions' },
    });
    const generalAgent = mockNode({
      path: '.claude/agents/general-purpose.md',
      kind: 'agent',
      provider: 'claude',
      frontmatter: { name: 'general-purpose' },
    });
    const downgradedLink = {
      source: hub.path,
      target: '@general-purpose',
      kind: 'mentions' as const,
      confidence: 0.7, // arbitrary: detection no longer reads confidence
      sources: ['at-directive'],
      trigger: {
        originalTrigger: '@general-purpose',
        normalizedTrigger: '@general purpose',
      },
      // The lift stamps the reserved node's path before downgrading;
      // the analyzer reads it back instead of re-deriving identifiers.
      resolvedTarget: generalAgent.path,
    };
    const ops: IRecordedOp[] = [];
    const issues = await nameReservedAnalyzer.evaluate(
      ctxWith(
        {
          nodes: [hub, generalAgent],
          links: [downgradedLink],
          reservedNodePaths: new Set([generalAgent.path]),
        },
        ops,
      ),
    );
    // 1 target-side (existing) + 1 source-side (new).
    assert.equal(issues.length, 2);
    const sourceSide = issues.find((i) => i.nodeIds[0] === hub.path);
    assert.ok(sourceSide, 'expected a source-side issue on the hub');
    assert.equal(sourceSide.severity, 'warn');
    assert.equal(sourceSide.analyzerId, 'name-reserved');
    const data = sourceSide.data as Record<string, unknown>;
    assert.equal(data['target'], '@general-purpose');
    assert.equal(data['kind'], 'mentions');
    assert.equal(data['surface'], 'source');
    assert.equal(data['reservedPath'], generalAgent.path);
    assert.equal(data['reservedProvider'], 'claude');
    assert.equal(data['reservedKind'], 'agent');
    assert.match(sourceSide.message, /Name collision; resolves to the claude built-in/);
    assert.match(sourceSide.message, /the built-in shadows this edge/);
    // Score side: exactly one op on the reserved-resolving link.
    assert.equal(ops.length, 1);
    assert.equal(ops[0]!.link, downgradedLink);
    assert.deepEqual(ops[0]!.op, { kind: 'delta', value: -RESERVED_PENALTY });
  });

  it('records the delta even when the link is already at confidence 1.0 (no gate)', async () => {
    // Same reserved-resolving edge, but the link arrives at full
    // confidence (e.g. an annotation-derived link, or the kernel's 1.0
    // baseline). There is NO confidence gate: a reserved-resolving link
    // ALWAYS gets the penalty delta, which folds 1.0 down to 0.1. The
    // detection (warn) is independent and fires regardless.
    const hub = mockNode({
      path: '.claude/agents/hub-mentions.md',
      kind: 'agent',
      provider: 'claude',
      frontmatter: { name: 'hub-mentions' },
    });
    const generalAgent = mockNode({
      path: '.claude/agents/general-purpose.md',
      kind: 'agent',
      provider: 'claude',
      frontmatter: { name: 'general-purpose' },
    });
    const fullLink = {
      source: hub.path,
      target: '@general-purpose',
      kind: 'mentions' as const,
      confidence: 1.0,
      sources: ['annotations'],
      trigger: {
        originalTrigger: '@general-purpose',
        normalizedTrigger: '@general purpose',
      },
      resolvedTarget: generalAgent.path,
    };
    const ops: IRecordedOp[] = [];
    const issues = await nameReservedAnalyzer.evaluate(
      ctxWith(
        {
          nodes: [hub, generalAgent],
          links: [fullLink],
          reservedNodePaths: new Set([generalAgent.path]),
        },
        ops,
      ),
    );
    // 1 target-side + 1 source-side, the detection is confidence-agnostic.
    assert.equal(issues.length, 2);
    const sourceSide = issues.find((i) => i.nodeIds[0] === hub.path);
    assert.ok(sourceSide, 'expected a source-side issue on the hub');
    // The delta DOES fire at confidence 1.0: no gate.
    assert.equal(ops.length, 1);
    assert.equal(ops[0]!.link, fullLink);
    assert.deepEqual(ops[0]!.op, { kind: 'delta', value: -RESERVED_PENALTY });
  });

  it('does NOT emit a source-side issue (or any op) for a broken link with no resolved target', async () => {
    // A broken @ghost-agent never resolved (no `resolvedTarget`), so it
    // cannot be in the reserved set. Reserved-name has nothing to say,
    // regardless of the confidence value it carries, and records no op.
    const hub = mockNode({
      path: '.claude/agents/hub-mentions.md',
      kind: 'agent',
      provider: 'claude',
      frontmatter: { name: 'hub-mentions' },
    });
    const general = mockNode({
      path: '.claude/agents/general-purpose.md',
      kind: 'agent',
      provider: 'claude',
      frontmatter: { name: 'general-purpose' },
    });
    const brokenLink = {
      source: hub.path,
      target: '@ghost-agent',
      kind: 'mentions' as const,
      confidence: 0.5,
      sources: ['at-directive'],
      trigger: {
        originalTrigger: '@ghost-agent',
        normalizedTrigger: '@ghost agent',
      },
    };
    const ops: IRecordedOp[] = [];
    const issues = await nameReservedAnalyzer.evaluate(
      ctxWith(
        {
          nodes: [hub, general],
          links: [brokenLink],
          reservedNodePaths: new Set([general.path]),
        },
        ops,
      ),
    );
    // Only the target-side issue for general-purpose; no source-side.
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.nodeIds[0], general.path);
    assert.equal((issues[0]?.data as Record<string, unknown>)['surface'], 'target');
    // The broken link never resolved to a reserved node, so no op.
    assert.equal(ops.length, 0);
  });

  it('still emits the warns and never throws when ctx has no adjustConfidence (legacy/detect caller)', async () => {
    // A detect/aggregate caller (or a legacy ctx) supplies no
    // `adjustConfidence`. Detection must run unchanged, the score side
    // short-circuits on the missing `adjust`, and nothing throws.
    const hub = mockNode({
      path: '.claude/agents/hub-mentions.md',
      kind: 'agent',
      provider: 'claude',
      frontmatter: { name: 'hub-mentions' },
    });
    const generalAgent = mockNode({
      path: '.claude/agents/general-purpose.md',
      kind: 'agent',
      provider: 'claude',
      frontmatter: { name: 'general-purpose' },
    });
    const downgradedLink = {
      source: hub.path,
      target: '@general-purpose',
      kind: 'mentions' as const,
      confidence: 0.7,
      sources: ['at-directive'],
      trigger: {
        originalTrigger: '@general-purpose',
        normalizedTrigger: '@general purpose',
      },
      resolvedTarget: generalAgent.path,
    };
    // No `ops` argument → ctx carries no `adjustConfidence`.
    const issues = await nameReservedAnalyzer.evaluate(
      ctxWith({
        nodes: [hub, generalAgent],
        links: [downgradedLink],
        reservedNodePaths: new Set([generalAgent.path]),
      }),
    );
    // Both target-side and source-side warns still fire.
    assert.equal(issues.length, 2);
    assert.ok(issues.find((i) => i.nodeIds[0] === hub.path), 'source-side warn still emitted');
    assert.ok(issues.find((i) => i.nodeIds[0] === generalAgent.path), 'target-side warn still emitted');
  });
});
