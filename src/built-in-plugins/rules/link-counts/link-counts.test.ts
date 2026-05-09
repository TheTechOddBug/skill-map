/**
 * Unit tests for `core/link-counts`. The rule's only side effect is
 * `ctx.emitContribution(nodePath, contributionId, payload)`; the test
 * captures emissions through a stub callback and asserts the per-node
 * counts.
 *
 * Integration coverage (the orchestrator wires the rule emit channel
 * through validation + persistence into `scan_contributions`) lives
 * in `src/test/view-contributions.test.ts`.
 */

import { describe, it, after, before } from 'node:test';
import { strictEqual, deepStrictEqual, ok } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { linkCountsRule } from './index.js';
import { runScanWithRenames, createKernel } from '../../../kernel/index.js';
import { builtIns, listBuiltIns } from '../../built-ins.js';
import type { Confidence, Link, LinkKind, Node } from '../../../kernel/types.js';

interface ICapturedEmission {
  nodePath: string;
  contributionId: string;
  payload: { value: number };
}

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

function runRule(nodes: Node[], links: Link[]): ICapturedEmission[] {
  const captured: ICapturedEmission[] = [];
  const issues = linkCountsRule.evaluate({
    nodes,
    links,
    emitContribution(nodePath, contributionId, payload) {
      captured.push({ nodePath, contributionId, payload: payload as { value: number } });
    },
  });
  // The rule never emits issues.
  strictEqual(Array.isArray(issues) ? issues.length : 0, 0);
  return captured;
}

describe('core/link-counts rule', () => {
  it('emits nothing on an empty graph', () => {
    const captured = runRule([], []);
    deepStrictEqual(captured, []);
  });

  it('skips nodes with zero links (no empty-counter chips)', () => {
    const captured = runRule([mockNode('a.md'), mockNode('b.md')], []);
    deepStrictEqual(captured, []);
  });

  it('emits linksOut for every node that originates a link', () => {
    const nodes = [mockNode('a.md'), mockNode('b.md'), mockNode('c.md')];
    const links = [
      mockLink('a.md', 'b.md'),
      mockLink('a.md', 'c.md'),
      mockLink('b.md', 'c.md'),
    ];
    const captured = runRule(nodes, links);
    const out = captured.filter((c) => c.contributionId === 'linksOut').sort((x, y) => x.nodePath.localeCompare(y.nodePath));
    deepStrictEqual(out, [
      { nodePath: 'a.md', contributionId: 'linksOut', payload: { value: 2 } },
      { nodePath: 'b.md', contributionId: 'linksOut', payload: { value: 1 } },
    ]);
  });

  it('emits linksIn for every node that receives a link', () => {
    const nodes = [mockNode('a.md'), mockNode('b.md'), mockNode('c.md')];
    const links = [
      mockLink('a.md', 'b.md'),
      mockLink('a.md', 'c.md'),
      mockLink('b.md', 'c.md'),
    ];
    const captured = runRule(nodes, links);
    const inc = captured.filter((c) => c.contributionId === 'linksIn').sort((x, y) => x.nodePath.localeCompare(y.nodePath));
    deepStrictEqual(inc, [
      { nodePath: 'b.md', contributionId: 'linksIn', payload: { value: 1 } },
      { nodePath: 'c.md', contributionId: 'linksIn', payload: { value: 2 } },
    ]);
  });

  it('emits BOTH linksOut and linksIn for a node that does both', () => {
    const nodes = [mockNode('a.md'), mockNode('b.md'), mockNode('c.md')];
    // a → b, c → b: b has 1 in, 0 out; a has 1 out, 0 in; c has 1 out, 0 in.
    // To get both on the same node: also a → c, b → a.
    const links = [
      mockLink('a.md', 'b.md'),
      mockLink('a.md', 'c.md'),
      mockLink('b.md', 'a.md'),
    ];
    const captured = runRule(nodes, links);
    const aEmissions = captured.filter((c) => c.nodePath === 'a.md').sort((x, y) => x.contributionId.localeCompare(y.contributionId));
    deepStrictEqual(aEmissions, [
      { nodePath: 'a.md', contributionId: 'linksIn', payload: { value: 1 } },
      { nodePath: 'a.md', contributionId: 'linksOut', payload: { value: 2 } },
    ]);
  });

  it('counts every link kind uniformly (kind-agnostic)', () => {
    const nodes = [mockNode('a.md'), mockNode('b.md')];
    const links = [
      mockLink('a.md', 'b.md', 'references'),
      mockLink('a.md', 'b.md', 'invokes'),
      mockLink('a.md', 'b.md', 'mentions'),
      mockLink('a.md', 'b.md', 'supersedes'),
    ];
    const captured = runRule(nodes, links);
    const aOut = captured.find((c) => c.nodePath === 'a.md' && c.contributionId === 'linksOut');
    strictEqual(aOut?.payload.value, 4, 'all four kinds count toward linksOut');
    const bIn = captured.find((c) => c.nodePath === 'b.md' && c.contributionId === 'linksIn');
    strictEqual(bIn?.payload.value, 4, 'all four kinds count toward linksIn');
  });

  it('does not emit for nodes that do not appear in the rule.nodes set', () => {
    // A link whose source/target is NOT a known node (rare but possible — broken refs)
    // should not produce phantom contribution rows for the missing node.
    const nodes = [mockNode('a.md')];
    const links = [mockLink('a.md', 'ghost.md')];
    const captured = runRule(nodes, links);
    const ghost = captured.filter((c) => c.nodePath === 'ghost.md');
    deepStrictEqual(ghost, [], 'ghost.md is not in nodes — no linksIn emitted');
    const a = captured.filter((c) => c.nodePath === 'a.md');
    strictEqual(a.length, 1, 'a.md still gets its linksOut');
    strictEqual(a[0]!.contributionId, 'linksOut');
    strictEqual(a[0]!.payload.value, 1);
  });

  it('emits the right manifest shape', () => {
    strictEqual(linkCountsRule.id, 'link-counts');
    strictEqual(linkCountsRule.pluginId, 'core');
    strictEqual(linkCountsRule.kind, 'rule');
    strictEqual(linkCountsRule.viewContributions?.['linksOut']?.contract, 'node-counter');
    strictEqual(linkCountsRule.viewContributions?.['linksIn']?.contract, 'node-counter');
    strictEqual(linkCountsRule.viewContributions?.['linksOut']?.emitWhenEmpty, false);
    strictEqual(linkCountsRule.viewContributions?.['linksIn']?.emitWhenEmpty, false);
  });
});

// ---------------------------------------------------------------------------
// Integration: orchestrator wires the emit channel through validation and
// persists the rule's emissions into the same buffer extractors populate.
// ---------------------------------------------------------------------------

describe('core/link-counts rule — orchestrator integration', () => {
  let fixture: string;

  before(async () => {
    fixture = mkdtempSync(join(tmpdir(), 'skill-map-link-counts-'));
    const write = (rel: string, content: string): void => {
      const abs = join(fixture, rel);
      mkdirSync(join(abs, '..'), { recursive: true });
      writeFileSync(abs, content);
    };
    write(
      'a.md',
      [
        '---',
        'name: a',
        'description: A',
        '---',
        '',
        '[ref to b](./b.md)',
        '[ref to c](./c.md)',
      ].join('\n'),
    );
    write('b.md', ['---', 'name: b', 'description: B', '---', '', 'body'].join('\n'));
    write('c.md', ['---', 'name: c', 'description: C', '---', '', 'body'].join('\n'));
  });

  after(() => {
    rmSync(fixture, { recursive: true, force: true });
  });

  it('persists per-node linksOut / linksIn contributions through the scan pipeline', async () => {
    const kernel = createKernel();
    for (const manifest of listBuiltIns()) kernel.registry.register(manifest);
    const scanned = await runScanWithRenames(kernel, {
      roots: [fixture],
      extensions: builtIns(),
    });
    const contributions = scanned.contributions;

    // a.md emits 2 outbound links → linksOut value 2.
    const aOut = contributions.find(
      (c) =>
        c.pluginId === 'core' &&
        c.extensionId === 'link-counts' &&
        c.contributionId === 'linksOut' &&
        c.nodePath === 'a.md',
    );
    ok(aOut, 'expected a.md linksOut contribution from core/link-counts');
    deepStrictEqual(aOut!.payload, { value: 2 });
    strictEqual(aOut!.contract, 'node-counter');

    // b.md and c.md each receive 1 inbound link → linksIn value 1.
    const bIn = contributions.find(
      (c) =>
        c.pluginId === 'core' &&
        c.extensionId === 'link-counts' &&
        c.contributionId === 'linksIn' &&
        c.nodePath === 'b.md',
    );
    ok(bIn, 'expected b.md linksIn contribution');
    deepStrictEqual(bIn!.payload, { value: 1 });

    const cIn = contributions.find(
      (c) =>
        c.pluginId === 'core' &&
        c.extensionId === 'link-counts' &&
        c.contributionId === 'linksIn' &&
        c.nodePath === 'c.md',
    );
    ok(cIn, 'expected c.md linksIn contribution');
    deepStrictEqual(cIn!.payload, { value: 1 });

    // Nodes with zero links in / out should NOT appear (skip-empty rule policy).
    const bOut = contributions.find(
      (c) =>
        c.extensionId === 'link-counts' &&
        c.contributionId === 'linksOut' &&
        c.nodePath === 'b.md',
    );
    strictEqual(bOut, undefined, 'b.md has no outgoing links — no linksOut emitted');
  });
});
