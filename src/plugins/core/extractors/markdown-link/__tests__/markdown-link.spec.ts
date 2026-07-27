import { describe, it } from 'node:test';
import { strictEqual } from 'node:assert';

import { markdownLinkExtractor } from '../index.js';
import type { IExtractorContext, IEmittedNode } from '../../../../../kernel/extensions/index.js';
import { resolveSignals } from '../../../../../kernel/orchestrator/resolver.js';
import type { Link, Node, Signal } from '../../../../../kernel/types.js';

function mockNode(path: string): Node {
  return {
    path,
    kind: 'agent',
    provider: 'claude',
    bodyHash: '0'.repeat(64),
    frontmatterHash: '0'.repeat(64),
    bytes: { frontmatter: 0, body: 0, total: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
    frontmatter: {},
  };
}

function makeContext(node: Node, body: string): {
  ctx: IExtractorContext;
  links: Link[];
  signals: Signal[];
  virtualNodes: IEmittedNode[];
} {
  const links: Link[] = [];
  const signals: Signal[] = [];
  const virtualNodes: IEmittedNode[] = [];
  const ctx: IExtractorContext = {
    node,
    body,
    frontmatter: node.frontmatter ?? {},
    settings: {},
    emitLink: (link) => links.push(link),
    enrichNode: () => undefined,
    emitContribution: () => undefined,
    emitSignal: (s) => signals.push(s),
    emitNode: (n) => virtualNodes.push(n),
  };
  return { ctx, links, signals, virtualNodes };
}

/**
 * Run the extractor and flush its Signals through the kernel resolver so
 * tests assert on the merged `links` array, mirroring the real scan path.
 */
async function runAndResolve(helper: ReturnType<typeof makeContext>): Promise<void> {
  await markdownLinkExtractor.extract(helper.ctx);
  if (helper.signals.length === 0) return;
  const resolved = resolveSignals({
    signals: helper.signals,
    activeProvider: null,
    extractorOrder: ['markdown-link'],
  });
  for (const link of resolved.links) helper.links.push(link);
}

describe('markdown-link extractor', () => {
  it('emits a references link for a relative path, resolved against the source dir', async () => {
    const helper = makeContext(mockNode('docs/index.md'), 'See [overview](./overview.md) for details.');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 1);
    const link = helper.links[0]!;
    strictEqual(link.source, 'docs/index.md');
    strictEqual(link.target, 'docs/overview.md');
    strictEqual(link.kind, 'references');
    // Emit value (post signal-resolution, pre post-walk lift) is 0.95,
    // the spec "unambiguous syntax" tier. The lift to 1.0 / downgrade to
    // 0.5 happens later against the full node graph, not here.
    strictEqual(link.confidence, 0.95);
    strictEqual(link.sources[0], 'markdown-link');
  });

  it('strips the anchor fragment and links to the file', async () => {
    const helper = makeContext(mockNode('docs/index.md'), '[api](./api.md#install)');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 1);
    strictEqual(helper.links[0]!.target, 'docs/api.md');
  });

  it('resolves a parent-relative path', async () => {
    const helper = makeContext(mockNode('docs/guide/index.md'), '[root](../README.md)');
    await runAndResolve(helper);
    strictEqual(helper.links[0]!.target, 'docs/README.md');
  });

  it('skips images, URL schemes, and same-doc anchors', async () => {
    const body = [
      '![alt](./img.png)',
      '[home](https://example.com)',
      '[mail](mailto:x@y.com)',
      '[sec](#section)',
    ].join('\n');
    const helper = makeContext(mockNode('docs/index.md'), body);
    await runAndResolve(helper);
    strictEqual(helper.links.length, 0);
    strictEqual(helper.signals.length, 0);
  });

  it('resolves a leading-slash destination from the scan root (GitHub semantics)', async () => {
    const helper = makeContext(
      mockNode('app/context/app-patterns.md'),
      'See [the plan](/docs/plan.md) for details.',
    );
    await runAndResolve(helper);
    strictEqual(helper.links.length, 1);
    const link = helper.links[0]!;
    strictEqual(link.target, 'docs/plan.md');
    strictEqual(link.trigger?.originalTrigger, '/docs/plan.md');
  });

  it('strips the anchor from a leading-slash destination too', async () => {
    const helper = makeContext(mockNode('docs/index.md'), '[x](/docs/api.md#install)');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 1);
    strictEqual(helper.links[0]!.target, 'docs/api.md');
  });

  it('skips leading-slash destinations that normalise to nothing or escape the root', async () => {
    const body = ['[root](/)', '[dbl](//x.md)', '[esc](/../x.md)'].join('\n');
    const helper = makeContext(mockNode('docs/index.md'), body);
    await runAndResolve(helper);
    strictEqual(helper.links.length, 0);
  });

  it('skips links inside fenced code and inline code spans', async () => {
    const body = 'Inline `[x](./x.md)` and:\n```\n[y](./y.md)\n```\n';
    const helper = makeContext(mockNode('docs/index.md'), body);
    await runAndResolve(helper);
    strictEqual(helper.links.length, 0);
  });

  it('deduplicates repeated links to the same resolved target', async () => {
    const helper = makeContext(mockNode('docs/index.md'), '[a](./x.md) and [b](./x.md)');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 1);
    strictEqual(helper.links[0]!.target, 'docs/x.md');
  });

  it('is silent on a body with no markdown links', async () => {
    const helper = makeContext(mockNode('docs/index.md'), 'plain prose, no links here');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 0);
    strictEqual(helper.signals.length, 0);
  });
});
