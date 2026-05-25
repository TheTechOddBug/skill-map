/**
 * Coverage for the `core/reference-redundant` built-in rule
 * (`plugins/core/analyzers/reference-redundant/index.ts`).
 *
 * Behaviour pinned by these tests:
 *   - One `warn` per (source, resolved-target) pair whose combined
 *     occurrences across all links sum to >= 2.
 *   - Cross-extractor multi-form (one edge, sources `[at-directive,
 *     markdown-link]`, two occurrences): fires.
 *   - Cross-kind multi-edge (different kinds but same resolved target,
 *     each with one occurrence): fires.
 *   - Single occurrence (no redundancy): silent.
 *   - Unresolved (broken) links: silent (the `reference-broken` rule is the
 *     authoritative signal there).
 *   - Path-style and trigger-style links resolve uniformly through
 *     `byPath` (direct) or `byName` (frontmatter.name / filename /
 *     dirname) before grouping.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { referenceRedundantAnalyzer } from '../index.js';
import type { IAnalyzerContext } from '../../../../../kernel/extensions/index.js';
import type { Link, Node } from '../../../../../kernel/types.js';

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
    target: 'tgt.md',
    kind: 'references',
    confidence: 1.0,
    sources: [],
    ...over,
  };
}

function ctxWith(over: Partial<IAnalyzerContext>): IAnalyzerContext {
  return {
    nodes: [],
    links: [],
    emitContribution: () => {
      /* unused */
    },
    ...over,
  };
}

describe('core/reference-redundant rule', () => {
  it('emits no issues for an empty link list', async () => {
    const issues = await referenceRedundantAnalyzer.evaluate(ctxWith({}));
    assert.deepEqual(issues, []);
  });

  it('does NOT fire for a single occurrence', async () => {
    // One link, one occurrence, no redundancy. Silent.
    const src = mockNode({ path: 'src.md' });
    const tgt = mockNode({ path: 'tgt.md' });
    const link = mockLink({
      source: src.path,
      target: tgt.path,
      sources: ['markdown-link'],
      occurrences: [{ extractor: 'markdown-link', originalTrigger: './tgt.md', location: { line: 5 } }],
    });
    const issues = await referenceRedundantAnalyzer.evaluate(
      ctxWith({ nodes: [src, tgt], links: [link] }),
    );
    assert.deepEqual(issues, []);
  });

  it('fires for cross-extractor multi-form (one edge, two occurrences)', async () => {
    // The classic case: `@./tgt.md` AND `[md](./tgt.md)` both in the
    // same body. `dedupeLinks` merged them into one edge with
    // `sources: ['at-directive', 'markdown-link']` and two occurrences.
    const src = mockNode({ path: 'src.md' });
    const tgt = mockNode({ path: 'tgt.md' });
    const mergedLink = mockLink({
      source: src.path,
      target: tgt.path,
      sources: ['at-directive', 'markdown-link'],
      occurrences: [
        { extractor: 'at-directive', originalTrigger: '@./tgt.md', location: { line: 3 } },
        { extractor: 'markdown-link', originalTrigger: './tgt.md', location: { line: 8 } },
      ],
    });
    const issues = await referenceRedundantAnalyzer.evaluate(
      ctxWith({ nodes: [src, tgt], links: [mergedLink] }),
    );
    assert.equal(issues.length, 1);
    const issue = issues[0]!;
    assert.equal(issue.severity, 'warn');
    assert.equal(issue.analyzerId, 'reference-redundant');
    assert.deepEqual(issue.nodeIds, [src.path]);
    const data = issue.data as Record<string, unknown>;
    assert.equal(data['target'], tgt.path);
    assert.equal(data['resolvedTarget'], tgt.path);
    const occs = data['occurrences'] as Array<Record<string, unknown>>;
    assert.equal(occs.length, 2);
    assert.match(issue.message, /3 occurrences|2 occurrences/);
  });

  it('fires for cross-kind multi-edge (same resolved target via different kinds)', async () => {
    // `@./real-agent.md` (references) + `@real-agent` (mentions) both
    // resolve to `.claude/agents/real-agent.md`. Different kinds, NOT
    // merged by dedup, but the (source, resolved-target) group still
    // has two links / occurrences total.
    const hub = mockNode({ path: '.claude/agents/hub.md', frontmatter: { name: 'hub' } });
    const agent = mockNode({
      path: '.claude/agents/real-agent.md',
      kind: 'agent',
      frontmatter: { name: 'real-agent' },
    });
    const refLink = mockLink({
      source: hub.path,
      target: agent.path,
      kind: 'references',
      sources: ['at-directive'],
      occurrences: [{ extractor: 'at-directive', originalTrigger: '@./real-agent.md', location: { line: 4 } }],
    });
    const mentLink = mockLink({
      source: hub.path,
      target: '@real-agent',
      kind: 'mentions',
      sources: ['at-directive'],
      trigger: { originalTrigger: '@real-agent', normalizedTrigger: '@real agent' },
      occurrences: [{ extractor: 'at-directive', originalTrigger: '@real-agent', location: { line: 7 } }],
    });
    const issues = await referenceRedundantAnalyzer.evaluate(
      ctxWith({ nodes: [hub, agent], links: [refLink, mentLink] }),
    );
    assert.equal(issues.length, 1);
    const issue = issues[0]!;
    assert.deepEqual(issue.nodeIds, [hub.path]);
    const data = issue.data as Record<string, unknown>;
    assert.equal(data['resolvedTarget'], agent.path);
    const occs = data['occurrences'] as Array<Record<string, unknown>>;
    assert.equal(occs.length, 2);
  });

  it('does NOT fire for unresolved (broken) links', async () => {
    // `@ghost` resolves to nothing. broken-ref handles it; we stay
    // silent so we do not double-report.
    const hub = mockNode({ path: 'hub.md' });
    const broken = mockLink({
      source: hub.path,
      target: '@ghost',
      kind: 'mentions',
      sources: ['at-directive'],
      trigger: { originalTrigger: '@ghost', normalizedTrigger: '@ghost' },
      occurrences: [
        { extractor: 'at-directive', originalTrigger: '@ghost', location: { line: 1 } },
        { extractor: 'at-directive', originalTrigger: '@ghost', location: { line: 2 } },
      ],
    });
    const issues = await referenceRedundantAnalyzer.evaluate(
      ctxWith({ nodes: [hub], links: [broken] }),
    );
    assert.deepEqual(issues, []);
  });

  it('resolves trigger-style targets via the name index (dirname + frontmatter.name)', async () => {
    // The skill node has no `frontmatter.name` but its dirname matches
    // the trigger. Mirrors Anthropic's documented skills convention.
    const hub = mockNode({ path: 'hub.md' });
    const skill = mockNode({
      path: '.claude/skills/explore/SKILL.md',
      kind: 'skill',
      frontmatter: {},
    });
    const slashLink = mockLink({
      source: hub.path,
      target: '/explore',
      kind: 'invokes',
      sources: ['slash'],
      trigger: { originalTrigger: '/explore', normalizedTrigger: '/explore' },
      occurrences: [{ extractor: 'slash', originalTrigger: '/explore', location: { line: 3 } }],
    });
    const markdownLink = mockLink({
      source: hub.path,
      target: skill.path,
      kind: 'references',
      sources: ['markdown-link'],
      occurrences: [{ extractor: 'markdown-link', originalTrigger: './explore/SKILL.md', location: { line: 5 } }],
    });
    const issues = await referenceRedundantAnalyzer.evaluate(
      ctxWith({ nodes: [hub, skill], links: [slashLink, markdownLink] }),
    );
    assert.equal(issues.length, 1);
    const issue = issues[0]!;
    const data = issue.data as Record<string, unknown>;
    assert.equal(data['resolvedTarget'], skill.path);
  });
});
