/**
 * Coverage for the `core/link-self-loop` built-in rule
 * (`plugins/core/analyzers/link-self-loop/index.ts`).
 *
 * Behaviour pinned by these tests:
 *   - One `warn` issue per link whose source equals either its
 *     `target` (path-style self-loop) or its `resolvedTarget` (trigger-
 *     style self-loop resolved by name).
 *   - Links that are not self-loops are silently skipped.
 *   - The issue's `data.target` matches the link's `target` so
 *     consumers can correlate per-row.
 *   - Empty links list yields zero issues (cheap no-op).
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { linkSelfLoopAnalyzer } from '../index.js';
import type { IAnalyzerContext } from '../../../../../kernel/extensions/index.js';
import type { Link, Node } from '../../../../../kernel/types.js';
import { SILENT_EXTENSION_LOGGER } from '../../../../../kernel/adapters/silent-logger.js';

function mockNode(over: Partial<Node>): Node {
  return {
    path: 'fixture.md',
    kind: 'command',
    provider: 'claude',
    bodyHash: '0'.repeat(64),
    frontmatterHash: '0'.repeat(64),
    bytes: { frontmatter: 0, body: 0, total: 0 },
    frontmatter: {},
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
    ...over,
  };
}

function mockLink(over: Partial<Link>): Link {
  return {
    source: 'fixture.md',
    target: 'fixture.md',
    kind: 'invokes',
    confidence: 1.0,
    sources: ['slash'],
    ...over,
  };
}

function ctxWith(over: Partial<IAnalyzerContext>): IAnalyzerContext {
  return {
    nodes: [],
    links: [],
    settings: {},
    log: SILENT_EXTENSION_LOGGER,
    emitContribution: () => {
      /* unused */
    },
    ...over,
  };
}

describe('core/link-self-loop rule', () => {
  it('emits no issues when links is empty', async () => {
    const issues = await linkSelfLoopAnalyzer.evaluate!(ctxWith({}));
    assert.deepEqual(issues, []);
  });

  it('emits a warn per path-style self-loop', async () => {
    // `[md](./real-command.md)` from inside `real-command.md` resolves
    // to itself path-style. The lift transform left link.target as the
    // path, source === target = self-loop.
    const cmd = mockNode({
      path: '.claude/commands/real-command.md',
      kind: 'command',
      frontmatter: { name: 'real-command' },
    });
    const selfLoop = mockLink({
      source: cmd.path,
      target: cmd.path,
      kind: 'references',
      confidence: 1.0,
      sources: ['markdown-link'],
    });
    const issues = await linkSelfLoopAnalyzer.evaluate!(
      ctxWith({ nodes: [cmd], links: [selfLoop] }),
    );
    assert.equal(issues.length, 1);
    const issue = issues[0]!;
    assert.equal(issue.severity, 'warn');
    assert.equal(issue.analyzerId, 'link-self-loop');
    assert.deepEqual(issue.nodeIds, [cmd.path]);
    const data = issue.data as Record<string, unknown>;
    assert.equal(data['target'], cmd.path);
  });

  it('emits a warn per trigger-style self-loop (resolved by name)', async () => {
    // `# /real-command` inside `real-command.md`'s body. The slash
    // extractor emits `target: '/real-command'`; the post-walk lift
    // resolves the trigger back to `real-command.md` via the name
    // index and writes `resolvedTarget` accordingly.
    const cmd = mockNode({
      path: '.claude/commands/real-command.md',
      kind: 'command',
      frontmatter: { name: 'real-command' },
    });
    const triggerLoop = mockLink({
      source: cmd.path,
      target: '/real-command',
      kind: 'invokes',
      confidence: 1.0,
      sources: ['slash'],
      trigger: { originalTrigger: '/real-command', normalizedTrigger: '/real command' },
      resolvedTarget: cmd.path,
    });
    const issues = await linkSelfLoopAnalyzer.evaluate!(
      ctxWith({ nodes: [cmd], links: [triggerLoop] }),
    );
    assert.equal(issues.length, 1);
    const issue = issues[0]!;
    assert.equal(issue.severity, 'warn');
    const data = issue.data as Record<string, unknown>;
    assert.equal(data['target'], '/real-command');
    assert.equal(data['resolvedTarget'], cmd.path);
    assert.match(issue.message, /Self-reference/);
  });

  it('does NOT emit for a self-loop sourced only from code regions (usage example)', async () => {
    // A backticked `/real-command` inside the very doc that defines it:
    // the canonical usage-example shape (`core/backtick-slash` emission,
    // occurrence context = code region). The link exists but the warn
    // is skipped per the code-region exemption.
    const cmd = mockNode({
      path: '.claude/commands/real-command.md',
      kind: 'command',
      frontmatter: { name: 'real-command' },
    });
    const usageLoop = mockLink({
      source: cmd.path,
      target: '/real-command',
      kind: 'invokes',
      confidence: 1.0,
      sources: ['backtick-slash'],
      trigger: { originalTrigger: '/real-command', normalizedTrigger: '/real command' },
      resolvedTarget: cmd.path,
      occurrences: [
        {
          extractor: 'backtick-slash',
          originalTrigger: '/real-command',
          context: 'inline-code',
          location: { line: 2 },
        },
      ],
    });
    const issues = await linkSelfLoopAnalyzer.evaluate!(
      ctxWith({ nodes: [cmd], links: [usageLoop] }),
    );
    assert.deepEqual(issues, []);
  });

  it('still emits when a self-loop mixes a prose occurrence with code-region ones', async () => {
    const cmd = mockNode({
      path: '.claude/commands/real-command.md',
      kind: 'command',
      frontmatter: { name: 'real-command' },
    });
    const mixedLoop = mockLink({
      source: cmd.path,
      target: '/real-command',
      kind: 'invokes',
      confidence: 1.0,
      sources: ['slash-command', 'backtick-slash'],
      trigger: { originalTrigger: '/real-command', normalizedTrigger: '/real command' },
      resolvedTarget: cmd.path,
      occurrences: [
        { extractor: 'slash-command', originalTrigger: '/real-command', location: { line: 1 } },
        {
          extractor: 'backtick-slash',
          originalTrigger: '/real-command',
          context: 'inline-code',
          location: { line: 2 },
        },
      ],
    });
    const issues = await linkSelfLoopAnalyzer.evaluate!(
      ctxWith({ nodes: [cmd], links: [mixedLoop] }),
    );
    assert.equal(issues.length, 1);
  });

  it('does NOT emit for normal cross-node links', async () => {
    const src = mockNode({ path: 'a.md' });
    const dst = mockNode({ path: 'b.md' });
    const cross = mockLink({ source: src.path, target: dst.path });
    const issues = await linkSelfLoopAnalyzer.evaluate!(
      ctxWith({ nodes: [src, dst], links: [cross] }),
    );
    assert.deepEqual(issues, []);
  });

  it('does NOT emit when resolvedTarget points elsewhere', async () => {
    // The link `/something` resolved to a DIFFERENT node, not the
    // source. Not a self-loop.
    const src = mockNode({ path: 'a.md' });
    const dst = mockNode({ path: 'b.md' });
    const link = mockLink({
      source: src.path,
      target: '/something',
      resolvedTarget: dst.path,
    });
    const issues = await linkSelfLoopAnalyzer.evaluate!(
      ctxWith({ nodes: [src, dst], links: [link] }),
    );
    assert.deepEqual(issues, []);
  });
});
