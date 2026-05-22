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
    assert.deepEqual(helpIssue.data, { provider: 'claude', kind: 'command' });
    assert.match(helpIssue.message, /shadows a built-in claude command/);
    const generalIssue = byPath.get(generalAgent.path);
    assert.ok(generalIssue);
    assert.deepEqual(generalIssue.data, { provider: 'claude', kind: 'agent' });
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
});
