/**
 * Coverage for the `node-set-stability` action's scan-time `project()`
 * self-projection (the button formerly emitted by the `core/node-stability`
 * analyzer, now folded into the action that dispatches it, mirroring
 * `node-set-tags` / `node-bump`):
 *   - Emits one `inspector.action.button` per node that already has a
 *     sidecar, dispatching `core/node-set-stability`, carrying an
 *     `enum-pick` prompt whose `defaultValue` pre-loads the node's effective
 *     stability (sidecar first, legacy frontmatter `metadata.stability` next,
 *     `stable` as the floor).
 *   - Skips nodes with no sidecar entirely (creation is CLI-only).
 */

import { describe, it } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';

import { nodeSetStabilityAction } from '../index.js';
import { NODE_SET_STABILITY_TEXTS } from '../text.js';
import type { IActionProjectionContext } from '../../../../../kernel/extensions/index.js';
import type { ISidecarOverlay, Node } from '../../../../../kernel/types.js';

function mockNode(path: string, overrides: Partial<Node> = {}): Node {
  return {
    path,
    kind: 'markdown',
    provider: 'core-markdown',
    bodyHash: 'a'.repeat(64),
    frontmatterHash: 'b'.repeat(64),
    bytes: { frontmatter: 0, body: 0, total: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
    ...overrides,
  };
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
  if (!nodeSetStabilityAction.project) throw new Error('nodeSetStabilityAction.project missing');
  nodeSetStabilityAction.project(c);
}

function sidecarWithStability(stability?: unknown): ISidecarOverlay {
  const annotations = stability === undefined ? {} : { stability };
  return { present: true, status: 'fresh', annotations };
}

function button(defaultValue: string): unknown {
  return {
    actionId: 'core/node-set-stability',
    label: NODE_SET_STABILITY_TEXTS.setLabel,
    icon: 'pi-flag',
    enabled: true,
    prompt: {
      inputType: 'enum-pick',
      paramKey: 'stability',
      label: NODE_SET_STABILITY_TEXTS.promptLabel,
      options: [
        { value: 'experimental', label: NODE_SET_STABILITY_TEXTS.optionExperimental },
        { value: 'stable', label: NODE_SET_STABILITY_TEXTS.optionStable },
        { value: 'deprecated', label: NODE_SET_STABILITY_TEXTS.optionDeprecated },
      ],
      defaultValue,
    },
  };
}

describe('node-set-stability action, project() inspector button', () => {
  it('emits a button with defaultValue = the current sidecar stability', () => {
    const node = mockNode('docs/a.md', { sidecar: sidecarWithStability('deprecated') });
    const { ctx: c, contributions } = ctx([node]);
    project(c);
    strictEqual(contributions.length, 1);
    strictEqual(contributions[0]!.nodePath, 'docs/a.md');
    strictEqual(contributions[0]!.ref, nodeSetStabilityAction.ui!['setStabilityButton']);
    deepStrictEqual(contributions[0]!.payload, button('deprecated'));
  });

  it('pre-loads the experimental stage as defaultValue', () => {
    const node = mockNode('docs/a.md', { sidecar: sidecarWithStability('experimental') });
    const { ctx: c, contributions } = ctx([node]);
    project(c);
    strictEqual(contributions.length, 1);
    deepStrictEqual(contributions[0]!.payload, button('experimental'));
  });

  it("defaults to 'stable' when the sidecar carries no recognised stability", () => {
    const node = mockNode('docs/a.md', { sidecar: sidecarWithStability(undefined) });
    const { ctx: c, contributions } = ctx([node]);
    project(c);
    strictEqual(contributions.length, 1);
    strictEqual(contributions[0]!.ref, nodeSetStabilityAction.ui!['setStabilityButton']);
    deepStrictEqual(contributions[0]!.payload, button('stable'));
  });

  it('falls back to legacy frontmatter metadata.stability when the sidecar has none', () => {
    const node = mockNode('docs/a.md', {
      frontmatter: { metadata: { stability: 'deprecated' } },
      sidecar: sidecarWithStability(undefined),
    });
    const { ctx: c, contributions } = ctx([node]);
    project(c);
    strictEqual(contributions.length, 1);
    deepStrictEqual(contributions[0]!.payload, button('deprecated'));
  });

  it('ignores an unrecognised sidecar value and defaults to stable', () => {
    const node = mockNode('docs/a.md', { sidecar: sidecarWithStability('beta') });
    const { ctx: c, contributions } = ctx([node]);
    project(c);
    strictEqual(contributions.length, 1);
    deepStrictEqual(contributions[0]!.payload, button('stable'));
  });

  it('emits for a node with no sidecar (the write creates it), defaulting to stable', () => {
    const node = mockNode('docs/a.md');
    const { ctx: c, contributions } = ctx([node]);
    project(c);
    strictEqual(contributions.length, 1);
    strictEqual(contributions[0]!.nodePath, 'docs/a.md');
    deepStrictEqual(contributions[0]!.payload, button('stable'));
  });

  it('skips synthetic (virtual) nodes (no file to anchor a `.sm`)', () => {
    const node = mockNode('mcp://server', { virtual: true });
    const { ctx: c, contributions } = ctx([node]);
    project(c);
    strictEqual(contributions.length, 0);
  });

  it('emits for every real node in a mixed set (with and without sidecar)', () => {
    const withSidecar = mockNode('docs/a.md', { sidecar: sidecarWithStability('experimental') });
    const noSidecar = mockNode('docs/b.md');
    const { ctx: c, contributions } = ctx([withSidecar, noSidecar]);
    project(c);
    strictEqual(contributions.length, 2);
    deepStrictEqual(contributions[0]!.payload, button('experimental'));
    strictEqual(contributions[1]!.nodePath, 'docs/b.md');
    deepStrictEqual(contributions[1]!.payload, button('stable'));
  });

  it('declares the inspector.action.button contribution slot', () => {
    deepStrictEqual(nodeSetStabilityAction.ui, {
      setStabilityButton: {
        slot: 'inspector.action.button',
        priority: 15,
      },
    });
  });

  it('declares action kind in deterministic mode', () => {
    strictEqual(nodeSetStabilityAction.kind, 'action');
    strictEqual(nodeSetStabilityAction.mode, 'deterministic');
  });
});
