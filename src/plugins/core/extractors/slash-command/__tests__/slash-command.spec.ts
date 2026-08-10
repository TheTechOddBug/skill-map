import { describe, it } from 'node:test';
import { strictEqual, deepStrictEqual } from 'node:assert';

import { slashCommandExtractor } from '../index.js';
import type { IExtractorContext, IEmittedNode } from '../../../../../kernel/extensions/index.js';
import { resolveSignals } from '../../../../../kernel/orchestrator/resolver.js';
import type { Link, Node, Signal } from '../../../../../kernel/types.js';
import { SILENT_EXTENSION_LOGGER } from '../../../../../kernel/adapters/silent-logger.js';

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
    log: SILENT_EXTENSION_LOGGER,
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
  await slashCommandExtractor.extract(helper.ctx);
  if (helper.signals.length === 0) return;
  const resolved = resolveSignals({
    signals: helper.signals,
    activeProvider: null,
    extractorOrder: ['slash-command'],
  });
  for (const link of resolved.links) helper.links.push(link);
}

describe('slash-command extractor', () => {
  it('authorises the slash grammar under claude, antigravity, and opencode only', () => {
    // Locks the shared `/`-invocation precondition: the lenses whose runtimes
    // invoke a command / skill / workflow with `/<name>`. Codex is deliberately
    // absent (it reserves `/` for its built-ins and invokes skills with `$`).
    // OpenCode resolves `/<name>` to its `.opencode/commands/` (its provider
    // declares `invokes: ['command']`); dropping it here would silently kill
    // that edge, so this assertion guards the precondition against regressions.
    deepStrictEqual(slashCommandExtractor.precondition?.provider, [
      'claude',
      'antigravity',
      'opencode',
    ]);
  });

  it('emits an invokes link for a slash command', async () => {
    const helper = makeContext(mockNode('cmds/deploy.md'), 'run /deploy to ship');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 1);
    const link = helper.links[0]!;
    strictEqual(link.kind, 'invokes');
    strictEqual(link.target, '/deploy');
    strictEqual(link.confidence, 0.8);
    strictEqual(link.sources[0], 'slash-command');
  });

  it('matches a namespaced slash command', async () => {
    const helper = makeContext(mockNode('x.md'), 'then /skill-map:explore the graph');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 1);
    strictEqual(helper.links[0]!.target, '/skill-map:explore');
  });

  it('does not match file paths or URL paths', async () => {
    const helper = makeContext(mockNode('x.md'), 'open src/cli and https://x.com/api/v1 and /api/v1/items');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 0);
    strictEqual(helper.signals.length, 0);
  });

  it('does not match purely numeric tokens (fractions / scores are prose)', async () => {
    // Field report 2026-08-10: "Run the Quick Self-Test (5 dimensions,
    // 0-2 each, total /10)." emitted an invokes for `/10` that surfaced
    // as a red reference-broken. No real command name is all digits.
    const helper = makeContext(
      mockNode('x.md'),
      'Quick Self-Test (5 dimensions, 0-2 each, total /10). Rate it /5 and log /10:30 as the slot.',
    );
    await runAndResolve(helper);
    strictEqual(helper.links.length, 0);
    strictEqual(helper.signals.length, 0);
  });

  it('still matches digit-leading commands that carry a letter', async () => {
    const helper = makeContext(mockNode('x.md'), 'run /2fa-setup before shipping');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 1);
    strictEqual(helper.links[0]!.target, '/2fa-setup');
  });

  it('skips tokens inside code spans and fenced blocks', async () => {
    const helper = makeContext(mockNode('x.md'), 'inline `/scan` and:\n```\n/refresh\n```\n');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 0);
  });

  it('deduplicates a command repeated in the body', async () => {
    const helper = makeContext(mockNode('x.md'), '/deploy now, /deploy again');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 1);
  });

  it('is silent on a body with no slash commands', async () => {
    const helper = makeContext(mockNode('x.md'), 'plain prose without commands');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 0);
    strictEqual(helper.signals.length, 0);
  });
});
