/**
 * Unit coverage for the dual surface of `annotation-stale`:
 *   - Issue emission per stale node (warn severity, `nodeIds: [path]`).
 *   - View-contribution emission to `card.footer.right` (icon-only
 *     chip via `value: 0` + the renderer's `value > 0` guard; tooltip
 *     differentiates body / frontmatter / both).
 *
 * Fresh nodes and nodes without a sidecar overlay must emit nothing on
 * either surface.
 */

import { describe, it } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';

import { annotationStaleAnalyzer } from './index.js';
import { ANNOTATION_STALE_TEXTS } from './text.js';
import type { IAnalyzerContext } from '../../../../kernel/extensions/index.js';
import type { ISidecarOverlay, Node, SidecarStatus } from '../../../../kernel/types.js';

function mockNode(path: string, sidecar: ISidecarOverlay | undefined): Node {
  const node: Node = {
    path,
    kind: 'markdown',
    provider: 'core-markdown',
    bodyHash: 'a'.repeat(64),
    frontmatterHash: 'b'.repeat(64),
    bytes: { frontmatter: 0, body: 0, total: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
  };
  if (sidecar) node.sidecar = sidecar;
  return node;
}

function ctx(nodes: Node[]): {
  ctx: IAnalyzerContext;
  contributions: { nodePath: string; id: string; payload: unknown }[];
} {
  const contributions: { nodePath: string; id: string; payload: unknown }[] = [];
  return {
    ctx: {
      nodes,
      links: [],
      enrichments: new Map(),
      viewContributions: new Map(),
      emitContribution: (nodePath: string, id: string, payload: unknown) =>
        contributions.push({ nodePath, id, payload }),
    } as unknown as IAnalyzerContext,
    contributions,
  };
}

function sidecar(status: SidecarStatus | null | undefined): ISidecarOverlay {
  return { present: true, status: status ?? null };
}

describe('annotation-stale analyzer, dual surface (issue + badge)', () => {
  it('emits nothing for a node without a sidecar overlay', async () => {
    const node = mockNode('notes/x.md', undefined);
    const { ctx: c, contributions } = ctx([node]);
    const issues = await annotationStaleAnalyzer.evaluate(c);
    strictEqual(issues.length, 0);
    strictEqual(contributions.length, 0);
  });

  it('emits nothing when status is fresh', async () => {
    const node = mockNode('notes/x.md', sidecar('fresh'));
    const { ctx: c, contributions } = ctx([node]);
    const issues = await annotationStaleAnalyzer.evaluate(c);
    strictEqual(issues.length, 0);
    strictEqual(contributions.length, 0);
  });

  it('emits issue + icon-only footer chip on stale-body', async () => {
    const node = mockNode('notes/x.md', sidecar('stale-body'));
    const { ctx: c, contributions } = ctx([node]);
    const issues = await annotationStaleAnalyzer.evaluate(c);
    strictEqual(issues.length, 1);
    strictEqual(issues[0]!.severity, 'warn');
    deepStrictEqual(issues[0]!.nodeIds, ['notes/x.md']);
    deepStrictEqual(contributions, [
      {
        nodePath: 'notes/x.md',
        id: 'staleIcon',
        payload: {
          value: 0,
          severity: 'warn',
          tooltip: ANNOTATION_STALE_TEXTS.bodyTooltip,
        },
      },
    ]);
  });

  it('emits issue + icon-only footer chip on stale-frontmatter', async () => {
    const node = mockNode('notes/x.md', sidecar('stale-frontmatter'));
    const { ctx: c, contributions } = ctx([node]);
    const issues = await annotationStaleAnalyzer.evaluate(c);
    strictEqual(issues.length, 1);
    strictEqual(contributions.length, 1);
    deepStrictEqual(contributions[0]!.payload, {
      value: 0,
      severity: 'warn',
      tooltip: ANNOTATION_STALE_TEXTS.frontmatterTooltip,
    });
  });

  it('emits issue + icon-only footer chip on stale-both', async () => {
    const node = mockNode('notes/x.md', sidecar('stale-both'));
    const { ctx: c, contributions } = ctx([node]);
    const issues = await annotationStaleAnalyzer.evaluate(c);
    strictEqual(issues.length, 1);
    strictEqual(contributions.length, 1);
    deepStrictEqual(contributions[0]!.payload, {
      value: 0,
      severity: 'warn',
      tooltip: ANNOTATION_STALE_TEXTS.bothTooltip,
    });
  });

  it('declares a single contribution slot (card.footer.right)', () => {
    deepStrictEqual(annotationStaleAnalyzer.viewContributions, {
      staleIcon: {
        slot: 'card.footer.right',
        icon: 'pi-clock',
        emitWhenEmpty: true,
        priority: 20,
      },
    });
  });
});
