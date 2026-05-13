/**
 * Unit tests for `core/link-counts`, paired incoming/outgoing
 * footer chips with per-kind tooltip breakdown.
 */

import { describe, it } from 'node:test';
import { strictEqual, deepStrictEqual } from 'node:assert';

import { linkCountsAnalyzer } from './index.js';
import type { Confidence, Issue, Link, LinkKind, Node } from '../../../kernel/types.js';

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

interface ICapturedContribution {
  nodePath: string;
  contributionId: string;
  payload: unknown;
}

function run(nodes: Node[], links: Link[]): { issues: Issue[]; captured: ICapturedContribution[] } {
  const captured: ICapturedContribution[] = [];
  // `evaluate` is synchronous in this analyzer; cast away the
  // `| Promise<Issue[]>` half of the kernel's return-type union.
  const issues = linkCountsAnalyzer.evaluate({
    nodes,
    links,
    emitContribution(nodePath, contributionId, payload) {
      captured.push({ nodePath, contributionId, payload });
    },
  }) as Issue[];
  return { issues, captured };
}

describe('core/link-counts analyzer, paired in/out chips', () => {
  it('exposes the right manifest shape', () => {
    strictEqual(linkCountsAnalyzer.id, 'link-counts');
    strictEqual(linkCountsAnalyzer.pluginId, 'core');
    strictEqual(linkCountsAnalyzer.kind, 'analyzer');
    strictEqual(linkCountsAnalyzer.mode, 'deterministic');
  });

  it('declares both linksIn + linksOut on card.footer.left', () => {
    deepStrictEqual(linkCountsAnalyzer.viewContributions, {
      linksIn: {
        slot: 'card.footer.left',
        icon: 'pi-sign-in',
        label: 'incoming links',
        emitWhenEmpty: false,
        priority: 10,
      },
      linksOut: {
        slot: 'card.footer.left',
        icon: 'pi-sign-out',
        label: 'outgoing links',
        emitWhenEmpty: false,
        priority: 20,
      },
    });
  });

  it('returns no issues (the rule is contributions-only)', () => {
    const { issues } = run([mockNode('a.md')], []);
    deepStrictEqual(issues, []);
  });

  it('emits nothing for isolated nodes (no incoming, no outgoing)', () => {
    const { captured } = run([mockNode('a.md'), mockNode('b.md')], []);
    deepStrictEqual(captured, []);
  });

  it('counts incoming + outgoing per node with `in` / `out` header in tooltip', () => {
    // a.md → b.md (references); c.md → b.md (invokes).
    // a emits only linksOut; b emits both; c emits only linksOut.
    const { captured } = run(
      [mockNode('a.md'), mockNode('b.md'), mockNode('c.md')],
      [mockLink('a.md', 'b.md'), mockLink('c.md', 'b.md', 'invokes')],
    );
    deepStrictEqual(captured, [
      { nodePath: 'a.md', contributionId: 'linksOut', payload: { value: 1, tooltip: 'out\nreferences: 1' } },
      { nodePath: 'b.md', contributionId: 'linksIn',  payload: { value: 2, tooltip: 'in\ninvokes: 1\nreferences: 1' } },
      { nodePath: 'c.md', contributionId: 'linksOut', payload: { value: 1, tooltip: 'out\ninvokes: 1' } },
    ]);
  });

  it('groups multiple links of the same kind on one tooltip line (incoming)', () => {
    const { captured } = run(
      [mockNode('target.md')],
      [
        mockLink('a.md', 'target.md', 'mentions'),
        mockLink('b.md', 'target.md', 'mentions'),
        mockLink('c.md', 'target.md', 'mentions'),
        mockLink('d.md', 'target.md', 'references'),
      ],
    );
    // 1 chip for the target (linksIn); the 4 sources are not in `nodes`,
    // so they emit no chip.
    strictEqual(captured.length, 1);
    deepStrictEqual(captured[0]!.payload, {
      value: 4,
      tooltip: 'in\nmentions: 3\nreferences: 1',
    });
  });

  it('caps the count at 99 (counter slot ceiling); tooltip retains the raw breakdown', () => {
    const links = Array.from({ length: 150 }, (_, i) => mockLink(`s${i}.md`, 'target.md'));
    const { captured } = run([mockNode('target.md')], links);
    strictEqual(captured.length, 1);
    deepStrictEqual(captured[0]!.payload, {
      value: 99,
      tooltip: 'in\nreferences: 150',
    });
  });
});
