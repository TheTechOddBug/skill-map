import { describe, it } from 'node:test';
import { strictEqual, deepStrictEqual } from 'node:assert';

import { mcpToolsExtractor } from '../index.js';
import type { IExtractorContext } from '../../../../../kernel/extensions/index.js';
import { resolveSignals } from '../../../../../kernel/orchestrator/resolver.js';
import type { Link, Node, Signal } from '../../../../../kernel/types.js';
import type { IEmittedNode } from '../../../../../kernel/extensions/index.js';
import { SILENT_EXTENSION_LOGGER } from '../../../../../kernel/adapters/silent-logger.js';

function mockNode(path: string, frontmatter: Record<string, unknown> = {}): Node {
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
    frontmatter,
  };
}

function makeContext(node: Node): {
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
    body: '',
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
 * Run the extractor + flush Signals through the kernel resolver so
 * tests can assert on the merged `links` array regardless of whether
 * the extractor used `emitLink` directly or routed through `emitSignal`.
 */
async function runAndResolve(
  helper: ReturnType<typeof makeContext>,
): Promise<void> {
  await mcpToolsExtractor.extract(helper.ctx);
  if (helper.signals.length === 0) return;
  const resolved = resolveSignals({
    signals: helper.signals,
    activeProvider: null,
    extractorOrder: ['mcp-tools'],
  });
  for (const link of resolved.links) helper.links.push(link);
}

describe('mcp-tools extractor', () => {
  it('emits one virtual mcp node per unique server in tools[]', async () => {
    const node = mockNode('.claude/agents/researcher.md', {
      tools: [
        'Read',
        'mcp__github__search',
        'mcp__github__create_issue',
        'mcp__filesystem__read',
      ],
    });
    const helper = makeContext(node);
    await runAndResolve(helper);
    const { virtualNodes } = helper;
    strictEqual(virtualNodes.length, 2, 'github + filesystem, dedup across two github tools');
    deepStrictEqual(virtualNodes.map((n) => n.path).sort(), ['mcp://filesystem', 'mcp://github']);
    for (const vn of virtualNodes) {
      strictEqual(vn.kind, 'mcp');
      strictEqual(vn.virtual, true);
      deepStrictEqual(vn.derivedFrom, ['.claude/agents/researcher.md']);
    }
  });

  it('emits a references link from the source to each mcp node', async () => {
    const node = mockNode('.claude/agents/researcher.md', {
      tools: ['mcp__github__search', 'mcp__filesystem__read'],
    });
    const helper = makeContext(node);
    await runAndResolve(helper);
    const { links } = helper;
    strictEqual(links.length, 2);
    const targets = links.map((l) => l.target).sort();
    deepStrictEqual(targets, ['mcp://filesystem', 'mcp://github']);
    for (const link of links) {
      strictEqual(link.source, '.claude/agents/researcher.md');
      strictEqual(link.kind, 'references');
      strictEqual(link.confidence, 0.85);
      strictEqual(link.sources[0], 'mcp-tools');
      // Regression guard for the URL-partition fix: the `mcp://` scheme
      // would otherwise match `isExternalUrlLink` and the orchestrator
      // would drop the link out of `internalLinks` into the discarded
      // externalLinks bucket. Confirm the trigger payload makes it
      // clear the target is an MCP, not a stray http URL.
      strictEqual(link.trigger?.normalizedTrigger, link.target);
    }
  });

  it('is silent when frontmatter has no tools array', async () => {
    const node = mockNode('.claude/agents/x.md', {});
    const helper = makeContext(node);
    await runAndResolve(helper);
    const { links, virtualNodes } = helper;
    strictEqual(links.length, 0);
    strictEqual(virtualNodes.length, 0);
  });

  it('is silent when tools contains no mcp__ pattern', async () => {
    const node = mockNode('.claude/agents/x.md', { tools: ['Read', 'Bash(git *)'] });
    const helper = makeContext(node);
    await runAndResolve(helper);
    const { links, virtualNodes } = helper;
    strictEqual(links.length, 0);
    strictEqual(virtualNodes.length, 0);
  });

  it('rejects off-pattern entries (case sensitivity is permissive, but separators are strict)', async () => {
    const node = mockNode('.claude/agents/x.md', {
      tools: [
        'mcp__GitHub__search', // upper-case server: accepted, lowercased in path
        'mcp_github_search', // single underscore separator: rejected
        'mcp__github', // no tool segment: rejected
      ],
    });
    const helper = makeContext(node);
    await runAndResolve(helper);
    const { links, virtualNodes } = helper;
    // Only the upper-case `GitHub` entry matches; the path lowercases
    // the server to keep dedup deterministic across casings in tools[].
    strictEqual(virtualNodes.length, 1);
    strictEqual(virtualNodes[0]!.path, 'mcp://github');
    strictEqual(links.length, 1);
  });
});
