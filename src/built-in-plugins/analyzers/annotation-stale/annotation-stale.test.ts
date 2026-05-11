/**
 * Unit coverage for the dual surface of `annotation-stale`:
 *   - Issue emission per stale node (warn severity, `nodeIds: [path]`).
 *   - View-contribution emission to `graph.node.alert` (icon: 'sync',
 *     severity: 'warn', tooltip per status, `count: 2` only for
 *     `stale-both`).
 *
 * Fresh nodes and nodes without a sidecar overlay must emit nothing on
 * either surface.
 */

import { describe, it } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';

import { annotationStaleAnalyzer } from './index.js';
import { ANNOTATION_STALE_TEXTS } from '../../i18n/annotation-stale.texts.js';
import type { IAnalyzerContext } from '../../../kernel/extensions/index.js';
import type { ISidecarOverlay, Node, SidecarStatus } from '../../../kernel/types.js';

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

describe('annotation-stale analyzer — dual surface (issue + badge)', () => {
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

  it('emits issue + alert badge (no count) + footer chip (value=1) on stale-body', async () => {
    const node = mockNode('notes/x.md', sidecar('stale-body'));
    const { ctx: c, contributions } = ctx([node]);
    const issues = await annotationStaleAnalyzer.evaluate(c);
    strictEqual(issues.length, 1);
    strictEqual(issues[0]!.severity, 'warn');
    deepStrictEqual(issues[0]!.nodeIds, ['notes/x.md']);
    deepStrictEqual(contributions, [
      {
        nodePath: 'notes/x.md',
        id: 'drift',
        payload: {
          icon: 'sync',
          severity: 'warn',
          tooltip: ANNOTATION_STALE_TEXTS.bodyTooltip,
        },
      },
      {
        nodePath: 'notes/x.md',
        id: 'staleIcon',
        payload: {
          value: 1,
          severity: 'warn',
          tooltip: ANNOTATION_STALE_TEXTS.bodyTooltip,
        },
      },
    ]);
  });

  it('emits issue + alert + footer chip (value=1) on stale-frontmatter', async () => {
    const node = mockNode('notes/x.md', sidecar('stale-frontmatter'));
    const { ctx: c, contributions } = ctx([node]);
    const issues = await annotationStaleAnalyzer.evaluate(c);
    strictEqual(issues.length, 1);
    strictEqual(contributions.length, 2);
    deepStrictEqual(contributions[0]!.payload, {
      icon: 'sync',
      severity: 'warn',
      tooltip: ANNOTATION_STALE_TEXTS.frontmatterTooltip,
    });
    deepStrictEqual(contributions[1]!.payload, {
      value: 1,
      severity: 'warn',
      tooltip: ANNOTATION_STALE_TEXTS.frontmatterTooltip,
    });
  });

  it('emits issue + alert badge (count=2) + footer chip (value=2) on stale-both', async () => {
    const node = mockNode('notes/x.md', sidecar('stale-both'));
    const { ctx: c, contributions } = ctx([node]);
    const issues = await annotationStaleAnalyzer.evaluate(c);
    strictEqual(issues.length, 1);
    strictEqual(contributions.length, 2);
    deepStrictEqual(contributions[0]!.payload, {
      icon: 'sync',
      severity: 'warn',
      tooltip: ANNOTATION_STALE_TEXTS.bothTooltip,
      count: 2,
    });
    deepStrictEqual(contributions[1]!.payload, {
      value: 2,
      severity: 'warn',
      tooltip: ANNOTATION_STALE_TEXTS.bothTooltip,
    });
  });

  it('declares both contribution slots (graph.node.alert + card.footer.right)', () => {
    deepStrictEqual(annotationStaleAnalyzer.viewContributions, {
      drift: {
        slot: 'graph.node.alert',
        icon: 'sync',
        emitWhenEmpty: false,
      },
      staleIcon: {
        slot: 'card.footer.right',
        icon: 'clock',
        emitWhenEmpty: false,
      },
    });
  });
});
