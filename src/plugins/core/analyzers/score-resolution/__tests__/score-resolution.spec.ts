/**
 * Coverage for the `core/score-resolution` built-in scorer
 * (`plugins/core/analyzers/score-resolution/index.ts`).
 *
 * This is where the confidence behaviour LIVES after the kernel's
 * post-walk lift stopped assigning it inline (the lift now only records
 * `link.resolvedTarget`; see
 * `kernel/orchestrator/__tests__/lift-resolved-link-confidence.spec.ts`).
 * The scorer reads the resolution FACTS the kernel computes
 * (`link.resolvedTarget`, `ctx.reservedNodePaths`, `ctx.brokenLinks`,
 * node `.virtual`) and dogfoods the public `score`-phase
 * `ctx.adjustConfidence` API. Five outcomes per link below confidence 1:
 *
 *   - resolved to a real, non-virtual node  → `set 1.0`
 *   - resolved to a reserved target         → `set 0.1`
 *   - genuinely broken (no resolvedTarget,  → `ceil 0.5`
 *     in `ctx.brokenLinks`)
 *   - resolved to a virtual node            → no op
 *   - resolved by name but kind-mismatched  → no op
 *     (no resolvedTarget, not broken)
 *
 * Plus the `confidence < 1` gate: a link already at full confidence
 * (annotation `1.0`) is never adjusted. `foldConfidence` is applied at
 * the end of the happy-path tests to confirm the final number matches
 * the value the lift used to assign.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { scoreResolutionAnalyzer } from '../index.js';
import { foldConfidence } from '../../../../../kernel/orchestrator/confidence-score.js';
import {
  BROKEN_TARGET_CONFIDENCE,
  RESERVED_TARGET_CONFIDENCE,
} from '../../../../../kernel/orchestrator/confidence-constants.js';
import type { IAnalyzerContext } from '../../../../../kernel/extensions/index.js';
import type { Link, Node, TConfidenceOp } from '../../../../../kernel/types.js';

function mockNode(over: Partial<Node>): Node {
  return {
    path: 'fixture.md',
    kind: 'agent',
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

function mockLink(over: Partial<Link>): Link {
  return {
    source: 'src.md',
    target: 'target.md',
    kind: 'references',
    confidence: 0.85,
    sources: ['mock'],
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
 * Run the scorer against a ctx with a captured `adjustConfidence` and
 * return the ops it emitted, in call order. Mirrors the `ctxWith`/`run`
 * style of the `name-reserved` / `reference-broken` specs.
 */
function run(over: Partial<IAnalyzerContext>): IRecordedOp[] {
  const recorded: IRecordedOp[] = [];
  const ctx = {
    nodes: [],
    links: [],
    settings: {},
    emitContribution: () => {
      /* unused */
    },
    adjustConfidence: (link: Link, op: TConfidenceOp) => {
      recorded.push({ link, op });
    },
    ...over,
  } as unknown as IAnalyzerContext;
  scoreResolutionAnalyzer.evaluate(ctx);
  return recorded;
}

/** Convenience: fold a base + the single op recorded for `link`. */
function finalConfidence(base: number, recorded: IRecordedOp[], link: Link): number {
  const ops = recorded.filter((r) => r.link === link).map((r) => r.op);
  return foldConfidence(base, ops);
}

describe('core/score-resolution scorer, the five resolution outcomes', () => {
  it('resolved → `set 1.0` (folds to 1.0)', () => {
    const reviewer = mockNode({ path: '.claude/agents/reviewer.md' });
    const link = mockLink({ confidence: 0.85, resolvedTarget: reviewer.path });
    const recorded = run({
      nodes: [reviewer],
      links: [link],
      reservedNodePaths: new Set(),
      brokenLinks: new Set(),
    });
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0]!.link, link);
    assert.deepEqual(recorded[0]!.op, { kind: 'set', value: 1.0 });
    assert.equal(finalConfidence(0.85, recorded, link), 1.0);
  });

  it('reserved → `set 0.1` (folds to RESERVED_TARGET_CONFIDENCE)', () => {
    const help = mockNode({ path: '.claude/commands/help.md', kind: 'command' });
    const link = mockLink({ confidence: 0.8, kind: 'invokes', resolvedTarget: help.path });
    const recorded = run({
      nodes: [help],
      links: [link],
      reservedNodePaths: new Set([help.path]),
      brokenLinks: new Set(),
    });
    assert.equal(recorded.length, 1);
    assert.deepEqual(recorded[0]!.op, { kind: 'set', value: RESERVED_TARGET_CONFIDENCE });
    assert.equal(finalConfidence(0.8, recorded, link), RESERVED_TARGET_CONFIDENCE);
  });

  it('broken → `ceil 0.5` (caps, folds to BROKEN_TARGET_CONFIDENCE)', () => {
    const src = mockNode({ path: 'src.md', kind: 'markdown', provider: 'core' });
    const link = mockLink({ source: 'src.md', target: 'missing.md', confidence: 0.95 });
    const recorded = run({
      nodes: [src],
      links: [link],
      reservedNodePaths: new Set(),
      brokenLinks: new Set([link]),
    });
    assert.equal(recorded.length, 1);
    assert.deepEqual(recorded[0]!.op, { kind: 'ceil', value: BROKEN_TARGET_CONFIDENCE });
    assert.equal(finalConfidence(0.95, recorded, link), BROKEN_TARGET_CONFIDENCE);
  });

  it('virtual → no op (resolvedTarget set, but node is virtual)', () => {
    const mcp = mockNode({ path: 'mcp://images', kind: 'mcp', virtual: true });
    const link = mockLink({ target: 'mcp://images', confidence: 0.85, resolvedTarget: mcp.path });
    const recorded = run({
      nodes: [mcp],
      links: [link],
      reservedNodePaths: new Set(),
      brokenLinks: new Set(),
    });
    assert.equal(recorded.length, 0);
  });

  it('not-bumped (no resolvedTarget, not broken) → no op', () => {
    // `/foo` matched an agent by name but the kind matrix rejected it, so
    // the lift left resolvedTarget undefined AND did not mark it broken.
    const foo = mockNode({ path: '.claude/agents/foo.md', frontmatter: { name: 'foo' } });
    const link = mockLink({ target: '/foo', kind: 'invokes', confidence: 0.8 });
    const recorded = run({
      nodes: [foo],
      links: [link],
      reservedNodePaths: new Set(),
      brokenLinks: new Set(),
    });
    assert.equal(recorded.length, 0);
  });
});

describe('core/score-resolution scorer, the confidence < 1 gate', () => {
  it('skips a link already at confidence 1.0 even if its target resolves', () => {
    // An annotation-derived link emitted at full confidence; the scorer
    // must not touch it (matches the lift's old `< 1` gate).
    const real = mockNode({ path: 'real.md', kind: 'markdown', provider: 'core' });
    const link = mockLink({
      target: 'real.md',
      confidence: 1.0,
      sources: ['annotations'],
      resolvedTarget: real.path,
    });
    const recorded = run({
      nodes: [real],
      links: [link],
      reservedNodePaths: new Set(),
      brokenLinks: new Set(),
    });
    assert.equal(recorded.length, 0);
  });

  it('skips a link already at 1.0 even if it is in the broken set', () => {
    // Annotation dangling ref: confidence 1.0, genuinely broken. The
    // broken-ref ANALYZER still flags it as an issue, but the scorer's
    // `< 1` gate leaves the confidence number alone.
    const a = mockNode({ path: 'a.md', kind: 'markdown', provider: 'core' });
    const link = mockLink({
      source: 'a.md',
      target: 'ghost.md',
      confidence: 1.0,
      sources: ['annotations'],
    });
    const recorded = run({
      nodes: [a],
      links: [link],
      reservedNodePaths: new Set(),
      brokenLinks: new Set([link]),
    });
    assert.equal(recorded.length, 0);
  });
});

describe('core/score-resolution scorer, mixed graph + defensive paths', () => {
  it('emits exactly one mutually-exclusive op per below-threshold link', () => {
    const reviewer = mockNode({ path: '.claude/agents/reviewer.md' });
    const help = mockNode({ path: '.claude/commands/help.md', kind: 'command' });
    const mcp = mockNode({ path: 'mcp://images', kind: 'mcp', virtual: true });
    const resolved = mockLink({ confidence: 0.85, resolvedTarget: reviewer.path });
    const reserved = mockLink({
      confidence: 0.8,
      kind: 'invokes',
      resolvedTarget: help.path,
    });
    const broken = mockLink({ source: 'src.md', target: 'missing.md', confidence: 0.95 });
    const virtual = mockLink({
      target: 'mcp://images',
      confidence: 0.85,
      resolvedTarget: mcp.path,
    });
    const full = mockLink({ confidence: 1.0, sources: ['annotations'] });
    const recorded = run({
      nodes: [reviewer, help, mcp],
      links: [resolved, reserved, broken, virtual, full],
      reservedNodePaths: new Set([help.path]),
      brokenLinks: new Set([broken]),
    });
    // resolved → set 1.0, reserved → set 0.1, broken → ceil 0.5; virtual
    // + full emit nothing. Three ops total, one per affected link.
    assert.equal(recorded.length, 3);
    assert.deepEqual(recorded.find((r) => r.link === resolved)?.op, { kind: 'set', value: 1.0 });
    assert.deepEqual(recorded.find((r) => r.link === reserved)?.op, {
      kind: 'set',
      value: RESERVED_TARGET_CONFIDENCE,
    });
    assert.deepEqual(recorded.find((r) => r.link === broken)?.op, {
      kind: 'ceil',
      value: BROKEN_TARGET_CONFIDENCE,
    });
    assert.equal(recorded.find((r) => r.link === virtual), undefined);
    assert.equal(recorded.find((r) => r.link === full), undefined);
  });

  it('returns an empty issue array (the scorer never emits issues)', () => {
    const reviewer = mockNode({ path: '.claude/agents/reviewer.md' });
    const link = mockLink({ confidence: 0.85, resolvedTarget: reviewer.path });
    const recorded: IRecordedOp[] = [];
    const issues = scoreResolutionAnalyzer.evaluate({
      nodes: [reviewer],
      links: [link],
      settings: {},
      reservedNodePaths: new Set(),
      brokenLinks: new Set(),
      emitContribution: () => {
        /* unused */
      },
      adjustConfidence: (l: Link, op: TConfidenceOp) => recorded.push({ link: l, op }),
    } as unknown as IAnalyzerContext);
    assert.deepEqual(issues, []);
    assert.equal(recorded.length, 1);
  });

  it('is a no-op outside the score phase (no adjustConfidence on ctx)', () => {
    // A detect/aggregate caller (or a legacy ctx) supplies no
    // `adjustConfidence`; the scorer must short-circuit, never throw.
    const reviewer = mockNode({ path: '.claude/agents/reviewer.md' });
    const link = mockLink({ confidence: 0.85, resolvedTarget: reviewer.path });
    const issues = scoreResolutionAnalyzer.evaluate({
      nodes: [reviewer],
      links: [link],
      settings: {},
      reservedNodePaths: new Set(),
      brokenLinks: new Set(),
      emitContribution: () => {
        /* unused */
      },
    } as unknown as IAnalyzerContext);
    assert.deepEqual(issues, []);
  });

  it('treats a resolvedTarget with no matching node as non-virtual (set 1.0)', () => {
    // Defensive: `resolvedTarget` points at a path not in `ctx.nodes`
    // (the orchestrator threads both, so this is an out-of-sync guard).
    // `nodeByPath.get(resolved)?.virtual` is undefined → not virtual →
    // the link is treated as a normal resolution and bumped.
    const link = mockLink({ confidence: 0.85, resolvedTarget: 'absent.md' });
    const recorded = run({
      nodes: [],
      links: [link],
      reservedNodePaths: new Set(),
      brokenLinks: new Set(),
    });
    assert.equal(recorded.length, 1);
    assert.deepEqual(recorded[0]!.op, { kind: 'set', value: 1.0 });
  });
});
