/**
 * Unit tests for `core/link-counter`, paired incoming/outgoing
 * footer chips with per-kind tooltip breakdown.
 */

import { describe, it } from 'node:test';
import { strictEqual, deepStrictEqual } from 'node:assert';

import { linkCounterAnalyzer } from '../index.js';
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
  confidence: Confidence = 0.9,
): Link {
  return { source, target, kind, confidence, sources: ['x'] };
}

interface ICapturedContribution {
  nodePath: string;
  ref: unknown;
  payload: unknown;
}

function run(nodes: Node[], links: Link[]): { issues: Issue[]; captured: ICapturedContribution[] } {
  const captured: ICapturedContribution[] = [];
  // `evaluate` is synchronous in this analyzer; cast away the
  // `| Promise<Issue[]>` half of the kernel's return-type union.
  const issues = linkCounterAnalyzer.evaluate({
    nodes,
    links,
    settings: {},
    emitContribution(nodePath, ref, payload) {
      captured.push({ nodePath, ref, payload });
    },
  }) as Issue[];
  return { issues, captured };
}

describe('core/link-counter analyzer, paired in/out chips', () => {
  it('exposes the right manifest shape', () => {
    strictEqual(linkCounterAnalyzer.id, 'link-counter');
    strictEqual(linkCounterAnalyzer.pluginId, 'core');
    strictEqual(linkCounterAnalyzer.kind, 'analyzer');
    strictEqual(linkCounterAnalyzer.mode, 'deterministic');
  });

  it('declares both linksIn + linksOut on card.footer.left', () => {
    deepStrictEqual(linkCounterAnalyzer.ui, {
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
    // The kernel recovers the contribution id from the `ui` map by object
    // identity, so assert `ref` is the very const declared on the analyzer.
    strictEqual(captured.length, 3);
    strictEqual(captured[0]!.nodePath, 'a.md');
    strictEqual(captured[0]!.ref, linkCounterAnalyzer.ui!['linksOut']);
    deepStrictEqual(captured[0]!.payload, { value: 1, tooltip: 'out\nreferences: 1' });
    strictEqual(captured[1]!.nodePath, 'b.md');
    strictEqual(captured[1]!.ref, linkCounterAnalyzer.ui!['linksIn']);
    deepStrictEqual(captured[1]!.payload, { value: 2, tooltip: 'in\ninvokes: 1\nreferences: 1' });
    strictEqual(captured[2]!.nodePath, 'c.md');
    strictEqual(captured[2]!.ref, linkCounterAnalyzer.ui!['linksOut']);
    deepStrictEqual(captured[2]!.payload, { value: 1, tooltip: 'out\ninvokes: 1' });
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

describe('core/link-counter analyzer, resolved-target counting', () => {
  it('credits the incoming chip at `link.resolvedTarget` for a slash trigger', () => {
    // The slash extractor emits `target: '/foo'` (a bare trigger) and
    // the post-walk lift resolves it to `commands/foo.md`, stamping
    // `resolvedTarget`. The analyzer credits the chip there, NOT against
    // the literal `/foo` string. Resolution is the lift's job; this rule
    // only honours the path it produced.
    const nodes = [mockNode('commands/foo.md'), mockNode('callers.md')];
    const link: Link = {
      source: 'callers.md',
      target: '/foo',
      kind: 'invokes',
      confidence: 0.6,
      sources: ['slash'],
      trigger: { originalTrigger: '/foo', normalizedTrigger: '/foo' },
      resolvedTarget: 'commands/foo.md',
    };
    const { captured } = run(nodes, [link]);
    const fooLinksIn = captured.find(
      (c) => c.nodePath === 'commands/foo.md' && c.ref === linkCounterAnalyzer.ui!['linksIn'],
    );
    deepStrictEqual(fooLinksIn?.payload, {
      value: 1,
      tooltip: 'in\ninvokes: 1',
    });
  });

  it('honours a `resolvedTarget` the lift derived from the node dirname', () => {
    // Mirrors the claude bug: `stale-skill/SKILL.md` has no
    // `frontmatter.name` (parse error in description), so the lift
    // resolves the sibling's `/stale-skill` invocation via that node's
    // `dirname` identifier and stamps `resolvedTarget`. The chip honours
    // it and surfaces 1 incoming, matching the BFF incoming list.
    const nodes = [
      mockNode('.claude/skills/stale-skill/SKILL.md'),
      mockNode('caller.md'),
    ];
    const link: Link = {
      source: 'caller.md',
      target: '/stale-skill',
      kind: 'invokes',
      confidence: 0.6,
      sources: ['slash'],
      trigger: { originalTrigger: '/stale-skill', normalizedTrigger: '/stale skill' },
      resolvedTarget: '.claude/skills/stale-skill/SKILL.md',
    };
    const { captured } = run(nodes, [link]);
    const inChip = captured.find(
      (c) => c.nodePath === '.claude/skills/stale-skill/SKILL.md' && c.ref === linkCounterAnalyzer.ui!['linksIn'],
    );
    deepStrictEqual(inChip?.payload, {
      value: 1,
      tooltip: 'in\ninvokes: 1',
    });
  });

  it('skips a direct self-loop link from both linksIn and linksOut counts', () => {
    // a.md links to itself via a literal path target. Without the
    // self-loop filter the analyzer would bump both `linksIn` and
    // `linksOut` of `a.md` by 1, leaving the card showing "1 in / 1
    // out" while the LinkedNodesPanel sidecar shows zero outgoing and
    // zero incoming (it filters self-loops via `isSelfLoop`). After
    // the fix the analyzer emits no chip for the loop; `core/link-self-loop`
    // remains the surface that warns about the loop's existence.
    const { captured } = run([mockNode('a.md')], [mockLink('a.md', 'a.md')]);
    deepStrictEqual(captured, []);
  });

  it('skips a self-loop reached through trigger resolution (`source === resolvedTarget`)', () => {
    // `commands/foo.md` invokes itself via `/foo`; the lift resolves the
    // trigger back to `commands/foo.md`, which equals `link.source`, so
    // the shared `isSelfLoop` predicate fires and the analyzer skips the
    // link the same way it skips a literal-path self-loop.
    const nodes = [mockNode('commands/foo.md')];
    const link: Link = {
      source: 'commands/foo.md',
      target: '/foo',
      kind: 'invokes',
      confidence: 0.6,
      sources: ['slash'],
      trigger: { originalTrigger: '/foo', normalizedTrigger: '/foo' },
      resolvedTarget: 'commands/foo.md',
    };
    const { captured } = run(nodes, [link]);
    deepStrictEqual(captured, []);
  });

  it('still counts non-loop edges around a self-loop on the same node', () => {
    // a.md has a self-loop AND a real outgoing edge to b.md, plus a
    // real incoming edge from c.md. The self-loop must NOT contribute
    // to a.md's counts, but the real edges must, so a.md ends up with
    // 1 in (from c) and 1 out (to b). Guards against an over-eager
    // filter that drops the whole node.
    const { captured } = run(
      [mockNode('a.md'), mockNode('b.md'), mockNode('c.md')],
      [
        mockLink('a.md', 'a.md'),
        mockLink('a.md', 'b.md'),
        mockLink('c.md', 'a.md'),
      ],
    );
    const aIn = captured.find((c) => c.nodePath === 'a.md' && c.ref === linkCounterAnalyzer.ui!['linksIn']);
    const aOut = captured.find((c) => c.nodePath === 'a.md' && c.ref === linkCounterAnalyzer.ui!['linksOut']);
    deepStrictEqual(aIn?.payload, { value: 1, tooltip: 'in\nreferences: 1' });
    deepStrictEqual(aOut?.payload, { value: 1, tooltip: 'out\nreferences: 1' });
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
      confidence: 0.6,
      sources: ['slash'],
      trigger: { originalTrigger: '/ghost', normalizedTrigger: '/ghost' },
    };
    const { captured } = run(nodes, [link]);
    const ghostChip = captured.find((c) => c.nodePath === '/ghost');
    strictEqual(ghostChip, undefined, 'no chip for the unresolved trigger pseudo-target');
  });
});
