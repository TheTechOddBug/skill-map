/**
 * Coverage for the `core/reserved-name` built-in rule
 * (`plugins/core/analyzers/reserved-name/index.ts`).
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
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { reservedNameAnalyzer } from '../index.js';
import type { IAnalyzerContext } from '../../../../../kernel/extensions/index.js';
import type { Node } from '../../../../../kernel/types.js';

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

describe('core/reserved-name rule', () => {
  it('emits no issues when reservedNodePaths is absent', async () => {
    const issues = await reservedNameAnalyzer.evaluate(ctxWith({}));
    assert.deepEqual(issues, []);
  });

  it('emits no issues when reservedNodePaths is empty', async () => {
    const issues = await reservedNameAnalyzer.evaluate(
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
    const issues = await reservedNameAnalyzer.evaluate(
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
    assert.equal(helpIssue.analyzerId, 'reserved-name');
    assert.deepEqual(helpIssue.data, { provider: 'claude', kind: 'command', surface: 'target' });
    assert.match(helpIssue.message, /shadows a built-in claude command/);
    const generalIssue = byPath.get(generalAgent.path);
    assert.ok(generalIssue);
    assert.deepEqual(generalIssue.data, { provider: 'claude', kind: 'agent', surface: 'target' });
  });

  it('silently skips reserved paths that do not match any node (defensive)', async () => {
    const issues = await reservedNameAnalyzer.evaluate(
      ctxWith({
        nodes: [],
        reservedNodePaths: new Set(['.claude/commands/ghost.md']),
      }),
    );
    assert.deepEqual(issues, []);
  });

  it('emits a source-side warn for every link downgraded to RESERVED_TARGET_CONFIDENCE', async () => {
    // Mirrors the link-matrix fixture: hub mentions @general-purpose, the
    // lift transform sets confidence to 0.1 because the target is reserved.
    // The analyzer must surface that decision on the source-side too so
    // the operator inspecting the hub sees WHY the edge dropped.
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
      confidence: 0.1, // RESERVED_TARGET_CONFIDENCE sentinel
      sources: ['at-directive'],
      trigger: {
        originalTrigger: '@general-purpose',
        normalizedTrigger: '@general purpose',
      },
    };
    const issues = await reservedNameAnalyzer.evaluate(
      ctxWith({
        nodes: [hub, generalAgent],
        links: [downgradedLink],
        reservedNodePaths: new Set([generalAgent.path]),
      }),
    );
    // 1 target-side (existing) + 1 source-side (new).
    assert.equal(issues.length, 2);
    const sourceSide = issues.find((i) => i.nodeIds[0] === hub.path);
    assert.ok(sourceSide, 'expected a source-side issue on the hub');
    assert.equal(sourceSide.severity, 'warn');
    assert.equal(sourceSide.analyzerId, 'reserved-name');
    const data = sourceSide.data as Record<string, unknown>;
    assert.equal(data['target'], '@general-purpose');
    assert.equal(data['kind'], 'mentions');
    assert.equal(data['surface'], 'source');
    assert.equal(data['reservedPath'], generalAgent.path);
    assert.equal(data['reservedProvider'], 'claude');
    assert.equal(data['reservedKind'], 'agent');
    assert.match(sourceSide.message, /resolves to a name reserved by the claude runtime/);
    assert.match(sourceSide.message, /confidence 0\.10/);
  });

  it('does NOT emit a source-side issue for links at non-sentinel confidence', async () => {
    // A broken @ghost-agent stays at the at-directive emit floor (0.5);
    // never resolved, never downgraded. Reserved-name has nothing to say.
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
    const issues = await reservedNameAnalyzer.evaluate(
      ctxWith({
        nodes: [hub, general],
        links: [brokenLink],
        reservedNodePaths: new Set([general.path]),
      }),
    );
    // Only the target-side issue for general-purpose; no source-side.
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.nodeIds[0], general.path);
    assert.equal((issues[0]?.data as Record<string, unknown>)['surface'], 'target');
  });
});
