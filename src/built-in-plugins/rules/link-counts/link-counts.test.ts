/**
 * Unit tests for `core/link-counts`.
 *
 * **Status (2026-05-10)**: the rule is a no-op placeholder — its view
 * contributions were paused (see file header). The tests verify the
 * placeholder shape so a future revival of the contributions is a
 * single-file change with a clear test target.
 */

import { describe, it } from 'node:test';
import { strictEqual, deepStrictEqual } from 'node:assert';

import { linkCountsRule } from './index.js';
import type { Confidence, Link, LinkKind, Node } from '../../../kernel/types.js';

function mockNode(path: string): Node {
  return {
    path,
    kind: 'markdown',
    provider: 'core',
    bodyHash: 'a'.repeat(64),
    frontmatterHash: 'b'.repeat(64),
    bytes: { frontmatter: 0, body: 0, total: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
  };
}

function mockLink(
  source: string,
  target: string,
  kind: LinkKind = 'references',
  confidence: Confidence = 'high',
): Link {
  return { source, target, kind, confidence, sources: ['x'] };
}

describe('core/link-counts rule (no-op placeholder)', () => {
  it('exposes the right manifest shape', () => {
    strictEqual(linkCountsRule.id, 'link-counts');
    strictEqual(linkCountsRule.pluginId, 'core');
    strictEqual(linkCountsRule.kind, 'rule');
    strictEqual(linkCountsRule.mode, 'deterministic');
  });

  it('declares no view contributions while paused', () => {
    strictEqual(linkCountsRule.viewContributions, undefined);
  });

  it('returns no issues and emits nothing on any input', () => {
    const captured: unknown[] = [];
    const issues = linkCountsRule.evaluate({
      nodes: [mockNode('a.md'), mockNode('b.md')],
      links: [mockLink('a.md', 'b.md'), mockLink('a.md', 'b.md', 'invokes')],
      emitContribution(nodePath, contributionId, payload) {
        captured.push({ nodePath, contributionId, payload });
      },
    });
    deepStrictEqual(issues, []);
    deepStrictEqual(captured, []);
  });
});
