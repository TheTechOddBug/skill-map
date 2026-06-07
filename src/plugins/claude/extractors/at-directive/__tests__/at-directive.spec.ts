import { describe, it } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';

import { atDirectiveExtractor } from '../index.js';
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

async function runAndResolve(helper: ReturnType<typeof makeContext>): Promise<void> {
  await atDirectiveExtractor.extract(helper.ctx);
  if (helper.signals.length === 0) return;
  const resolved = resolveSignals({
    signals: helper.signals,
    activeProvider: null,
    extractorOrder: ['at-directive'],
  });
  for (const link of resolved.links) helper.links.push(link);
}

describe('at-directive extractor', () => {
  it('emits a mentions link for a bare handle', async () => {
    const helper = makeContext(mockNode('agents/lead.md'), 'ping @team for review');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 1);
    const link = helper.links[0]!;
    strictEqual(link.kind, 'mentions');
    strictEqual(link.target, '@team');
    strictEqual(link.confidence, 0.5);
    strictEqual(link.sources[0], 'at-directive');
  });

  it('emits a references link for a path-flavoured token, resolved against the source dir', async () => {
    const helper = makeContext(mockNode('docs/guide.md'), 'see @./api.md');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 1);
    const link = helper.links[0]!;
    strictEqual(link.kind, 'references');
    strictEqual(link.target, 'docs/api.md');
    strictEqual(link.confidence, 0.85);
  });

  it('treats a known file extension as a reference even without a path prefix', async () => {
    const helper = makeContext(mockNode('readme.md'), 'read @notes.md now');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 1);
    strictEqual(helper.links[0]!.kind, 'references');
    strictEqual(helper.links[0]!.target, 'notes.md');
  });

  it('keeps a namespaced handle (single slash, no extension) as a mention', async () => {
    const helper = makeContext(mockNode('readme.md'), 'use @my-plugin/foo-extractor here');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 1);
    strictEqual(helper.links[0]!.kind, 'mentions');
  });

  it('emits two links for the same handle in mention and file form', async () => {
    const helper = makeContext(mockNode('readme.md'), '@foo and @foo.md');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 2);
    deepStrictEqual(helper.links.map((l) => l.kind).sort(), ['mentions', 'references']);
  });

  it('does not match emails or doubled @', async () => {
    const helper = makeContext(mockNode('readme.md'), 'mail foo@bar.com or @@x');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 0);
    strictEqual(helper.signals.length, 0);
  });

  it('skips tokens inside code spans and fenced blocks', async () => {
    const helper = makeContext(mockNode('readme.md'), 'inline `@team` and:\n```\n@lead\n```\n');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 0);
  });

  it('deduplicates repeated bare handles', async () => {
    const helper = makeContext(mockNode('readme.md'), '@team @team @team');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 1);
  });

  it('is silent on a body with no directives', async () => {
    const helper = makeContext(mockNode('readme.md'), 'plain prose');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 0);
    strictEqual(helper.signals.length, 0);
  });
});
