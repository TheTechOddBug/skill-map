import { describe, it } from 'node:test';
import { strictEqual } from 'node:assert';

import { atFileExtractor } from '../index.js';
import type { IExtractorContext, IEmittedNode } from '../../../../../kernel/extensions/index.js';
import { resolveSignals } from '../../../../../kernel/orchestrator/resolver.js';
import type { Link, Node, Signal } from '../../../../../kernel/types.js';
import { SILENT_EXTENSION_LOGGER } from '../../../../../kernel/adapters/silent-logger.js';

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
  await atFileExtractor.extract(helper.ctx);
  if (helper.signals.length === 0) return;
  const resolved = resolveSignals({
    signals: helper.signals,
    activeProvider: null,
    extractorOrder: ['at-file'],
  });
  for (const link of resolved.links) helper.links.push(link);
}

describe('at-file extractor (core, @-file-picker lenses)', () => {
  it('emits a references link for a sibling file token (known extension)', async () => {
    const helper = makeContext(mockNode('.codex/agents/deployer.toml'), 'hand off to @builder.toml when done');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 1);
    const link = helper.links[0]!;
    strictEqual(link.kind, 'references');
    strictEqual(link.target, '.codex/agents/builder.toml');
    strictEqual(link.confidence, 0.85);
    strictEqual(link.sources[0], 'at-file');
  });

  it('emits a references link for a relative path token', async () => {
    const helper = makeContext(mockNode('.codex/agents/deployer.toml'), 'see @./style.md for rules');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 1);
    strictEqual(helper.links[0]!.kind, 'references');
    strictEqual(helper.links[0]!.target, '.codex/agents/style.md');
  });

  it('resolves a multi-level relative path token (`../../` climbs past one level)', async () => {
    const helper = makeContext(mockNode('.agent/workflows/build.md'), 'consult @../../docs/guide.md before shipping');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 1);
    strictEqual(helper.links[0]!.kind, 'references');
    strictEqual(helper.links[0]!.target, 'docs/guide.md');
  });

  it('emits a references link for a HIDDEN-directory token (`@.claude/minions.md`)', async () => {
    // Live-reported 2026-08-08 (the backtick-path sibling of the same
    // gap): the first-segment anchor demanded an alphanumeric, so a
    // token under a hidden vendor dir matched nowhere, silently.
    const helper = makeContext(mockNode('AGENTS.md'), 'see @.claude/minions.md for the full list');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 1);
    strictEqual(helper.links[0]!.kind, 'references');
    strictEqual(helper.links[0]!.target, '.claude/minions.md');
  });

  it('resolves a ./ prefixed hidden-dir token (`@./.claude/x.md`)', async () => {
    const helper = makeContext(mockNode('docs/index.md'), 'see @./.claude/x.md too');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 1);
    strictEqual(helper.links[0]!.target, 'docs/.claude/x.md');
  });

  it('still skips emails and double-dot typos (`foo@bar.com`, `@..claude/x.md`)', async () => {
    const helper = makeContext(
      mockNode('docs/index.md'),
      'mail foo@bar.com or the broken @..claude/x.md token',
    );
    await runAndResolve(helper);
    strictEqual(helper.links.length, 0);
  });

  it('forms NO edge for a bare handle (no path, no extension)', async () => {
    const helper = makeContext(mockNode('.codex/agents/deployer.toml'), 'brief @reviewer before shipping');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 0);
    strictEqual(helper.signals.length, 0);
  });

  it('skips absolute path tokens', async () => {
    const helper = makeContext(mockNode('x.toml'), 'open @/etc/passwd.txt please');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 0);
    strictEqual(helper.signals.length, 0);
  });

  it('skips tokens inside code spans and fenced blocks', async () => {
    const helper = makeContext(mockNode('x.toml'), 'inline `@foo.md` and:\n```\n@bar.md\n```\n');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 0);
  });

  it('deduplicates a file token repeated in the body', async () => {
    const helper = makeContext(mockNode('a/x.toml'), 'see @notes.md and again @notes.md');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 1);
  });
});
