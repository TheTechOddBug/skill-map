import { describe, it } from 'node:test';
import { strictEqual } from 'node:assert';

import { dollarSkillExtractor } from '../index.js';
import type { IExtractorContext, IEmittedNode } from '../../../../../kernel/extensions/index.js';
import { resolveSignals } from '../../../../../kernel/orchestrator/resolver.js';
import type { Link, Node, Signal } from '../../../../../kernel/types.js';

function mockNode(path: string): Node {
  return {
    path,
    kind: 'agent',
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
  await dollarSkillExtractor.extract(helper.ctx);
  if (helper.signals.length === 0) return;
  const resolved = resolveSignals({
    signals: helper.signals,
    activeProvider: null,
    extractorOrder: ['dollar-skill'],
  });
  for (const link of resolved.links) helper.links.push(link);
}

describe('dollar-skill extractor', () => {
  it('emits an invokes link for a $skill invocation', async () => {
    const helper = makeContext(mockNode('.codex/agents/builder.toml'), 'first run $check-links to verify');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 1);
    const link = helper.links[0]!;
    strictEqual(link.kind, 'invokes');
    strictEqual(link.target, '$check-links');
    strictEqual(link.confidence, 0.8);
    strictEqual(link.sources[0], 'dollar-skill');
  });

  it('does not match currency, env vars, mid-word $, or $$', async () => {
    const helper = makeContext(mockNode('x.toml'), 'cost $5 and $100, set $PATH and $HOME, token a$b and $$');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 0);
    strictEqual(helper.signals.length, 0);
  });

  it('skips tokens inside code spans and fenced blocks', async () => {
    const helper = makeContext(mockNode('x.toml'), 'inline `$scan` and:\n```\n$refresh\n```\n');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 0);
  });

  it('deduplicates a skill repeated in the body', async () => {
    const helper = makeContext(mockNode('x.toml'), '$deploy now, $deploy again');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 1);
  });

  it('is silent on a body with no $skill invocations', async () => {
    const helper = makeContext(mockNode('x.toml'), 'plain prose without invocations');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 0);
    strictEqual(helper.signals.length, 0);
  });
});
