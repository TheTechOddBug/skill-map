/**
 * Unit coverage for the surfaces of `annotation-stale`:
 *   - Issue emission per stale node (info severity, `nodeIds: [path]`).
 *   - `staleIcon` view contribution to `card.footer.right` (icon-only
 *     chip via `value: 0`; tooltip differentiates body / frontmatter / both).
 *   - `staleBadge` view contribution to `inspector.header.badge` (the
 *     clock that used to be hardcoded in the inspector header), stale-only.
 *   - `bumpButton` view contribution to `inspector.action.button`,
 *     emitted for EVERY node that has a sidecar (the payload `enabled`
 *     flag carries the dynamic gate: true when stale, false when fresh).
 *
 * Nodes without a sidecar overlay emit nothing (the inspector never
 * offers to scaffold a `.sm`). Fresh nodes still emit the disabled bump
 * button so the affordance is always present.
 */

import { describe, it } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';

import { annotationStaleAnalyzer } from '../index.js';
import { ANNOTATION_STALE_TEXTS } from '../text.js';
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
  contributions: { nodePath: string; id: string; payload: unknown }[];
} {
  const contributions: { nodePath: string; id: string; payload: unknown }[] = [];
  return {
    ctx: {
      nodes,
      links: [],
      enrichments: new Map(),
      ui: new Map(),
      emitContribution: (nodePath: string, id: string, payload: unknown) =>
        contributions.push({ nodePath, id, payload }),
    } as unknown as IAnalyzerContext,
    contributions,
  };
}

function sidecar(status: SidecarStatus | null | undefined): ISidecarOverlay {
  return { present: true, status: status ?? null };
}

const ENABLED_BUMP = {
  actionId: 'core/node-bump',
  label: ANNOTATION_STALE_TEXTS.bumpLabel,
  icon: 'pi-arrow-up-right',
  enabled: true,
};

const DISABLED_BUMP = {
  actionId: 'core/node-bump',
  label: ANNOTATION_STALE_TEXTS.bumpLabel,
  icon: 'pi-arrow-up-right',
  enabled: false,
  disabledReason: ANNOTATION_STALE_TEXTS.bumpDisabledReason,
};

describe('annotation-stale analyzer, surfaces (issue + footer chip + header badge + bump button)', () => {
  it('emits nothing for a node without a sidecar overlay', async () => {
    const node = mockNode('notes/x.md', undefined);
    const { ctx: c, contributions } = ctx([node]);
    const issues = await annotationStaleAnalyzer.evaluate(c);
    strictEqual(issues.length, 0);
    strictEqual(contributions.length, 0);
  });

  it('emits only a disabled bump button when status is fresh', async () => {
    const node = mockNode('notes/x.md', sidecar('fresh'));
    const { ctx: c, contributions } = ctx([node]);
    const issues = await annotationStaleAnalyzer.evaluate(c);
    strictEqual(issues.length, 0);
    deepStrictEqual(contributions, [
      { nodePath: 'notes/x.md', id: 'bumpButton', payload: DISABLED_BUMP },
    ]);
  });

  it('emits enabled bump button + issue + footer chip + header badge on stale-body', async () => {
    const node = mockNode('notes/x.md', sidecar('stale-body'));
    const { ctx: c, contributions } = ctx([node]);
    const issues = await annotationStaleAnalyzer.evaluate(c);
    strictEqual(issues.length, 1);
    strictEqual(issues[0]!.severity, 'info');
    deepStrictEqual(issues[0]!.nodeIds, ['notes/x.md']);
    deepStrictEqual(contributions, [
      { nodePath: 'notes/x.md', id: 'bumpButton', payload: ENABLED_BUMP },
      {
        nodePath: 'notes/x.md',
        id: 'staleIcon',
        payload: { value: 0, tooltip: ANNOTATION_STALE_TEXTS.bodyTooltip },
      },
      {
        nodePath: 'notes/x.md',
        id: 'staleBadge',
        payload: { icon: 'pi-clock', tooltip: ANNOTATION_STALE_TEXTS.bodyTooltip },
      },
    ]);
  });

  it('emits the same three contributions on stale-frontmatter', async () => {
    const node = mockNode('notes/x.md', sidecar('stale-frontmatter'));
    const { ctx: c, contributions } = ctx([node]);
    const issues = await annotationStaleAnalyzer.evaluate(c);
    strictEqual(issues.length, 1);
    deepStrictEqual(
      contributions.map((c2) => c2.id),
      ['bumpButton', 'staleIcon', 'staleBadge'],
    );
    deepStrictEqual(contributions[1]!.payload, {
      value: 0,
      tooltip: ANNOTATION_STALE_TEXTS.frontmatterTooltip,
    });
    deepStrictEqual(contributions[2]!.payload, {
      icon: 'pi-clock',
      tooltip: ANNOTATION_STALE_TEXTS.frontmatterTooltip,
    });
  });

  it('emits the same three contributions on stale-both', async () => {
    const node = mockNode('notes/x.md', sidecar('stale-both'));
    const { ctx: c, contributions } = ctx([node]);
    const issues = await annotationStaleAnalyzer.evaluate(c);
    strictEqual(issues.length, 1);
    deepStrictEqual(
      contributions.map((c2) => c2.id),
      ['bumpButton', 'staleIcon', 'staleBadge'],
    );
    deepStrictEqual(contributions[2]!.payload, {
      icon: 'pi-clock',
      tooltip: ANNOTATION_STALE_TEXTS.bothTooltip,
    });
  });

  it('declares three contribution slots (footer chip, header badge, action button)', () => {
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
      bumpButton: {
        slot: 'inspector.action.button',
        priority: 10,
      },
    });
  });
});
