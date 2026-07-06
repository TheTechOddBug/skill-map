/**
 * Unit coverage for the surfaces of `annotation-stale`:
 *   - Issue emission per stale node (info severity, `nodeIds: [path]`).
 *   - `staleIcon` view contribution to `card.footer.right` (icon-only
 *     chip via `value: 0`; tooltip differentiates body / frontmatter / both).
 *   - `staleBadge` view contribution to `inspector.header.badge` (the
 *     clock that used to be hardcoded in the inspector header), stale-only.
 *
 * The `Bump` button on `inspector.action.button` no longer lives here;
 * it self-projects from the `core/node-bump` action's scan-time
 * `project()` (see `actions/node-bump/__tests__/node-bump-projection.spec.ts`).
 *
 * Nodes without a sidecar overlay emit nothing; fresh nodes emit nothing
 * either (the badge / chip are stale-only).
 */

import { describe, it } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';

import { annotationStaleAnalyzer } from '../index.js';
import { ANNOTATION_STALE_TEXTS } from '../annotation-stale.texts.js';
import type { IAnalyzerContext } from '../../../../../kernel/extensions/index.js';
import type { ISidecarOverlay, Node, SidecarStatus } from '../../../../../kernel/types.js';

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
  contributions: { nodePath: string; ref: unknown; payload: unknown }[];
} {
  const contributions: { nodePath: string; ref: unknown; payload: unknown }[] = [];
  return {
    ctx: {
      nodes,
      links: [],
      enrichments: new Map(),
      ui: new Map(),
      emitContribution: (nodePath: string, ref: unknown, payload: unknown) =>
        contributions.push({ nodePath, ref, payload }),
    } as unknown as IAnalyzerContext,
    contributions,
  };
}

function sidecar(status: SidecarStatus | null | undefined): ISidecarOverlay {
  return { present: true, status: status ?? null };
}

describe('annotation-stale analyzer, surfaces (issue + footer chip + header badge)', () => {
  it('emits nothing for a node without a sidecar overlay', async () => {
    const node = mockNode('notes/x.md', undefined);
    const { ctx: c, contributions } = ctx([node]);
    const issues = await annotationStaleAnalyzer.evaluate(c);
    strictEqual(issues.length, 0);
    strictEqual(contributions.length, 0);
  });

  it('emits nothing when status is fresh (badge / chip are stale-only)', async () => {
    const node = mockNode('notes/x.md', sidecar('fresh'));
    const { ctx: c, contributions } = ctx([node]);
    const issues = await annotationStaleAnalyzer.evaluate(c);
    strictEqual(issues.length, 0);
    strictEqual(contributions.length, 0);
  });

  it('emits issue + footer chip + header badge on stale-body', async () => {
    const node = mockNode('notes/x.md', sidecar('stale-body'));
    const { ctx: c, contributions } = ctx([node]);
    const issues = await annotationStaleAnalyzer.evaluate(c);
    strictEqual(issues.length, 1);
    strictEqual(issues[0]!.severity, 'info');
    deepStrictEqual(issues[0]!.nodeIds, ['notes/x.md']);
    strictEqual(contributions.length, 2);
    strictEqual(contributions[0]!.nodePath, 'notes/x.md');
    strictEqual(contributions[0]!.ref, annotationStaleAnalyzer.ui!['staleIcon']);
    deepStrictEqual(contributions[0]!.payload, { value: 0, tooltip: ANNOTATION_STALE_TEXTS.bodyTooltip });
    strictEqual(contributions[1]!.nodePath, 'notes/x.md');
    strictEqual(contributions[1]!.ref, annotationStaleAnalyzer.ui!['staleBadge']);
    deepStrictEqual(contributions[1]!.payload, { icon: 'pi-clock', tooltip: ANNOTATION_STALE_TEXTS.bodyTooltip });
  });

  it('emits the same two contributions on stale-frontmatter', async () => {
    const node = mockNode('notes/x.md', sidecar('stale-frontmatter'));
    const { ctx: c, contributions } = ctx([node]);
    const issues = await annotationStaleAnalyzer.evaluate(c);
    strictEqual(issues.length, 1);
    deepStrictEqual(
      contributions.map((c2) => c2.ref),
      [
        annotationStaleAnalyzer.ui!['staleIcon'],
        annotationStaleAnalyzer.ui!['staleBadge'],
      ],
    );
    deepStrictEqual(contributions[0]!.payload, {
      value: 0,
      tooltip: ANNOTATION_STALE_TEXTS.frontmatterTooltip,
    });
    deepStrictEqual(contributions[1]!.payload, {
      icon: 'pi-clock',
      tooltip: ANNOTATION_STALE_TEXTS.frontmatterTooltip,
    });
  });

  it('emits the same two contributions on stale-both', async () => {
    const node = mockNode('notes/x.md', sidecar('stale-both'));
    const { ctx: c, contributions } = ctx([node]);
    const issues = await annotationStaleAnalyzer.evaluate(c);
    strictEqual(issues.length, 1);
    deepStrictEqual(
      contributions.map((c2) => c2.ref),
      [
        annotationStaleAnalyzer.ui!['staleIcon'],
        annotationStaleAnalyzer.ui!['staleBadge'],
      ],
    );
    deepStrictEqual(contributions[1]!.payload, {
      icon: 'pi-clock',
      tooltip: ANNOTATION_STALE_TEXTS.bothTooltip,
    });
  });

  it('declares two contribution slots (footer chip, header badge)', () => {
    deepStrictEqual(annotationStaleAnalyzer.ui, {
      staleIcon: {
        slot: 'card.footer.right',
        icon: 'pi-clock',
        emitWhenEmpty: true,
        priority: 20,
      },
      staleBadge: {
        slot: 'inspector.header.badge',
        emitWhenEmpty: false,
        priority: 20,
      },
    });
  });
});
