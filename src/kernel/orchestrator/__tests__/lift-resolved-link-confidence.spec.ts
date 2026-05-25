/**
 * Unit tests for the provider-aware post-resolution confidence bump
 * (formerly `liftMentionConfidence`, generalised in bd-4k5 to cover
 * `invokes` and `references` per the source Provider's `resolution`
 * matrix and the target kind's declared `identifiers`).
 *
 * Contract:
 *   - Rule 1 (path match, any link.kind): `link.target` equals some
 *     node's `path` ⇒ confidence bumped to 1.0.
 *   - Rule 2 (name match, links with `trigger.normalizedTrigger`):
 *     stripped trigger matches a node's identifier (per the kind's
 *     declared `identifiers` sources: `frontmatter.name`,
 *     `filename-basename`, `dirname`) AND the candidate node's kind
 *     is in `provider.resolution[link.kind]` for the SOURCE node's
 *     provider ⇒ bumped to 1.0.
 *   - Links already at >= 1.0 are untouched (cheap idempotency).
 *   - Empty / missing trigger short-circuits the name rule.
 *   - Empty / missing source-provider resolution map → no name-rule
 *     bump (path-rule still fires independently).
 */

import { describe, it } from 'node:test';
import { strictEqual, deepStrictEqual } from 'node:assert';

import {
  liftResolvedLinkConfidence,
  RESERVED_TARGET_CONFIDENCE,
} from '../lift-resolved-link-confidence.js';
import type { IPostWalkTransformCtx } from '../post-walk-transforms.js';
import type { IProviderKind } from '../../extensions/index.js';
import type { Link, Node } from '../../types.js';

function mockNode(over: Partial<Node>): Node {
  return {
    path: 'fixture.md',
    kind: 'agent',
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

function mockSlash(target: string, normalizedTrigger: string, source = 'src.md'): Link {
  return {
    source,
    target,
    kind: 'invokes',
    confidence: 0.8,
    sources: ['slash'],
    trigger: {
      originalTrigger: normalizedTrigger,
      normalizedTrigger,
    },
  };
}

function makeKind(identifiers: IProviderKind['identifiers']): IProviderKind {
  return {
    schema: 'fake.json',
    schemaJson: {},
    ui: { label: 'X', color: '#000' },
    ...(identifiers !== undefined ? { identifiers } : {}),
  };
}

/**
 * Reusable ctx mimicking the real built-in registry for the
 * `claude` provider (agent + command + skill) and a stub `source.md`
 * that lives under `claude`. Tests that need a different provider
 * override `providerResolution`.
 */
function makeCtx(over?: Partial<IPostWalkTransformCtx>): IPostWalkTransformCtx {
  const kindRegistry = new Map<string, IProviderKind>([
    ['claude/agent', makeKind(['frontmatter.name', 'filename-basename'])],
    ['claude/command', makeKind(['frontmatter.name', 'filename-basename'])],
    ['claude/skill', makeKind(['frontmatter.name', 'dirname'])],
    ['core/markdown', makeKind([])],
  ]);
  const providerResolution = new Map<string, Record<string, readonly string[]>>([
    ['claude', { mentions: ['agent'], invokes: ['command', 'skill'] }],
  ]);
  const reservedNodePaths = new Set<string>();
  return {
    kindRegistry,
    providerResolution,
    activeProvider: 'claude',
    reservedNodePaths,
    ...over,
  };
}

describe('liftResolvedLinkConfidence', () => {
  it('bumps an at-directive references link whose target matches a node path', () => {
    const nodes = [
      mockNode({ path: '.claude/agents/reviewer.md', kind: 'agent', frontmatter: { name: 'reviewer' } }),
      mockNode({ path: '.claude/agents/src.md', kind: 'agent', frontmatter: { name: 'src' } }),
    ];
    const links: Link[] = [
      {
        source: '.claude/agents/src.md',
        target: '.claude/agents/reviewer.md',
        kind: 'references',
        confidence: 0.85,
        sources: ['at-directive'],
        trigger: {
          originalTrigger: '@./reviewer.md',
          normalizedTrigger: '.claude/agents/reviewer.md',
        },
      },
    ];
    liftResolvedLinkConfidence(links, nodes, makeCtx());
    strictEqual(links[0]!.confidence, 1.0);
  });

  it('bumps a mention via frontmatter.name on an agent target', () => {
    const nodes = [
      mockNode({ path: '.claude/agents/src.md', kind: 'agent', frontmatter: { name: 'src' } }),
      mockNode({
        path: '.claude/agents/reviewer.md',
        kind: 'agent',
        frontmatter: { name: 'reviewer' },
      }),
    ];
    const links = [mockMention('@reviewer', 'reviewer', '.claude/agents/src.md')];
    liftResolvedLinkConfidence(links, nodes, makeCtx());
    strictEqual(links[0]!.confidence, 1.0);
  });

  it('bumps a mention via filename-basename when the target lacks frontmatter.name', () => {
    // `.claude/agents/orphan.md` without a `name:` field still resolves
    // because `claude/agent.identifiers` includes `filename-basename`.
    const nodes = [
      mockNode({ path: '.claude/agents/src.md', kind: 'agent', frontmatter: { name: 'src' } }),
      mockNode({ path: '.claude/agents/orphan.md', kind: 'agent', frontmatter: {} }),
    ];
    const links = [mockMention('@orphan', 'orphan', '.claude/agents/src.md')];
    liftResolvedLinkConfidence(links, nodes, makeCtx());
    strictEqual(links[0]!.confidence, 1.0);
  });

  it('bumps a slash invokes against a command via frontmatter.name', () => {
    const nodes = [
      mockNode({ path: '.claude/agents/src.md', kind: 'agent', frontmatter: { name: 'src' } }),
      mockNode({
        path: '.claude/commands/deploy.md',
        kind: 'command',
        frontmatter: { name: 'deploy' },
      }),
    ];
    const links = [mockSlash('/deploy', '/deploy', '.claude/agents/src.md')];
    liftResolvedLinkConfidence(links, nodes, makeCtx());
    strictEqual(links[0]!.confidence, 1.0);
  });

  it('bumps a slash invokes against a skill via dirname (Anthropic skills convention)', () => {
    // No frontmatter.name on the skill; only the dirname between
    // `.claude/skills/` and `/SKILL.md` resolves the trigger.
    const nodes = [
      mockNode({ path: '.claude/agents/src.md', kind: 'agent', frontmatter: { name: 'src' } }),
      mockNode({ path: '.claude/skills/explore/SKILL.md', kind: 'skill', frontmatter: {} }),
    ];
    const links = [mockSlash('/explore', '/explore', '.claude/agents/src.md')];
    liftResolvedLinkConfidence(links, nodes, makeCtx());
    strictEqual(links[0]!.confidence, 1.0);
  });

  it('does NOT bump slash invokes against an agent (strict kind matrix)', () => {
    // `/foo` matching an agent named `foo` must NOT bump: Claude's
    // resolution map for `invokes` lists only ['command', 'skill'].
    // Mentions surface (@foo) is the right link.kind for an agent;
    // the link-conflict / kind-mismatch analyzers handle the rest.
    const nodes = [
      mockNode({ path: '.claude/agents/src.md', kind: 'agent', frontmatter: { name: 'src' } }),
      mockNode({ path: '.claude/agents/foo.md', kind: 'agent', frontmatter: { name: 'foo' } }),
    ];
    const links = [mockSlash('/foo', '/foo', '.claude/agents/src.md')];
    liftResolvedLinkConfidence(links, nodes, makeCtx());
    strictEqual(links[0]!.confidence, 0.8);
  });

  it('does NOT bump a mention pointing at a command (strict kind matrix)', () => {
    // `@deploy` resolving to a command (not an agent) stays unbumped.
    const nodes = [
      mockNode({ path: '.claude/agents/src.md', kind: 'agent', frontmatter: { name: 'src' } }),
      mockNode({
        path: '.claude/commands/deploy.md',
        kind: 'command',
        frontmatter: { name: 'deploy' },
      }),
    ];
    const links = [mockMention('@deploy', 'deploy', '.claude/agents/src.md')];
    liftResolvedLinkConfidence(links, nodes, makeCtx());
    strictEqual(links[0]!.confidence, 0.5);
  });

  it('bumps a mention sourced from a universal-provider body under the active lens', () => {
    // Per `spec/architecture.md` §Provider · resolution rules, the
    // resolver authority is the ACTIVE PROVIDER LENS, not the source
    // node's provider. A `@handle` in `CLAUDE.md` (classified by
    // `core/markdown`) under the `claude` lens parses as a claude
    // mention (extractor gate) AND resolves against
    // claude's `resolution.mentions` (resolver gate). The two gates
    // mirror so trigger-style links emitted from universal-provider
    // bodies never get stuck at the extractor-emitted confidence.
    const nodes = [
      mockNode({
        path: 'CLAUDE.md',
        kind: 'markdown',
        provider: 'core',
        frontmatter: { name: 'src' },
      }),
      mockNode({
        path: '.claude/agents/reviewer.md',
        kind: 'agent',
        provider: 'claude',
        frontmatter: { name: 'reviewer' },
      }),
    ];
    const links = [mockMention('@reviewer', 'reviewer', 'CLAUDE.md')];
    liftResolvedLinkConfidence(links, nodes, makeCtx());
    strictEqual(links[0]!.confidence, 1);
    strictEqual(links[0]!.resolvedTarget, '.claude/agents/reviewer.md');
  });

  it('does NOT bump trigger-style links when the project is unlensed (activeProvider === null)', () => {
    // An unlensed project (no `activeProvider` setting, no filesystem
    // marker) short-circuits the name path uniformly. Path-match still
    // fires independently; this case asserts the trigger path alone
    // stays unresolved.
    const nodes = [
      mockNode({ path: '.claude/agents/src.md', kind: 'agent', frontmatter: { name: 'src' } }),
      mockNode({
        path: '.claude/agents/reviewer.md',
        kind: 'agent',
        frontmatter: { name: 'reviewer' },
      }),
    ];
    const links = [mockMention('@reviewer', 'reviewer', '.claude/agents/src.md')];
    liftResolvedLinkConfidence(links, nodes, makeCtx({ activeProvider: null }));
    strictEqual(links[0]!.confidence, 0.5);
  });

  it('Finding 2 regression: /command from a markdown body resolves to the matching command node', () => {
    // sm-tutorial Finding 2: a `/demo-command` slash authored inside
    // `notes/todo.md` (universal-provider body) under the `claude`
    // lens used to stay at confidence 0.8 because the resolver keyed
    // on the source node's provider (`markdown`, no resolution map).
    // With the lens-driven resolver the link bumps to 1.0 and
    // populates `resolvedTarget` so `linksInCount` increments on the
    // command node.
    const nodes = [
      mockNode({
        path: 'notes/todo.md',
        kind: 'markdown',
        provider: 'core',
        frontmatter: { name: 'todo' },
      }),
      mockNode({
        path: '.claude/commands/demo-command.md',
        kind: 'command',
        provider: 'claude',
        frontmatter: { name: 'demo-command' },
      }),
    ];
    const links: Link[] = [
      {
        source: 'notes/todo.md',
        target: '/demo-command',
        kind: 'invokes',
        confidence: 0.8,
        sources: ['slash-command'],
        trigger: {
          originalTrigger: '/demo-command',
          // Matches what `normalizeTrigger('/demo-command')` produces:
          // hyphen → space, sigil preserved. The resolver's
          // `stripTriggerSigil` removes the sigil and the resulting
          // `demo command` keys against the cross-kind name index,
          // which `deriveNodeIdentifiers` populates with the same
          // normalised form (`demo command`) from the command node's
          // `frontmatter.name`.
          normalizedTrigger: '/demo command',
        },
      },
    ];
    liftResolvedLinkConfidence(links, nodes, makeCtx());
    strictEqual(links[0]!.confidence, 1);
    strictEqual(links[0]!.resolvedTarget, '.claude/commands/demo-command.md');
  });

  it('leaves a link already at 1.0 untouched', () => {
    const nodes = [
      mockNode({ path: '.claude/agents/src.md', kind: 'agent', frontmatter: { name: 'src' } }),
      mockNode({
        path: '.claude/agents/reviewer.md',
        kind: 'agent',
        frontmatter: { name: 'reviewer' },
      }),
    ];
    const links: Link[] = [
      {
        source: '.claude/agents/src.md',
        target: '.claude/agents/reviewer.md',
        kind: 'references',
        confidence: 1.0,
        sources: ['markdown-link'],
        trigger: {
          originalTrigger: '[reviewer](./reviewer.md)',
          normalizedTrigger: '.claude/agents/reviewer.md',
        },
      },
    ];
    liftResolvedLinkConfidence(links, nodes, makeCtx());
    strictEqual(links[0]!.confidence, 1.0);
  });

  it('is idempotent: re-running on the same input does not change confidences', () => {
    const nodes = [
      mockNode({ path: '.claude/agents/src.md', kind: 'agent', frontmatter: { name: 'src' } }),
      mockNode({
        path: '.claude/agents/reviewer.md',
        kind: 'agent',
        frontmatter: { name: 'reviewer' },
      }),
    ];
    const links = [mockMention('@reviewer', 'reviewer', '.claude/agents/src.md')];
    liftResolvedLinkConfidence(links, nodes, makeCtx());
    const after1 = links[0]!.confidence;
    liftResolvedLinkConfidence(links, nodes, makeCtx());
    strictEqual(links[0]!.confidence, after1);
  });

  it('short-circuits when no link is below 1.0', () => {
    // Cheap guard: if every link is already at 1.0, the indexes are
    // never built. Observable via the confidences staying equal.
    const nodes = [
      mockNode({ path: '.claude/agents/src.md', kind: 'agent', frontmatter: { name: 'src' } }),
    ];
    const links: Link[] = [
      {
        source: '.claude/agents/src.md',
        target: 'whatever.md',
        kind: 'references',
        confidence: 1.0,
        sources: ['markdown-link'],
      },
    ];
    liftResolvedLinkConfidence(links, nodes, makeCtx());
    deepStrictEqual(
      links.map((l) => l.confidence),
      [1.0],
    );
  });

  it('handles mixed link arrays (resolved mention + unresolved slash + already-1.0 reference)', () => {
    const nodes = [
      mockNode({ path: '.claude/agents/src.md', kind: 'agent', frontmatter: { name: 'src' } }),
      mockNode({
        path: '.claude/agents/reviewer.md',
        kind: 'agent',
        frontmatter: { name: 'reviewer' },
      }),
      mockNode({
        path: '.claude/commands/deploy.md',
        kind: 'command',
        frontmatter: { name: 'deploy' },
      }),
    ];
    const links: Link[] = [
      mockMention('@reviewer', 'reviewer', '.claude/agents/src.md'),
      mockSlash('/unknown', '/unknown', '.claude/agents/src.md'),
      {
        source: '.claude/agents/src.md',
        target: '.claude/commands/deploy.md',
        kind: 'references',
        confidence: 1.0,
        sources: ['markdown-link'],
      },
    ];
    liftResolvedLinkConfidence(links, nodes, makeCtx());
    strictEqual(links[0]!.confidence, 1.0); // resolved mention
    strictEqual(links[1]!.confidence, 0.8); // unresolved slash
    strictEqual(links[2]!.confidence, 1.0); // untouched
  });

  it('normalises identifiers against the pre-normalised trigger', () => {
    // Extractor emitted normalizedTrigger `@senior reviewer` (hyphen
    // collapsed). The name index also stores `senior reviewer`
    // (frontmatter.name `Senior Reviewer` normalises identically).
    const nodes = [
      mockNode({ path: '.claude/agents/src.md', kind: 'agent', frontmatter: { name: 'src' } }),
      mockNode({
        path: '.claude/agents/sr.md',
        kind: 'agent',
        frontmatter: { name: 'Senior Reviewer' },
      }),
    ];
    const links = [mockMention('Senior Reviewer', 'senior reviewer', '.claude/agents/src.md')];
    liftResolvedLinkConfidence(links, nodes, makeCtx());
    strictEqual(links[0]!.confidence, 1.0);
  });

  it('downgrades a slash invokes resolving to a reserved command (name match)', () => {
    // User-authored `.claude/commands/help.md` is shadowed by Claude's
    // built-in `/help`. The slash still resolves by name (and kind
    // matrix permits command), so the bump runs, but the result is
    // RESERVED_TARGET_CONFIDENCE, not 1.0.
    const nodes = [
      mockNode({ path: '.claude/agents/src.md', kind: 'agent', frontmatter: { name: 'src' } }),
      mockNode({
        path: '.claude/commands/help.md',
        kind: 'command',
        frontmatter: { name: 'help' },
      }),
    ];
    const links = [mockSlash('/help', '/help', '.claude/agents/src.md')];
    const ctx = makeCtx({ reservedNodePaths: new Set(['.claude/commands/help.md']) });
    liftResolvedLinkConfidence(links, nodes, ctx);
    strictEqual(links[0]!.confidence, RESERVED_TARGET_CONFIDENCE);
  });

  it('downgrades an at-directive references resolving to a reserved target (path match)', () => {
    // `@./help.md` resolves by path to the reserved file. Path match
    // is the rule that fires; the downgrade still applies because the
    // resolved target is in reservedNodePaths.
    const nodes = [
      mockNode({ path: '.claude/agents/src.md', kind: 'agent', frontmatter: { name: 'src' } }),
      mockNode({
        path: '.claude/commands/help.md',
        kind: 'command',
        frontmatter: { name: 'help' },
      }),
    ];
    const links: Link[] = [
      {
        source: '.claude/agents/src.md',
        target: '.claude/commands/help.md',
        kind: 'references',
        confidence: 0.85,
        sources: ['at-directive'],
        trigger: {
          originalTrigger: '@../commands/help.md',
          normalizedTrigger: '.claude/commands/help.md',
        },
      },
    ];
    const ctx = makeCtx({ reservedNodePaths: new Set(['.claude/commands/help.md']) });
    liftResolvedLinkConfidence(links, nodes, ctx);
    strictEqual(links[0]!.confidence, RESERVED_TARGET_CONFIDENCE);
  });

  it('does NOT downgrade when the trigger has multiple candidates and a non-reserved one wins', () => {
    // Two candidates for `/help`: a reserved command, AND a skill
    // (also resolves under claude.invokes = [command, skill]). The
    // candidate finder picks the first one whose kind is allowed; if
    // it happens to be the non-reserved skill, the bump goes to 1.0.
    // Order matters; the resolver visits candidates in node-iteration
    // order. Test the explicit case where the non-reserved skill is
    // FIRST in the candidate array.
    const nodes = [
      mockNode({ path: '.claude/agents/src.md', kind: 'agent', frontmatter: { name: 'src' } }),
      // Skill comes first → wins the `find()` call.
      mockNode({ path: '.claude/skills/help/SKILL.md', kind: 'skill', frontmatter: {} }),
      mockNode({
        path: '.claude/commands/help.md',
        kind: 'command',
        frontmatter: { name: 'help' },
      }),
    ];
    const links = [mockSlash('/help', '/help', '.claude/agents/src.md')];
    const ctx = makeCtx({ reservedNodePaths: new Set(['.claude/commands/help.md']) });
    liftResolvedLinkConfidence(links, nodes, ctx);
    strictEqual(links[0]!.confidence, 1.0);
  });

  it('leaves unresolved links untouched even when other reserved nodes exist', () => {
    // A reserved node exists but the link does not point at it (path
    // mismatch + name not matching). Confidence stays at emit value.
    const nodes = [
      mockNode({ path: '.claude/agents/src.md', kind: 'agent', frontmatter: { name: 'src' } }),
      mockNode({
        path: '.claude/commands/help.md',
        kind: 'command',
        frontmatter: { name: 'help' },
      }),
    ];
    const links = [mockSlash('/something-else', '/something-else', '.claude/agents/src.md')];
    const ctx = makeCtx({ reservedNodePaths: new Set(['.claude/commands/help.md']) });
    liftResolvedLinkConfidence(links, nodes, ctx);
    strictEqual(links[0]!.confidence, 0.8);
  });
});
