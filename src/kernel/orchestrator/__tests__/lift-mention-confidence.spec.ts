/**
 * Unit tests for the bd-owi post-resolution confidence bump.
 *
 * Contract:
 *   - `mentions` links whose `normalizedTrigger` (sigil-stripped)
 *     matches a node's `frontmatter.name` index get confidence 1.0.
 *   - `mentions` links whose `target` matches a node's path get
 *     confidence 1.0.
 *   - Unresolved `mentions` stay at their emitted confidence (0.5).
 *   - Non-`mentions` kinds are never touched.
 */

import { describe, it } from 'node:test';
import { strictEqual } from 'node:assert';

import { liftMentionConfidence } from '../lift-mention-confidence.js';
import type { Link, Node } from '../../types.js';

function mockNode(over: Partial<Node>): Node {
  return {
    path: 'fixture.md',
    kind: 'markdown',
    provider: 'core',
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

function mockMention(target: string, normalizedTrigger: string, source = 'src.md'): Link {
  return {
    source,
    target,
    kind: 'mentions',
    confidence: 0.5,
    sources: ['at-directive'],
    trigger: {
      originalTrigger: `@${normalizedTrigger}`,
      normalizedTrigger: `@${normalizedTrigger}`,
    },
  };
}

describe('liftMentionConfidence', () => {
  it('bumps a mention whose trigger matches a node frontmatter.name', () => {
    const nodes = [mockNode({ path: 'a/reviewer.md', frontmatter: { name: 'reviewer' } })];
    const links = [mockMention('@reviewer', 'reviewer')];
    liftMentionConfidence(links, nodes);
    strictEqual(links[0]!.confidence, 1.0);
  });

  it('bumps a mention whose target matches a node path verbatim', () => {
    const nodes = [mockNode({ path: 'helpers/util.md' })];
    const links = [
      {
        source: 'src.md',
        target: 'helpers/util.md',
        kind: 'mentions' as const,
        confidence: 0.5,
        sources: ['custom-extractor'],
        // No trigger: direct path match falls through to the byPath check.
      },
    ];
    liftMentionConfidence(links, nodes);
    strictEqual(links[0]!.confidence, 1.0);
  });

  it('leaves an unresolved mention at its original 0.5', () => {
    const nodes = [mockNode({ path: 'a/reviewer.md', frontmatter: { name: 'reviewer' } })];
    const links = [mockMention('@no-such-handle', 'no-such-handle')];
    liftMentionConfidence(links, nodes);
    strictEqual(links[0]!.confidence, 0.5);
  });

  it('does not touch non-mentions kinds even when they resolve', () => {
    const nodes = [mockNode({ path: 'a/reviewer.md', frontmatter: { name: 'reviewer' } })];
    const references: Link = {
      source: 'src.md',
      target: 'a/reviewer.md',
      kind: 'references',
      confidence: 0.95,
      sources: ['markdown-link'],
    };
    const invokes: Link = {
      source: 'src.md',
      target: '/reviewer',
      kind: 'invokes',
      confidence: 0.8,
      sources: ['slash'],
      trigger: { originalTrigger: '/reviewer', normalizedTrigger: '/reviewer' },
    };
    const links = [references, invokes];
    liftMentionConfidence(links, nodes);
    strictEqual(links[0]!.confidence, 0.95);
    strictEqual(links[1]!.confidence, 0.8);
  });

  it('is a no-op when no mention links are present (early exit)', () => {
    // The helper should not even build the node index when there is
    // nothing to bump; we cannot observe that directly, but we can
    // assert the non-mention link's confidence stays untouched.
    const nodes = [mockNode({ path: 'a/reviewer.md', frontmatter: { name: 'reviewer' } })];
    const links: Link[] = [
      {
        source: 'src.md',
        target: 'a/reviewer.md',
        kind: 'references',
        confidence: 0.95,
        sources: ['markdown-link'],
      },
    ];
    liftMentionConfidence(links, nodes);
    strictEqual(links[0]!.confidence, 0.95);
  });

  it('handles mixed link arrays (resolved + unresolved mentions + other kinds)', () => {
    const nodes = [
      mockNode({ path: 'a/reviewer.md', frontmatter: { name: 'reviewer' } }),
      mockNode({ path: 'b/deploy.md', frontmatter: { name: 'deploy' } }),
    ];
    const links: Link[] = [
      mockMention('@reviewer', 'reviewer'),
      mockMention('@unknown', 'unknown'),
      {
        source: 'src.md',
        target: '/deploy',
        kind: 'invokes',
        confidence: 0.8,
        sources: ['slash'],
        trigger: { originalTrigger: '/deploy', normalizedTrigger: '/deploy' },
      },
    ];
    liftMentionConfidence(links, nodes);
    strictEqual(links[0]!.confidence, 1.0); // resolved mention
    strictEqual(links[1]!.confidence, 0.5); // unresolved mention
    strictEqual(links[2]!.confidence, 0.8); // untouched invokes
  });

  it('normalises the name index against the pre-normalised trigger', () => {
    // The extractor that emitted the link already ran `normalizeTrigger`
    // on the author's `@senior-reviewer` (hyphen → space, lowercase),
    // so the link arrives here as `@senior reviewer`. The helper just
    // strips the sigil and looks up the indexed name. Real flow
    // verified via the `extractors.spec.ts` end-to-end matrix; this
    // test pins the index-lookup half in isolation.
    const nodes = [
      mockNode({ path: 'a/sr.md', frontmatter: { name: 'Senior Reviewer' } }),
    ];
    const links = [mockMention('Senior Reviewer', 'senior reviewer')];
    liftMentionConfidence(links, nodes);
    strictEqual(links[0]!.confidence, 1.0);
  });
});
