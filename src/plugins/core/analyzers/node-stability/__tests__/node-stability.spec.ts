import { describe, it } from 'node:test';
import { strictEqual, deepStrictEqual } from 'node:assert';

import { nodeStabilityAnalyzer } from '../index.js';
import { NODE_STABILITY_TEXTS } from '../text.js';
import type { IAnalyzerContext } from '../../../../../kernel/extensions/index.js';
import type { ISidecarOverlay, Issue, Node } from '../../../../../kernel/types.js';

type TContribution = { nodePath: string; ref: unknown; payload: unknown };

/**
 * Drop the `setStabilityButton` contributions: the chip-focused tests
 * predate the button and assert on the experimental / deprecated chips
 * only. The button surface has its own dedicated suite below.
 *
 * The kernel recovers the contribution id from the `ui` map by object
 * identity, so the runtime `ref` is the very const declared on the
 * analyzer. Compare against it rather than a string id.
 */
function chipsOnly(contributions: TContribution[]): TContribution[] {
  return contributions.filter((c) => c.ref !== nodeStabilityAnalyzer.ui!['setStabilityButton']);
}

function setStabilityButton(defaultValue: string): unknown {
  return {
    actionId: 'core/node-set-stability',
    label: NODE_STABILITY_TEXTS.setLabel,
    icon: 'pi-flag',
    enabled: true,
    prompt: {
      inputType: 'enum-pick',
      paramKey: 'stability',
      label: NODE_STABILITY_TEXTS.promptLabel,
      options: [
        { value: 'experimental', label: NODE_STABILITY_TEXTS.optionExperimental },
        { value: 'stable', label: NODE_STABILITY_TEXTS.optionStable },
        { value: 'deprecated', label: NODE_STABILITY_TEXTS.optionDeprecated },
      ],
      defaultValue,
    },
  };
}

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

function ctx(nodes: Node[]): {
  ctx: IAnalyzerContext;
  contributions: { nodePath: string; ref: unknown; payload: unknown }[];
} {
  const contributions: { nodePath: string; ref: unknown; payload: unknown }[] = [];
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

async function run(nodes: Node[]): Promise<{
  issues: Issue[];
  contributions: { nodePath: string; ref: unknown; payload: unknown }[];
}> {
  const { ctx: c, contributions } = ctx(nodes);
  const issues = await nodeStabilityAnalyzer.evaluate(c);
  return { issues, contributions };
}

describe('stability analyzer', () => {
  it('emits an experimental chip + info issue when sidecar annotations.stability is experimental', async () => {
    const node = mockNode('notes/x.md', {}, withAnnotations({ stability: 'experimental' }));
    const { issues, contributions } = await run([node]);
    const chips = chipsOnly(contributions);
    strictEqual(chips.length, 1);
    strictEqual(chips[0]!.nodePath, 'notes/x.md');
    strictEqual(chips[0]!.ref, nodeStabilityAnalyzer.ui!['experimental']);
    deepStrictEqual(chips[0]!.payload, { value: 0, tooltip: 'Experimental: API may change' });
    strictEqual(issues.length, 1);
    strictEqual(issues[0]?.severity, 'info');
    strictEqual(issues[0]?.analyzerId, 'node-stability');
    deepStrictEqual(issues[0]?.nodeIds, ['notes/x.md']);
  });

  it('emits a deprecated chip with warn severity + warn issue when sidecar annotations.stability is deprecated', async () => {
    const node = mockNode('notes/x.md', {}, withAnnotations({ stability: 'deprecated' }));
    const { issues, contributions } = await run([node]);
    const chips = chipsOnly(contributions);
    strictEqual(chips.length, 1);
    strictEqual(chips[0]!.nodePath, 'notes/x.md');
    strictEqual(chips[0]!.ref, nodeStabilityAnalyzer.ui!['deprecated']);
    deepStrictEqual(chips[0]!.payload, { value: 0, tooltip: 'Deprecated: avoid in new code', severity: 'warn' });
    strictEqual(issues.length, 1);
    strictEqual(issues[0]?.severity, 'warn');
    strictEqual(issues[0]?.analyzerId, 'node-stability');
  });

  it('emits no chip / issue when sidecar annotations.stability is stable (button still fires)', async () => {
    const node = mockNode('notes/x.md', {}, withAnnotations({ stability: 'stable' }));
    const { issues, contributions } = await run([node]);
    strictEqual(chipsOnly(contributions).length, 0);
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
    // No sidecar -> no button; the chip is the only contribution.
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
    const chips = chipsOnly(contributions);
    strictEqual(chips.length, 1);
    strictEqual(chips[0]?.ref, nodeStabilityAnalyzer.ui!['experimental']);
  });

  it('emits no chip / issue when sidecar is present but annotations.stability is missing (button still fires)', async () => {
    const node = mockNode('notes/x.md', {}, withAnnotations({ version: 2 }));
    const { issues, contributions } = await run([node]);
    strictEqual(chipsOnly(contributions).length, 0);
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
    const chips = chipsOnly(contributions);
    strictEqual(chips.length, 2);
    strictEqual(chips[0]?.nodePath, 'a.md');
    strictEqual(chips[0]?.ref, nodeStabilityAnalyzer.ui!['experimental']);
    strictEqual(chips[1]?.nodePath, 'b.md');
    strictEqual(chips[1]?.ref, nodeStabilityAnalyzer.ui!['deprecated']);
    strictEqual(issues.length, 2);
  });

  it('declares both chip ui on card.footer.right plus the set-stability button slot', () => {
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
      setStabilityButton: {
        slot: 'inspector.action.button',
        priority: 15,
      },
    });
  });

  it('declares analyzer kind in deterministic mode', () => {
    strictEqual(nodeStabilityAnalyzer.kind, 'analyzer');
    strictEqual(nodeStabilityAnalyzer.mode, 'deterministic');
  });
});

describe('stability analyzer, set-stability inspector button', () => {
  it('emits no button for a node without a sidecar (creation is CLI-only)', async () => {
    const node = mockNode('notes/x.md', { metadata: { stability: 'experimental' } });
    const { contributions } = await run([node]);
    strictEqual(
      contributions.some((c) => c.ref === nodeStabilityAnalyzer.ui!['setStabilityButton']),
      false,
    );
  });

  it('emits a button with defaultValue = the current sidecar stability', async () => {
    const node = mockNode('notes/x.md', {}, withAnnotations({ stability: 'deprecated' }));
    const { contributions } = await run([node]);
    const button = contributions.find((c) => c.ref === nodeStabilityAnalyzer.ui!['setStabilityButton']);
    strictEqual(button!.nodePath, 'notes/x.md');
    strictEqual(button!.ref, nodeStabilityAnalyzer.ui!['setStabilityButton']);
    deepStrictEqual(button!.payload, setStabilityButton('deprecated'));
  });

  it("defaults to 'stable' when the sidecar carries no recognised stability", async () => {
    const node = mockNode('notes/x.md', {}, withAnnotations({ version: 2 }));
    const { contributions } = await run([node]);
    const button = contributions.find((c) => c.ref === nodeStabilityAnalyzer.ui!['setStabilityButton']);
    strictEqual(button!.nodePath, 'notes/x.md');
    strictEqual(button!.ref, nodeStabilityAnalyzer.ui!['setStabilityButton']);
    deepStrictEqual(button!.payload, setStabilityButton('stable'));
  });

  it('pre-loads the experimental stage as defaultValue', async () => {
    const node = mockNode('notes/x.md', {}, withAnnotations({ stability: 'experimental' }));
    const { contributions } = await run([node]);
    const button = contributions.find((c) => c.ref === nodeStabilityAnalyzer.ui!['setStabilityButton']);
    strictEqual(button!.nodePath, 'notes/x.md');
    strictEqual(button!.ref, nodeStabilityAnalyzer.ui!['setStabilityButton']);
    deepStrictEqual(button!.payload, setStabilityButton('experimental'));
  });
});
