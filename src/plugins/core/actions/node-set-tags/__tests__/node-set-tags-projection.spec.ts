/**
 * Coverage for the `node-set-tags` action's scan-time `project()`
 * self-projection (added in the 2026-07-21 enabled-gate sweep, mirroring
 * `node-set-stability` / `node-bump`): the emitted
 * `inspector.action.button` contribution is not rendered as a button,
 * its PRESENCE gates the inspector's inline tag row and the card tag
 * chips (surface follows the plugin), so a disabled action removes
 * every tag surface.
 *   - Emits one contribution per real node, sidecar or not (the write
 *     creates the `.sm` when absent), with a fixed minimal payload (no
 *     `prompt`: the tag row hosts its own inline editor).
 *   - Skips synthetic (virtual) nodes.
 */

import { describe, it } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';

import { nodeSetTagsAction } from '../index.js';
import { NODE_SET_TAGS_TEXTS } from '../node-set-tags.texts.js';
import type { IActionProjectionContext } from '../../../../../kernel/extensions/index.js';
import type { Node } from '../../../../../kernel/types.js';

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
  if (!nodeSetTagsAction.project) throw new Error('nodeSetTagsAction.project missing');
  nodeSetTagsAction.project(c);
}

const BUTTON_PAYLOAD = {
  actionId: 'core/node-set-tags',
  label: NODE_SET_TAGS_TEXTS.editLabel,
  icon: 'pi-tags',
  enabled: true,
};

describe('node-set-tags action, project() tag-row gate contribution', () => {
  it('emits the contribution for a node WITH a sidecar', () => {
    const node = mockNode('docs/a.md', {
      sidecar: { present: true, status: 'fresh', annotations: { tags: ['infra'] } },
    });
    const { ctx: c, contributions } = ctx([node]);
    project(c);
    strictEqual(contributions.length, 1);
    strictEqual(contributions[0]!.nodePath, 'docs/a.md');
    strictEqual(contributions[0]!.ref, nodeSetTagsAction.ui!['editTagsButton']);
    deepStrictEqual(contributions[0]!.payload, BUTTON_PAYLOAD);
  });

  it('emits for a node with NO sidecar (the write creates it; a tagless node still gets the row)', () => {
    const node = mockNode('docs/b.md');
    const { ctx: c, contributions } = ctx([node]);
    project(c);
    strictEqual(contributions.length, 1);
    strictEqual(contributions[0]!.nodePath, 'docs/b.md');
    deepStrictEqual(contributions[0]!.payload, BUTTON_PAYLOAD);
  });

  it('skips synthetic (virtual) nodes (no file to anchor a `.sm`)', () => {
    const { ctx: c, contributions } = ctx([mockNode('mcp://server', { virtual: true })]);
    project(c);
    strictEqual(contributions.length, 0);
  });

  it('emits once per real node in a mixed set', () => {
    const { ctx: c, contributions } = ctx([
      mockNode('docs/a.md', { sidecar: { present: true, status: 'fresh', annotations: {} } }),
      mockNode('mcp://server', { virtual: true }),
      mockNode('docs/b.md'),
    ]);
    project(c);
    deepStrictEqual(
      contributions.map((e) => e.nodePath),
      ['docs/a.md', 'docs/b.md'],
    );
  });

  it('declares the inspector.action.button contribution slot', () => {
    deepStrictEqual(nodeSetTagsAction.ui, {
      editTagsButton: {
        slot: 'inspector.action.button',
        priority: 14,
      },
    });
  });

  it('declares action kind in deterministic mode', () => {
    strictEqual(nodeSetTagsAction.kind, 'action');
    strictEqual(nodeSetTagsAction.mode, 'deterministic');
  });
});
