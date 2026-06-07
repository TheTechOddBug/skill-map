/**
 * Unit coverage for the `tags` analyzer:
 *   - Emits NO issues (it is a pure editor affordance, like
 *     `core/supersede`).
 *   - Emits one `inspector.action.button` contribution per node that
 *     already has a sidecar, dispatching `core/node-set-tags`, carrying
 *     a `string-list` prompt whose `defaultValue` pre-loads the node's
 *     current `annotations.tags`.
 *   - Skips nodes with no sidecar entirely (creation is CLI-only).
 */

import { describe, it } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';

import { tagsAnalyzer } from '../index.js';
import { TAGS_TEXTS } from '../text.js';
import type { IAnalyzerContext } from '../../../../../kernel/extensions/index.js';
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
  ctx: IAnalyzerContext;
  contributions: { nodePath: string; ref: unknown; payload: unknown }[];
} {
  const contributions: { nodePath: string; ref: unknown; payload: unknown }[] = [];
  return {
    ctx: {
      nodes,
      links: [],
      emitContribution: (nodePath: string, ref: unknown, payload: unknown) =>
        contributions.push({ nodePath, ref, payload }),
    } as unknown as IAnalyzerContext,
    contributions,
  };
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

describe('tags analyzer, inspector action button', () => {
  it('emits no issues', async () => {
    const node = mockNode('docs/a.md', { sidecar: sidecarWithTags(['x']) });
    const { ctx: c } = ctx([node]);
    const issues = await tagsAnalyzer.evaluate(c);
    strictEqual(issues.length, 0);
  });

  it('emits a button with defaultValue = the current sidecar tags', async () => {
    const node = mockNode('docs/a.md', { sidecar: sidecarWithTags(['core', 'wip']) });
    const { ctx: c, contributions } = ctx([node]);
    await tagsAnalyzer.evaluate(c);
    strictEqual(contributions.length, 1);
    strictEqual(contributions[0]!.nodePath, 'docs/a.md');
    strictEqual(contributions[0]!.ref, tagsAnalyzer.ui!['setTagsButton']);
    deepStrictEqual(contributions[0]!.payload, button(['core', 'wip']));
  });

  it('defaults to [] when the sidecar carries no tags', async () => {
    const node = mockNode('docs/a.md', { sidecar: sidecarWithTags(undefined) });
    const { ctx: c, contributions } = ctx([node]);
    await tagsAnalyzer.evaluate(c);
    strictEqual(contributions.length, 1);
    strictEqual(contributions[0]!.nodePath, 'docs/a.md');
    strictEqual(contributions[0]!.ref, tagsAnalyzer.ui!['setTagsButton']);
    deepStrictEqual(contributions[0]!.payload, button([]));
  });

  it('drops non-string entries from a malformed tags array', async () => {
    const node = mockNode('docs/a.md', { sidecar: sidecarWithTags(['ok', 7, null, 'fine']) });
    const { ctx: c, contributions } = ctx([node]);
    await tagsAnalyzer.evaluate(c);
    strictEqual(contributions.length, 1);
    strictEqual(contributions[0]!.nodePath, 'docs/a.md');
    strictEqual(contributions[0]!.ref, tagsAnalyzer.ui!['setTagsButton']);
    deepStrictEqual(contributions[0]!.payload, button(['ok', 'fine']));
  });

  it('defaults to [] when tags is not an array', async () => {
    const node = mockNode('docs/a.md', { sidecar: sidecarWithTags('not-an-array') });
    const { ctx: c, contributions } = ctx([node]);
    await tagsAnalyzer.evaluate(c);
    strictEqual(contributions.length, 1);
    strictEqual(contributions[0]!.nodePath, 'docs/a.md');
    strictEqual(contributions[0]!.ref, tagsAnalyzer.ui!['setTagsButton']);
    deepStrictEqual(contributions[0]!.payload, button([]));
  });

  it('skips nodes with no sidecar entirely (no contribution)', async () => {
    const node = mockNode('docs/a.md');
    const { ctx: c, contributions } = ctx([node]);
    await tagsAnalyzer.evaluate(c);
    strictEqual(contributions.length, 0);
  });

  it('emits per node with a sidecar and skips those without in a mixed set', async () => {
    const withSidecar = mockNode('docs/a.md', { sidecar: sidecarWithTags(['t']) });
    const noSidecar = mockNode('docs/b.md');
    const { ctx: c, contributions } = ctx([withSidecar, noSidecar]);
    await tagsAnalyzer.evaluate(c);
    strictEqual(contributions.length, 1);
    strictEqual(contributions[0]!.nodePath, 'docs/a.md');
    strictEqual(contributions[0]!.ref, tagsAnalyzer.ui!['setTagsButton']);
    deepStrictEqual(contributions[0]!.payload, button(['t']));
  });

  it('declares the inspector.action.button contribution slot', () => {
    deepStrictEqual(tagsAnalyzer.ui, {
      setTagsButton: {
        slot: 'inspector.action.button',
        priority: 15,
      },
    });
  });

  it('declares analyzer kind in deterministic mode', () => {
    strictEqual(tagsAnalyzer.kind, 'analyzer');
    strictEqual(tagsAnalyzer.mode, 'deterministic');
  });
});
