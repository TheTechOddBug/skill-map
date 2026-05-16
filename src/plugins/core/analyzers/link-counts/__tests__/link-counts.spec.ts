/**
 * Unit tests for `core/link-counts`, paired incoming/outgoing
 * footer chips with per-kind tooltip breakdown.
 */

import { describe, it } from 'node:test';
import { strictEqual, deepStrictEqual } from 'node:assert';

import { linkCountsAnalyzer } from '../index.js';
import type { Confidence, Issue, Link, LinkKind, Node } from '../../../../../kernel/types.js';

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
        icon: 'pi-download',
        label: 'incoming links',
        emitWhenEmpty: false,
        priority: 10,
      },
      linksOut: {
        slot: 'card.footer.left',
        icon: 'pi-upload',
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

describe('core/link-counts analyzer, trigger resolution', () => {
  function namedNode(path: string, name: string): Node {
    return {
      ...mockNode(path),
      frontmatter: { name, description: '' },
    };
  }

  it('resolves a `/foo` slash invocation against `frontmatter.name` before counting', () => {
    // The slash extractor emits `target: '/foo'` (a bare trigger).
    // The analyzer must resolve it to the path of the node whose
    // `frontmatter.name` normalises to `foo` and credit the chip
    // there, NOT against the literal `/foo` string.
    const nodes = [namedNode('commands/foo.md', 'foo'), mockNode('callers.md')];
    const link: Link = {
      source: 'callers.md',
      target: '/foo',
      kind: 'invokes',
      confidence: 'medium',
      sources: ['slash'],
      trigger: { originalTrigger: '/foo', normalizedTrigger: '/foo' },
    };
    const { captured } = run(nodes, [link]);
    const fooLinksIn = captured.find(
      (c) => c.nodePath === 'commands/foo.md' && c.contributionId === 'linksIn',
    );
    deepStrictEqual(fooLinksIn?.payload, {
      value: 1,
      tooltip: 'in\ninvokes: 1',
    });
  });

  it('resolves via the path-basename fallback when frontmatter.name is empty', () => {
    // Mirrors the local-scope bug: `stale-skill.md` has no
    // `frontmatter.name` (parse error in description), and a sibling
    // markdown invokes it via `/stale-skill`. The chip must still
    // surface 1 incoming so the operator sees the same number the
    // graph view draws via its own basename fallback.
    const nodes = [
      mockNode('.claude/skills/stale-skill/SKILL.md'),
      mockNode('caller.md'),
    ];
    const link: Link = {
      source: 'caller.md',
      target: '/stale-skill',
      kind: 'invokes',
      confidence: 'medium',
      sources: ['slash'],
      trigger: { originalTrigger: '/stale-skill', normalizedTrigger: '/stale skill' },
    };
    const { captured } = run(nodes, [link]);
    const inChip = captured.find(
      (c) => c.nodePath === '.claude/skills/stale-skill/SKILL.md' && c.contributionId === 'linksIn',
    );
    deepStrictEqual(inChip?.payload, {
      value: 1,
      tooltip: 'in\ninvokes: 1',
    });
  });

  it('leaves the bare trigger uncounted when no node matches', () => {
    // No node owns `/ghost`; the link's target stays a bare trigger
    // and no chip is emitted (the existing "emitWhenEmpty: false"
    // policy keeps the footer clean).
    const nodes = [mockNode('caller.md')];
    const link: Link = {
      source: 'caller.md',
      target: '/ghost',
      kind: 'invokes',
      confidence: 'medium',
      sources: ['slash'],
      trigger: { originalTrigger: '/ghost', normalizedTrigger: '/ghost' },
    };
    const { captured } = run(nodes, [link]);
    const ghostChip = captured.find((c) => c.nodePath === '/ghost');
    strictEqual(ghostChip, undefined, 'no chip for the unresolved trigger pseudo-target');
  });
});
