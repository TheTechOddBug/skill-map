import { describe, it } from 'node:test';
import { strictEqual, deepStrictEqual } from 'node:assert';

import { toolsCounterExtractor } from '../index.js';
import type { IExtractorContext } from '../../../../../kernel/extensions/index.js';
import type { Node } from '../../../../../kernel/types.js';

function mockNode(path: string): Node {
  return {
    path,
    kind: 'agent',
    provider: 'claude',
    bodyHash: 'x'.repeat(64),
    frontmatterHash: 'y'.repeat(64),
    bytes: { frontmatter: 0, body: 0, total: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
  };
}

function ctx(frontmatter: Record<string, unknown>): {
  ctx: IExtractorContext;
  contributions: { ref: unknown; payload: unknown }[];
} {
  const contributions: { ref: unknown; payload: unknown }[] = [];
  return {
    ctx: {
      node: mockNode('agents/x.md'),
      body: '',
      frontmatter,
      settings: {},
      emitLink: () => undefined,
      enrichNode: () => undefined,
      emitContribution: (ref, payload) => contributions.push({ ref, payload }),
      emitSignal: () => undefined,
      emitNode: () => undefined,
    },
    contributions,
  };
}

describe('tools-count extractor', () => {
  it('emits count + tooltip when frontmatter declares tools', async () => {
    const { ctx: c, contributions } = ctx({ tools: ['Read', 'Edit', 'Bash'] });
    await toolsCounterExtractor.extract(c);
    strictEqual(contributions.length, 1);
    // The kernel recovers the contribution id from the `ui` map by object
    // identity, so assert `ref` is the very const declared on the extractor.
    strictEqual(contributions[0]!.ref, toolsCounterExtractor.ui!['count']);
    deepStrictEqual(contributions[0]!.payload, { value: 3, tooltip: 'Read · Edit · Bash' });
  });

  it('emits nothing when tools is absent', async () => {
    const { ctx: c, contributions } = ctx({ name: 'agent-x' });
    await toolsCounterExtractor.extract(c);
    strictEqual(contributions.length, 0);
  });

  it('emits nothing when tools is empty', async () => {
    const { ctx: c, contributions } = ctx({ tools: [] });
    await toolsCounterExtractor.extract(c);
    strictEqual(contributions.length, 0);
  });

  it('emits nothing when tools is not an array', async () => {
    const { ctx: c, contributions } = ctx({ tools: 'Read' });
    await toolsCounterExtractor.extract(c);
    strictEqual(contributions.length, 0);
  });

  it('filters non-string entries before counting', async () => {
    const { ctx: c, contributions } = ctx({ tools: ['Read', 42, null, 'Edit', ''] });
    await toolsCounterExtractor.extract(c);
    strictEqual(contributions.length, 1);
    deepStrictEqual(contributions[0]!.payload, {
      value: 2,
      tooltip: 'Read · Edit',
    });
  });

  it('truncates tooltip beyond the 256-char cap', async () => {
    const many = Array.from({ length: 60 }, (_, i) => `tool-${i.toString().padStart(2, '0')}`);
    const { ctx: c, contributions } = ctx({ tools: many });
    await toolsCounterExtractor.extract(c);
    strictEqual(contributions.length, 1);
    const payload = contributions[0]!.payload as { value: number; tooltip: string };
    strictEqual(payload.value, 60);
    strictEqual(payload.tooltip.length <= 256, true);
    strictEqual(payload.tooltip.endsWith('…'), true);
  });

  it('declares card.footer.left contribution with wrench icon', () => {
    deepStrictEqual(toolsCounterExtractor.ui, {
      count: {
        slot: 'card.footer.left',
        icon: 'pi-wrench',
        label: 'tools',
        emitWhenEmpty: false,
        priority: 40,
      },
    });
  });

  it('is gated to agent kind via precondition.kind', () => {
    deepStrictEqual(toolsCounterExtractor.precondition?.kind, ['claude/agent']);
  });
});
