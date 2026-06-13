/**
 * Coverage for the `node-bump` action's scan-time `project()`
 * self-projection (the Bump button formerly emitted by the
 * `core/annotation-stale` analyzer, now folded into the action that
 * dispatches it; the analyzer keeps its stale chip / badge + drift
 * issue):
 *   - Emits one `inspector.action.button` per node that already has a
 *     sidecar (`node.sidecar.present === true`), dispatching
 *     `core/node-bump`. The payload's `enabled` flag carries the dynamic
 *     gate (stale => enabled, fresh => disabled with a reason).
 *   - Skips nodes with no sidecar entirely (creation is CLI-only).
 */

import { describe, it } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';

import { nodeBumpAction } from '../index.js';
import { BUMP_TEXTS } from '../text.js';
import type { IActionProjectionContext } from '../../../../../kernel/extensions/index.js';
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
  ctx: IActionProjectionContext;
  contributions: { nodePath: string; ref: unknown; payload: unknown }[];
} {
  const contributions: { nodePath: string; ref: unknown; payload: unknown }[] = [];
  return {
    ctx: {
      nodes,
      links: [],
      emitContribution: (nodePath: string, ref: unknown, payload: unknown) =>
        contributions.push({ nodePath, ref, payload }),
    } as unknown as IActionProjectionContext,
    contributions,
  };
}

function project(c: IActionProjectionContext): void {
  if (!nodeBumpAction.project) throw new Error('nodeBumpAction.project missing');
  nodeBumpAction.project(c);
}

function sidecar(status: SidecarStatus | null | undefined): ISidecarOverlay {
  return { present: true, status: status ?? null };
}

const ENABLED_BUMP = {
  actionId: 'core/node-bump',
  label: BUMP_TEXTS.bumpLabel,
  icon: 'pi-arrow-up-right',
  enabled: true,
};

const DISABLED_BUMP = {
  actionId: 'core/node-bump',
  label: BUMP_TEXTS.bumpLabel,
  icon: 'pi-arrow-up-right',
  enabled: false,
  disabledReason: BUMP_TEXTS.bumpDisabledReason,
};

describe('node-bump action, project() inspector button', () => {
  it('emits nothing for a node without a sidecar overlay', () => {
    const { ctx: c, contributions } = ctx([mockNode('notes/x.md', undefined)]);
    project(c);
    strictEqual(contributions.length, 0);
  });

  it('emits a disabled bump button when status is fresh', () => {
    const { ctx: c, contributions } = ctx([mockNode('notes/x.md', sidecar('fresh'))]);
    project(c);
    strictEqual(contributions.length, 1);
    strictEqual(contributions[0]!.nodePath, 'notes/x.md');
    strictEqual(contributions[0]!.ref, nodeBumpAction.ui!['bumpButton']);
    deepStrictEqual(contributions[0]!.payload, DISABLED_BUMP);
  });

  it('emits an enabled bump button on stale-body', () => {
    const { ctx: c, contributions } = ctx([mockNode('notes/x.md', sidecar('stale-body'))]);
    project(c);
    strictEqual(contributions.length, 1);
    strictEqual(contributions[0]!.nodePath, 'notes/x.md');
    strictEqual(contributions[0]!.ref, nodeBumpAction.ui!['bumpButton']);
    deepStrictEqual(contributions[0]!.payload, ENABLED_BUMP);
  });

  it('emits an enabled bump button on stale-frontmatter and stale-both', () => {
    for (const status of ['stale-frontmatter', 'stale-both'] as const) {
      const { ctx: c, contributions } = ctx([mockNode('notes/x.md', sidecar(status))]);
      project(c);
      strictEqual(contributions.length, 1);
      deepStrictEqual(contributions[0]!.payload, ENABLED_BUMP);
    }
  });

  it('declares the inspector.action.button contribution slot', () => {
    deepStrictEqual(nodeBumpAction.ui, {
      bumpButton: {
        slot: 'inspector.action.button',
        priority: 10,
      },
    });
  });
});
