import { describe, it } from 'node:test';
import { strictEqual } from 'node:assert';

import { backtickMentionExtractor } from '../index.js';
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
  await backtickMentionExtractor.extract(helper.ctx);
  if (helper.signals.length === 0) return;
  const resolved = resolveSignals({
    signals: helper.signals,
    activeProvider: null,
    extractorOrder: ['backtick-mention'],
  });
  for (const link of resolved.links) helper.links.push(link);
}

describe('backtick-mention extractor', () => {
  it('emits a mentions link for a bare handle inside an inline code span', async () => {
    const helper = makeContext(mockNode('skills/deploy.md'), 'hand it to `@reviewer` after');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 1);
    const link = helper.links[0]!;
    strictEqual(link.kind, 'mentions');
    strictEqual(link.target, '@reviewer');
    strictEqual(link.confidence, 0.5);
    strictEqual(link.sources[0], 'backtick-mention');
    strictEqual(link.occurrences?.[0]?.context, 'inline-code');
  });

  it('emits a mentions link for a bare handle inside a fenced block, tagged code-block', async () => {
    const helper = makeContext(mockNode('readme.md'), 'template:\n```text\n@reviewer check it\n```\n');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 1);
    strictEqual(helper.signals[0]!.context, 'code-block');
    strictEqual(helper.links[0]!.occurrences?.[0]?.context, 'code-block');
  });

  it('deduplicates the same handle across a span and a fence (first occurrence wins)', async () => {
    const helper = makeContext(
      mockNode('readme.md'),
      'use `@reviewer` and:\n```\n@reviewer again\n```\n',
    );
    await runAndResolve(helper);
    strictEqual(helper.links.length, 1);
    strictEqual(helper.links[0]!.occurrences?.[0]?.context, 'inline-code');
  });

  it('emits several distinct handles from one span', async () => {
    const helper = makeContext(mockNode('readme.md'), 'route via `@triage then @reviewer`');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 2);
  });

  it('does NOT match prose tokens (inverse mask blanks everything outside code)', async () => {
    const helper = makeContext(mockNode('readme.md'), 'ping @team and see `docs`');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 0);
    strictEqual(helper.signals.length, 0);
  });

  it('skips file-shaped tokens (backtick-path territory) and absolute paths', async () => {
    const helper = makeContext(
      mockNode('readme.md'),
      'open `@docs/api.md` or `@./local` or `@/abs/path`',
    );
    await runAndResolve(helper);
    strictEqual(helper.links.length, 0);
  });

  it('does not match emails or doubled @ inside code regions', async () => {
    const helper = makeContext(mockNode('readme.md'), 'run `mail foo@bar.com` or `@@x`');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 0);
  });

  it('keeps a namespaced handle (npm-scope shape) as a candidate, the gate decides later', async () => {
    // `@changesets/cli` matches the shared grammar; whether it becomes
    // an edge is the resolution gate's call (prune-unresolved-code-
    // mentions), not the extractor's.
    const helper = makeContext(mockNode('readme.md'), 'install `@changesets/cli` first');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 1);
    strictEqual(helper.links[0]!.occurrences?.[0]?.context, 'inline-code');
  });

  it('is silent on a body with no code regions', async () => {
    const helper = makeContext(mockNode('readme.md'), 'plain prose with @handle');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 0);
    strictEqual(helper.signals.length, 0);
  });
});
