import { describe, it } from 'node:test';
import { strictEqual } from 'node:assert';

import { backtickDollarExtractor } from '../index.js';
import type { IExtractorContext, IEmittedNode } from '../../../../../kernel/extensions/index.js';
import { resolveSignals } from '../../../../../kernel/orchestrator/resolver.js';
import type { Link, Node, Signal } from '../../../../../kernel/types.js';

function mockNode(path: string): Node {
  return {
    path,
    kind: 'skill',
    provider: 'codex',
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
  await backtickDollarExtractor.extract(helper.ctx);
  if (helper.signals.length === 0) return;
  const resolved = resolveSignals({
    signals: helper.signals,
    activeProvider: null,
    extractorOrder: ['backtick-dollar'],
  });
  for (const link of resolved.links) helper.links.push(link);
}

describe('backtick-dollar extractor', () => {
  it('emits an invokes link for a skill inside an inline code span', async () => {
    const helper = makeContext(mockNode('readme.md'), 'run `$check-links` before shipping');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 1);
    const link = helper.links[0]!;
    strictEqual(link.kind, 'invokes');
    strictEqual(link.target, '$check-links');
    strictEqual(link.confidence, 0.8);
    strictEqual(link.sources[0], 'backtick-dollar');
    strictEqual(link.occurrences?.[0]?.context, 'inline-code');
  });

  it('emits an invokes link for a skill inside a fenced block, tagged code-block', async () => {
    const helper = makeContext(mockNode('readme.md'), 'steps:\n```\n$check-links --all\n```\n');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 1);
    strictEqual(helper.signals[0]!.context, 'code-block');
    strictEqual(helper.links[0]!.occurrences?.[0]?.context, 'code-block');
  });

  it('deduplicates the same skill across a span and a fence', async () => {
    const helper = makeContext(mockNode('readme.md'), 'run `$deploy` and:\n```\n$deploy again\n```\n');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 1);
  });

  it('never matches uppercase env vars or currency (shared grammar guard)', async () => {
    const helper = makeContext(mockNode('readme.md'), 'try `echo $PATH $HOME` or `pay $5` or `a$b`');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 0);
  });

  it('emits a lowercase shell-var-shaped token, the resolution gate decides later', async () => {
    // `$file` matches the shared grammar; whether it becomes an edge is
    // the resolution gate's call (prune-unresolved-code-triggers), not
    // the extractor's.
    const helper = makeContext(mockNode('readme.md'), 'loop over `$file` entries');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 1);
    strictEqual(helper.links[0]!.occurrences?.[0]?.context, 'inline-code');
  });

  it('does NOT match prose tokens (inverse mask blanks everything outside code)', async () => {
    const helper = makeContext(mockNode('readme.md'), 'run $deploy and see `docs`');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 0);
    strictEqual(helper.signals.length, 0);
  });

  it('is silent on a body with no code regions', async () => {
    const helper = makeContext(mockNode('readme.md'), 'plain prose with $deploy');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 0);
    strictEqual(helper.signals.length, 0);
  });
});
