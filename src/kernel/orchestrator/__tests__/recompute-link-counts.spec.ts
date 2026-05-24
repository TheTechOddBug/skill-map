/**
 * Coverage for `recomputeLinkCounts`. The denormalised
 * `linksInCount` / `linksOutCount` columns on `scan_nodes` drive every
 * read surface that does NOT walk `scan_links` directly: the inspector
 * panel "Linked nodes" badge, the `sm list` IN / OUT columns, the
 * inspector card's `Links X out · Y in` counter, and any future
 * aggregation. Path-style links (markdown `[a](b.md)`) emit with
 * `target === resolvedTarget`, but trigger-style links (Claude
 * `@<handle>`, slash `/<command>`) keep the authored trigger in
 * `target` and store the resolved path in `resolvedTarget` only.
 * Counting purely by `target` undercounts incoming links for every
 * node that is reached by a mention or slash invocation, which was
 * the tutorial finding `demo-agent` / `demo-command` / `demo-skill`
 * surfaced.
 */

import { describe, it } from 'node:test';
import { strictEqual } from 'node:assert';

import { recomputeLinkCounts } from '../extractors.js';
import type { Link, Node } from '../../types.js';

function mockNode(path: string): Node {
  return {
    path,
    kind: 'agent',
    provider: 'claude',
    bodyHash: 'h',
    frontmatterHash: 'h',
    bytes: { total: 0, body: 0, frontmatter: 0 },
    tokens: { total: 0, body: 0, frontmatter: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
  } as unknown as Node;
}

function mockLink(over: Partial<Link>): Link {
  return {
    source: 'src.md',
    target: 't.md',
    kind: 'references',
    confidence: 0.9,
    sources: ['markdown-link'],
    ...over,
  };
}

describe('recomputeLinkCounts', () => {
  it('path-style references count toward `target.linksInCount`', () => {
    const src = mockNode('notes/todo.md');
    const dst = mockNode('docs/guideline.md');
    const links: Link[] = [
      mockLink({ source: 'notes/todo.md', target: 'docs/guideline.md' }),
    ];
    recomputeLinkCounts([src, dst], links);
    strictEqual(src.linksOutCount, 1);
    strictEqual(dst.linksInCount, 1);
  });

  // Regression: trigger-style emits (`mentions`, `invokes`) keep the
  // authored trigger in `link.target` (e.g. `@demo-agent`,
  // `/demo-command`) and store the resolved path in
  // `link.resolvedTarget` after the post-walk lift. Counting by
  // `target` would skip these and leave `linksInCount` at zero for
  // every agent / command / skill reached by mention or slash.
  it('trigger-style mentions count toward the RESOLVED target.linksInCount', () => {
    const src = mockNode('notes/todo.md');
    const agent = mockNode('.claude/agents/demo-agent.md');
    const links: Link[] = [
      mockLink({
        source: 'notes/todo.md',
        target: '@demo-agent',
        resolvedTarget: '.claude/agents/demo-agent.md',
        kind: 'mentions',
        sources: ['at-directive'],
      }),
    ];
    recomputeLinkCounts([src, agent], links);
    strictEqual(src.linksOutCount, 1);
    strictEqual(agent.linksInCount, 1);
  });

  it('slash invokes count toward the RESOLVED target.linksInCount', () => {
    const src = mockNode('notes/todo.md');
    const cmd = mockNode('.claude/commands/demo-command.md');
    const links: Link[] = [
      mockLink({
        source: 'notes/todo.md',
        target: '/demo-command',
        resolvedTarget: '.claude/commands/demo-command.md',
        kind: 'invokes',
        sources: ['slash'],
      }),
    ];
    recomputeLinkCounts([src, cmd], links);
    strictEqual(src.linksOutCount, 1);
    strictEqual(cmd.linksInCount, 1);
  });

  it('unresolved trigger (no resolvedTarget): falls back to target verbatim, does not crash', () => {
    const src = mockNode('notes/todo.md');
    const links: Link[] = [
      mockLink({
        source: 'notes/todo.md',
        target: '@dangling-handle',
        kind: 'mentions',
        sources: ['at-directive'],
      }),
    ];
    recomputeLinkCounts([src], links);
    strictEqual(src.linksOutCount, 1);
    // No node matches the bare trigger, nothing to increment, but the
    // source still gets its outgoing count.
  });

  it('resets prior counts on re-run (idempotent across scans)', () => {
    const src = mockNode('a.md');
    src.linksOutCount = 7; // stale from a prior scan
    const dst = mockNode('b.md');
    dst.linksInCount = 4; // stale from a prior scan
    const links: Link[] = [mockLink({ source: 'a.md', target: 'b.md' })];
    recomputeLinkCounts([src, dst], links);
    strictEqual(src.linksOutCount, 1);
    strictEqual(dst.linksInCount, 1);
  });
});
