import { describe, it } from 'node:test';
import { strictEqual } from 'node:assert';

import { backtickSlashExtractor } from '../index.js';
import type { IExtractorContext, IEmittedNode } from '../../../../../kernel/extensions/index.js';
import { resolveSignals } from '../../../../../kernel/orchestrator/resolver.js';
import type { Link, Node, Signal } from '../../../../../kernel/types.js';

function mockNode(path: string): Node {
  return {
    path,
    kind: 'skill',
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
  await backtickSlashExtractor.extract(helper.ctx);
  if (helper.signals.length === 0) return;
  const resolved = resolveSignals({
    signals: helper.signals,
    activeProvider: null,
    extractorOrder: ['backtick-slash'],
  });
  for (const link of resolved.links) helper.links.push(link);
}

describe('backtick-slash extractor', () => {
  it('emits an invokes link for a command inside an inline code span', async () => {
    const helper = makeContext(mockNode('readme.md'), 'run `/deploy` before shipping');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 1);
    const link = helper.links[0]!;
    strictEqual(link.kind, 'invokes');
    strictEqual(link.target, '/deploy');
    strictEqual(link.confidence, 0.8);
    strictEqual(link.sources[0], 'backtick-slash');
    strictEqual(link.occurrences?.[0]?.context, 'inline-code');
  });

  it('emits an invokes link for a command inside a fenced block, tagged code-block', async () => {
    const helper = makeContext(mockNode('readme.md'), 'steps:\n```\n/deploy --wait\n```\n');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 1);
    strictEqual(helper.signals[0]!.context, 'code-block');
    strictEqual(helper.links[0]!.occurrences?.[0]?.context, 'code-block');
  });

  it('keeps a namespaced command as one invocation', async () => {
    const helper = makeContext(mockNode('readme.md'), 'use `/skill-map:explore` here');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 1);
    strictEqual(helper.links[0]!.target, '/skill-map:explore');
  });

  it('deduplicates the same command across a span and a fence', async () => {
    const helper = makeContext(mockNode('readme.md'), 'run `/deploy` and:\n```\n/deploy again\n```\n');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 1);
  });

  it('skips path-like tokens (shell paths, URLs) via the shared guard', async () => {
    const helper = makeContext(
      mockNode('readme.md'),
      'try `cat /etc/passwd` or `ls /api/v1/items` or `https://x.io/docs`',
    );
    await runAndResolve(helper);
    strictEqual(helper.links.length, 0);
  });

  it('does NOT match prose tokens (inverse mask blanks everything outside code)', async () => {
    const helper = makeContext(mockNode('readme.md'), 'run /deploy and see `docs`');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 0);
    strictEqual(helper.signals.length, 0);
  });

  it('emits a bare shell-ish token like /tmp, the resolution gate decides later', async () => {
    // `/tmp` matches the shared grammar; whether it becomes an edge is
    // the resolution gate's call (prune-unresolved-code-triggers), not
    // the extractor's.
    const helper = makeContext(mockNode('readme.md'), 'write to `/tmp` first');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 1);
    strictEqual(helper.links[0]!.occurrences?.[0]?.context, 'inline-code');
  });

  it('is silent on a body with no code regions', async () => {
    const helper = makeContext(mockNode('readme.md'), 'plain prose with /deploy');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 0);
    strictEqual(helper.signals.length, 0);
  });
});
