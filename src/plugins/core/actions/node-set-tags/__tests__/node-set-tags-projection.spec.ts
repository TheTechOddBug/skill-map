/**
 * Coverage for the `node-set-tags` action's scan-time `project()`
 * self-projection (the button formerly emitted by the deleted
 * `core/tags` projector analyzer, now folded into the action that
 * dispatches it):
 *   - Emits one `inspector.action.button` per node that already has a
 *     sidecar, dispatching `core/node-set-tags`, carrying a `string-list`
 *     prompt whose `defaultValue` pre-loads the node's current
 *     `annotations.tags`.
 *   - Skips nodes with no sidecar entirely (creation is CLI-only).
 */

import { describe, it } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';

import { nodeSetTagsAction } from '../index.js';
import { TAGS_TEXTS } from '../text.js';
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
  if (!nodeSetTagsAction.project) throw new Error('nodeSetTagsAction.project missing');
  nodeSetTagsAction.project(c);
}

function sidecarWithTags(tags?: unknown): ISidecarOverlay {
  const annotations = tags === undefined ? {} : { tags };
  return { present: true, status: 'fresh', annotations };
}

function button(defaultValue: string[]): unknown {
  return {
    actionId: 'core/node-set-tags',
    label: TAGS_TEXTS.editLabel,
    icon: 'pi-tags',
    enabled: true,
    prompt: {
      inputType: 'string-list',
      paramKey: 'tags',
      label: TAGS_TEXTS.promptLabel,
      defaultValue,
    },
  };
}

describe('node-set-tags action, project() inspector button', () => {
  it('emits a button with defaultValue = the current sidecar tags', () => {
    const node = mockNode('docs/a.md', { sidecar: sidecarWithTags(['core', 'wip']) });
    const { ctx: c, contributions } = ctx([node]);
    project(c);
    strictEqual(contributions.length, 1);
    strictEqual(contributions[0]!.nodePath, 'docs/a.md');
    strictEqual(contributions[0]!.ref, nodeSetTagsAction.ui!['setTagsButton']);
    deepStrictEqual(contributions[0]!.payload, button(['core', 'wip']));
  });

  it('defaults to [] when the sidecar carries no tags', () => {
    const node = mockNode('docs/a.md', { sidecar: sidecarWithTags(undefined) });
    const { ctx: c, contributions } = ctx([node]);
    project(c);
    strictEqual(contributions.length, 1);
    strictEqual(contributions[0]!.nodePath, 'docs/a.md');
    strictEqual(contributions[0]!.ref, nodeSetTagsAction.ui!['setTagsButton']);
    deepStrictEqual(contributions[0]!.payload, button([]));
  });

  it('drops non-string entries from a malformed tags array', () => {
    const node = mockNode('docs/a.md', { sidecar: sidecarWithTags(['ok', 7, null, 'fine']) });
    const { ctx: c, contributions } = ctx([node]);
    project(c);
    strictEqual(contributions.length, 1);
    strictEqual(contributions[0]!.nodePath, 'docs/a.md');
    strictEqual(contributions[0]!.ref, nodeSetTagsAction.ui!['setTagsButton']);
    deepStrictEqual(contributions[0]!.payload, button(['ok', 'fine']));
  });

  it('defaults to [] when tags is not an array', () => {
    const node = mockNode('docs/a.md', { sidecar: sidecarWithTags('not-an-array') });
    const { ctx: c, contributions } = ctx([node]);
    project(c);
    strictEqual(contributions.length, 1);
    strictEqual(contributions[0]!.nodePath, 'docs/a.md');
    strictEqual(contributions[0]!.ref, nodeSetTagsAction.ui!['setTagsButton']);
    deepStrictEqual(contributions[0]!.payload, button([]));
  });

  it('skips nodes with no sidecar entirely (no contribution)', () => {
    const node = mockNode('docs/a.md');
    const { ctx: c, contributions } = ctx([node]);
    project(c);
    strictEqual(contributions.length, 0);
  });

  it('emits per node with a sidecar and skips those without in a mixed set', () => {
    const withSidecar = mockNode('docs/a.md', { sidecar: sidecarWithTags(['t']) });
    const noSidecar = mockNode('docs/b.md');
    const { ctx: c, contributions } = ctx([withSidecar, noSidecar]);
    project(c);
    strictEqual(contributions.length, 1);
    strictEqual(contributions[0]!.nodePath, 'docs/a.md');
    strictEqual(contributions[0]!.ref, nodeSetTagsAction.ui!['setTagsButton']);
    deepStrictEqual(contributions[0]!.payload, button(['t']));
  });

  it('declares the inspector.action.button contribution slot', () => {
    deepStrictEqual(nodeSetTagsAction.ui, {
      setTagsButton: {
        slot: 'inspector.action.button',
        priority: 15,
      },
    });
  });

  it('declares action kind in deterministic mode', () => {
    strictEqual(nodeSetTagsAction.kind, 'action');
    strictEqual(nodeSetTagsAction.mode, 'deterministic');
  });
});
