import { describe, it } from 'node:test';
import { strictEqual, deepStrictEqual } from 'node:assert';

import { nodeStabilityAnalyzer } from '../index.js';
import type { IAnalyzerContext } from '../../../../../kernel/extensions/index.js';
import type { ISidecarOverlay, Issue, Node } from '../../../../../kernel/types.js';

type TContribution = { nodePath: string; ref: unknown; payload: unknown };

function mockNode(
  path: string,
  frontmatter?: Record<string, unknown>,
  sidecar?: ISidecarOverlay | null,
): Node {
  return {
    path,
    kind: 'markdown',
    provider: 'claude',
    bodyHash: 'x'.repeat(64),
    frontmatterHash: 'y'.repeat(64),
    bytes: { frontmatter: 0, body: 0, total: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
    ...(frontmatter !== undefined ? { frontmatter } : {}),
    ...(sidecar !== undefined ? { sidecar } : {}),
  };
}

function withAnnotations(annotations: Record<string, unknown>): ISidecarOverlay {
  return { present: true, status: 'fresh', annotations, root: { annotations } };
}

function ctx(nodes: Node[]): { ctx: IAnalyzerContext; contributions: TContribution[] } {
  const contributions: TContribution[] = [];
  return {
    ctx: {
      nodes,
      links: [],
      sidecarRoots: new Map(),
      annotationContributions: [],
      ui: [],
      emitContribution: (nodePath: string, ref: unknown, payload: unknown) =>
        contributions.push({ nodePath, ref, payload }),
    } as unknown as IAnalyzerContext,
    contributions,
  };
}

async function run(nodes: Node[]): Promise<{ issues: Issue[]; contributions: TContribution[] }> {
  const { ctx: c, contributions } = ctx(nodes);
  const issues = await nodeStabilityAnalyzer.evaluate(c);
  return { issues, contributions };
}

describe('stability analyzer', () => {
  it('emits an experimental chip and NO issue when sidecar annotations.stability is experimental', async () => {
    const node = mockNode('notes/x.md', {}, withAnnotations({ stability: 'experimental' }));
    const { issues, contributions } = await run([node]);
    strictEqual(contributions.length, 1);
    strictEqual(contributions[0]!.nodePath, 'notes/x.md');
    strictEqual(contributions[0]!.ref, nodeStabilityAnalyzer.ui!['experimental']);
    deepStrictEqual(contributions[0]!.payload, { value: 0, tooltip: 'Experimental: API may change' });
    // Experimental is a chip-only badge, never a finding.
    strictEqual(issues.length, 0);
  });

  it('emits a deprecated chip with warn severity + warn issue when sidecar annotations.stability is deprecated', async () => {
    const node = mockNode('notes/x.md', {}, withAnnotations({ stability: 'deprecated' }));
    const { issues, contributions } = await run([node]);
    strictEqual(contributions.length, 1);
    strictEqual(contributions[0]!.nodePath, 'notes/x.md');
    strictEqual(contributions[0]!.ref, nodeStabilityAnalyzer.ui!['deprecated']);
    deepStrictEqual(contributions[0]!.payload, { value: 0, tooltip: 'Deprecated: avoid in new code', severity: 'warn' });
    strictEqual(issues.length, 1);
    strictEqual(issues[0]?.severity, 'warn');
    strictEqual(issues[0]?.analyzerId, 'node-stability');
    deepStrictEqual(issues[0]?.nodeIds, ['notes/x.md']);
  });

  it('emits nothing when sidecar annotations.stability is stable', async () => {
    const node = mockNode('notes/x.md', {}, withAnnotations({ stability: 'stable' }));
    const { issues, contributions } = await run([node]);
    strictEqual(contributions.length, 0);
    strictEqual(issues.length, 0);
  });

  it('emits nothing when no sidecar and no legacy metadata', async () => {
    const node = mockNode('notes/x.md', { name: 'something' });
    const { issues, contributions } = await run([node]);
    strictEqual(contributions.length, 0);
    strictEqual(issues.length, 0);
  });

  it('falls back to legacy frontmatter metadata.stability when sidecar is absent', async () => {
    const node = mockNode('notes/x.md', { metadata: { stability: 'experimental' } });
    const { contributions } = await run([node]);
    strictEqual(contributions.length, 1);
    strictEqual(contributions[0]?.ref, nodeStabilityAnalyzer.ui!['experimental']);
  });

  it('prefers sidecar annotations over legacy frontmatter metadata when both present', async () => {
    const node = mockNode(
      'notes/x.md',
      { metadata: { stability: 'deprecated' } },
      withAnnotations({ stability: 'experimental' }),
    );
    const { contributions } = await run([node]);
    strictEqual(contributions.length, 1);
    strictEqual(contributions[0]?.ref, nodeStabilityAnalyzer.ui!['experimental']);
  });

  it('emits nothing when sidecar is present but annotations.stability is missing', async () => {
    const node = mockNode('notes/x.md', {}, withAnnotations({ version: 2 }));
    const { issues, contributions } = await run([node]);
    strictEqual(contributions.length, 0);
    strictEqual(issues.length, 0);
  });

  it('ignores unrecognised stability values from either source', async () => {
    const node = mockNode('notes/x.md', { metadata: { stability: 'beta' } });
    const { issues, contributions } = await run([node]);
    strictEqual(contributions.length, 0);
    strictEqual(issues.length, 0);
  });

  it('iterates over every node passed in ctx.nodes', async () => {
    const a = mockNode('a.md', {}, withAnnotations({ stability: 'experimental' }));
    const b = mockNode('b.md', {}, withAnnotations({ stability: 'deprecated' }));
    const c = mockNode('c.md', {}, withAnnotations({ stability: 'stable' }));
    const { issues, contributions } = await run([a, b, c]);
    strictEqual(contributions.length, 2);
    strictEqual(contributions[0]?.nodePath, 'a.md');
    strictEqual(contributions[0]?.ref, nodeStabilityAnalyzer.ui!['experimental']);
    strictEqual(contributions[1]?.nodePath, 'b.md');
    strictEqual(contributions[1]?.ref, nodeStabilityAnalyzer.ui!['deprecated']);
    // Only the deprecated node raises a finding.
    strictEqual(issues.length, 1);
    strictEqual(issues[0]?.nodeIds[0], 'b.md');
  });

  it('declares the two chip ui on card.footer.right and no inspector button', () => {
    deepStrictEqual(nodeStabilityAnalyzer.ui, {
      experimental: {
        slot: 'card.footer.right',
        icon: 'fa-solid fa-flask',
        label: 'experimental',
        emitWhenEmpty: false,
        priority: 10,
      },
      deprecated: {
        slot: 'card.footer.right',
        icon: 'pi-ban',
        label: 'deprecated',
        emitWhenEmpty: false,
        priority: 10,
      },
    });
  });

  it('declares analyzer kind in deterministic mode', () => {
    strictEqual(nodeStabilityAnalyzer.kind, 'analyzer');
    strictEqual(nodeStabilityAnalyzer.mode, 'deterministic');
  });
});
