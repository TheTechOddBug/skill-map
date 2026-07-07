/**
 * Unit tests for the provider-aware post-resolution lift
 * (formerly `liftMentionConfidence`, generalised in bd-4k5 to cover
 * `invokes` and `references` per the source Provider's `resolution`
 * matrix and the target kind's declared `identifiers`).
 *
 * The lift seeds the kernel's confidence baseline (`link.confidence =
 * 1.0` for EVERY link, no gate) and records the resolution outcome on
 * `link.resolvedTarget`. The penalty values that used to ride along
 * (reserved → 0.1, broken → 0.25) are applied downstream by the built-in
 * `core/name-reserved` / `core/reference-broken` score-phase analyzers,
 * which read this `resolvedTarget` plus `ctx.reservedNodePaths` /
 * `ctx.brokenLinks`. A clean-resolved or untouched link keeps the 1.0
 * baseline. These tests therefore assert the RESOLUTION the lift owns; the
 * penalty numbers are pinned in the analyzers' own specs.
 *
 * Resolution contract:
 *   - Rule 1 (path match, any link.kind): `link.target` equals some
 *     node's `path` ⇒ `resolvedTarget = link.target`.
 *   - Rule 2 (name match, links with `trigger.normalizedTrigger`):
 *     stripped trigger matches a node's identifier (per the kind's
 *     declared `identifiers` sources: `frontmatter.name`,
 *     `filename-basename`, `dirname`) AND the candidate node's kind
 *     is in `provider.resolution[link.kind]` for the ACTIVE LENS ⇒
 *     `resolvedTarget = <matched node path>`.
 *   - Neither rule fires (genuinely broken, or name-matched but
 *     kind-matrix-rejected) ⇒ `resolvedTarget` stays `undefined`. The
 *     broken-vs-not-broken split lives in `collectBrokenLinks` (its
 *     own describe block below), not in the resolved-target outcome.
 *   - EVERY link is visited regardless of its incoming confidence (no
 *     gate): the lift sets the 1.0 baseline and records `resolvedTarget`
 *     for every link that resolves, including annotation-derived links
 *     that arrive at 1.0.
 *   - Empty / missing trigger short-circuits the name rule.
 *   - Empty / missing lens resolution map → no name-rule resolution
 *     (path-rule still fires independently).
 */

import { describe, it } from 'node:test';
import { strictEqual, deepStrictEqual } from 'node:assert';

import {
  liftResolvedLinkConfidence,
  collectBrokenLinks,
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
  it('resolves an at-directive references link whose target matches a node path', () => {
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
    strictEqual(links[0]!.resolvedTarget, '.claude/agents/reviewer.md');
  });

  it('resolves a mention via frontmatter.name on an agent target', () => {
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
    strictEqual(links[0]!.resolvedTarget, '.claude/agents/reviewer.md');
  });

  it('resolves a mention via filename-basename when the target lacks frontmatter.name', () => {
    // `.claude/agents/orphan.md` without a `name:` field still resolves
    // because `claude/agent.identifiers` includes `filename-basename`.
    const nodes = [
      mockNode({ path: '.claude/agents/src.md', kind: 'agent', frontmatter: { name: 'src' } }),
      mockNode({ path: '.claude/agents/orphan.md', kind: 'agent', frontmatter: {} }),
    ];
    const links = [mockMention('@orphan', 'orphan', '.claude/agents/src.md')];
    liftResolvedLinkConfidence(links, nodes, makeCtx());
    strictEqual(links[0]!.resolvedTarget, '.claude/agents/orphan.md');
  });

  it('resolves a slash invokes against a command via frontmatter.name', () => {
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
    strictEqual(links[0]!.resolvedTarget, '.claude/commands/deploy.md');
  });

  it('resolves a slash invokes against a skill via dirname (Anthropic skills convention)', () => {
    // No frontmatter.name on the skill; only the dirname between
    // `.claude/skills/` and `/SKILL.md` resolves the trigger.
    const nodes = [
      mockNode({ path: '.claude/agents/src.md', kind: 'agent', frontmatter: { name: 'src' } }),
      mockNode({ path: '.claude/skills/explore/SKILL.md', kind: 'skill', frontmatter: {} }),
    ];
    const links = [mockSlash('/explore', '/explore', '.claude/agents/src.md')];
    liftResolvedLinkConfidence(links, nodes, makeCtx());
    strictEqual(links[0]!.resolvedTarget, '.claude/skills/explore/SKILL.md');
  });

  it('does NOT resolve slash invokes against an agent (strict kind matrix)', () => {
    // `/foo` matching an agent named `foo` must NOT resolve: Claude's
    // resolution map for `invokes` lists only ['command', 'skill'].
    // Mentions surface (@foo) is the right link.kind for an agent;
    // the link-kind-conflict / kind-mismatch analyzers handle the rest.
    const nodes = [
      mockNode({ path: '.claude/agents/src.md', kind: 'agent', frontmatter: { name: 'src' } }),
      mockNode({ path: '.claude/agents/foo.md', kind: 'agent', frontmatter: { name: 'foo' } }),
    ];
    const links = [mockSlash('/foo', '/foo', '.claude/agents/src.md')];
    liftResolvedLinkConfidence(links, nodes, makeCtx());
    strictEqual(links[0]!.resolvedTarget, undefined);
  });

  it('does NOT resolve a mention pointing at a command (strict kind matrix)', () => {
    // `@deploy` resolving to a command (not an agent) stays unresolved.
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
    strictEqual(links[0]!.resolvedTarget, undefined);
  });

  it('resolves a mention sourced from a universal-provider body under the active lens', () => {
    // Per `spec/architecture.md` §Provider · resolution rules, the
    // resolver authority is the ACTIVE PROVIDER LENS, not the source
    // node's provider. A `@handle` in `CLAUDE.md` (classified by
    // `core/markdown`) under the `claude` lens parses as a claude
    // mention (extractor gate) AND resolves against
    // claude's `resolution.mentions` (resolver gate). The two gates
    // mirror so trigger-style links emitted from universal-provider
    // bodies never get stuck unresolved.
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
    strictEqual(links[0]!.resolvedTarget, '.claude/agents/reviewer.md');
  });

  it('does NOT resolve trigger-style links under the markdown lens (no resolution map)', () => {
    // Under the universal markdown lens (a project with no marker)
    // `core/markdown` declares no resolution map, so the name path
    // short-circuits uniformly. Path-match still fires independently;
    // this case asserts the trigger path alone stays unresolved.
    const nodes = [
      mockNode({ path: '.claude/agents/src.md', kind: 'agent', frontmatter: { name: 'src' } }),
      mockNode({
        path: '.claude/agents/reviewer.md',
        kind: 'agent',
        frontmatter: { name: 'reviewer' },
      }),
    ];
    const links = [mockMention('@reviewer', 'reviewer', '.claude/agents/src.md')];
    liftResolvedLinkConfidence(links, nodes, makeCtx({ activeProvider: 'markdown' }));
    strictEqual(links[0]!.resolvedTarget, undefined);
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
    strictEqual(links[0]!.resolvedTarget, '.claude/commands/demo-command.md');
  });

  it('visits a link already at 1.0 too: resolvedTarget recorded, baseline stays 1.0 (no gate)', () => {
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
    // No gate: the lift visits every link, seeds the 1.0 baseline (already
    // 1.0 here), and records the path-match resolution.
    strictEqual(links[0]!.confidence, 1.0);
    strictEqual(links[0]!.resolvedTarget, '.claude/agents/reviewer.md');
  });

  it('is idempotent: re-running on the same input does not change resolvedTarget', () => {
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
    const after1 = links[0]!.resolvedTarget;
    liftResolvedLinkConfidence(links, nodes, makeCtx());
    strictEqual(links[0]!.resolvedTarget, after1);
  });

  it('visits a 1.0 link with an unresolvable target: baseline stays 1.0, no resolvedTarget', () => {
    // The lift visits every link (no confidence gate). This already-1.0
    // link points at `whatever.md`, which matches no node and no name
    // index entry, so resolution returns `none` and resolvedTarget stays
    // undefined (the confidence baseline is still seeded to 1.0).
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
    strictEqual(links[0]!.confidence, 1.0);
    deepStrictEqual(
      links.map((l) => l.resolvedTarget),
      [undefined],
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
    strictEqual(links[0]!.resolvedTarget, '.claude/agents/reviewer.md'); // resolved mention
    strictEqual(links[1]!.resolvedTarget, undefined); // /unknown unresolved (broken)
    // already-1.0 reference IS visited (no gate) and path-matches the
    // deploy command, so its resolvedTarget is now recorded.
    strictEqual(links[2]!.resolvedTarget, '.claude/commands/deploy.md');
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
    strictEqual(links[0]!.resolvedTarget, '.claude/agents/sr.md');
  });

  it('resolves a slash invokes to a reserved command (name match)', () => {
    // User-authored `.claude/commands/help.md` is shadowed by Claude's
    // built-in `/help`. The slash still RESOLVES by name (kind matrix
    // permits command); whether the resolved target is reserved (and
    // the downgrade to 0.1 that follows) is the scorer's call, not the
    // lift's. The lift only records the resolution.
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
    strictEqual(links[0]!.resolvedTarget, '.claude/commands/help.md');
  });

  it('resolves an at-directive references to a reserved target (path match)', () => {
    // `@./help.md` resolves by path to the reserved file. Path match is
    // the rule that fires; the lift records the resolution regardless of
    // whether the target is reserved (the downgrade is the scorer's).
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
    strictEqual(links[0]!.resolvedTarget, '.claude/commands/help.md');
  });

  it('resolves to the non-reserved candidate when the trigger has multiple candidates', () => {
    // Two candidates for `/help`: a reserved command, AND a skill
    // (also resolves under claude.invokes = [command, skill]). The
    // candidate finder picks the first one whose kind is allowed; the
    // non-reserved skill is FIRST in the candidate array, so resolution
    // lands on it (and the scorer never sees a reserved target).
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
    strictEqual(links[0]!.resolvedTarget, '.claude/skills/help/SKILL.md');
  });

  it('resolves by matrix priority when the trigger names candidates of several kinds', () => {
    // `@deploy` names BOTH a markdown doc and an agent. The markdown
    // node is walked FIRST (enqueued first into the name bucket), but
    // the priority-ordered matrix `mentions: ['agent', 'skill',
    // 'markdown']` makes the agent win deterministically.
    const kindRegistry = new Map<string, IProviderKind>([
      ['claude/agent', makeKind(['frontmatter.name', 'filename-basename'])],
      ['markdown/markdown', makeKind(['filename-basename'])],
    ]);
    const providerResolution = new Map<string, Record<string, readonly string[]>>([
      ['claude', { mentions: ['agent', 'skill', 'markdown'] }],
    ]);
    const nodes = [
      mockNode({ path: 'docs/deploy.md', kind: 'markdown', provider: 'markdown' }),
      mockNode({ path: '.claude/agents/deploy.md', kind: 'agent', frontmatter: { name: 'deploy' } }),
    ];
    const links = [mockMention('@deploy', 'deploy')];
    const ctx = makeCtx({ kindRegistry, providerResolution });
    liftResolvedLinkConfidence(links, nodes, ctx);
    strictEqual(links[0]!.resolvedTarget, '.claude/agents/deploy.md');
  });

  it('resolves a mention to a plain markdown file by basename when no named kind claims it', () => {
    const kindRegistry = new Map<string, IProviderKind>([
      ['claude/agent', makeKind(['frontmatter.name', 'filename-basename'])],
      ['markdown/markdown', makeKind(['filename-basename'])],
    ]);
    const providerResolution = new Map<string, Record<string, readonly string[]>>([
      ['claude', { mentions: ['agent', 'skill', 'markdown'] }],
    ]);
    const nodes = [mockNode({ path: 'docs/playbook.md', kind: 'markdown', provider: 'markdown' })];
    const links = [mockMention('@playbook', 'playbook')];
    const ctx = makeCtx({ kindRegistry, providerResolution });
    liftResolvedLinkConfidence(links, nodes, ctx);
    strictEqual(links[0]!.resolvedTarget, 'docs/playbook.md');
  });

  it('does NOT resolve a genuinely-broken slash even when other reserved nodes exist', () => {
    // A reserved node exists but the link does not point at it (path
    // mismatch + name not in the index). `/something-else` resolves to
    // nothing → resolvedTarget stays undefined.
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
    strictEqual(links[0]!.resolvedTarget, undefined);
  });

  it('does NOT resolve a markdown references link whose target resolves to nothing', () => {
    // `[x](./missing.md)` from `src.md`: the extractor emits a path-style
    // `references` link at 0.95 with the resolved path as the trigger.
    // No node has that path, and the trigger (a path, not a handle) is
    // not in the name index ⇒ resolvedTarget stays undefined.
    const nodes = [
      mockNode({ path: 'src.md', kind: 'markdown', provider: 'core', frontmatter: {} }),
    ];
    const links: Link[] = [
      {
        source: 'src.md',
        target: 'missing.md',
        kind: 'references',
        confidence: 0.95,
        sources: ['markdown-link'],
        trigger: { originalTrigger: './missing.md', normalizedTrigger: 'missing.md' },
      },
    ];
    liftResolvedLinkConfidence(links, nodes, makeCtx());
    strictEqual(links[0]!.resolvedTarget, undefined);
  });

  it('resolves a markdown references link (emit 0.95) when its target matches by path', () => {
    const nodes = [
      mockNode({ path: 'src.md', kind: 'markdown', provider: 'core', frontmatter: {} }),
      mockNode({ path: 'guide.md', kind: 'markdown', provider: 'core', frontmatter: {} }),
    ];
    const links: Link[] = [
      {
        source: 'src.md',
        target: 'guide.md',
        kind: 'references',
        confidence: 0.95,
        sources: ['markdown-link'],
        trigger: { originalTrigger: './guide.md', normalizedTrigger: 'guide.md' },
      },
    ];
    liftResolvedLinkConfidence(links, nodes, makeCtx());
    strictEqual(links[0]!.resolvedTarget, 'guide.md');
  });

  it('does NOT resolve a not-broken-not-bumped slash (name matches, kind matrix rejects)', () => {
    // `/foo` matches an agent named `foo` by name, but claude.invokes =
    // [command, skill] rejects agent ⇒ no resolution. The name DOES
    // exist in the index, so the link is NOT broken (see the
    // `collectBrokenLinks` block); the lift still leaves resolvedTarget
    // undefined because the kind matrix rejected the candidate.
    const nodes = [
      mockNode({ path: '.claude/agents/src.md', kind: 'agent', frontmatter: { name: 'src' } }),
      mockNode({ path: '.claude/agents/foo.md', kind: 'agent', frontmatter: { name: 'foo' } }),
    ];
    const links = [mockSlash('/foo', '/foo', '.claude/agents/src.md')];
    liftResolvedLinkConfidence(links, nodes, makeCtx());
    strictEqual(links[0]!.resolvedTarget, undefined);
  });

  it('resolves a link pointing at a virtual node (resolvedTarget set; baseline 1.0)', () => {
    // A `references` link to an `mcp://images` node (virtual: true,
    // fabricated from frontmatter, unverified on disk) resolves by path,
    // so resolvedTarget is set and the link keeps the kernel's 1.0
    // baseline like any clean resolution (no built-in penalty applies to a
    // virtual target; it is never genuinely broken).
    const nodes = [
      mockNode({ path: '.claude/agents/src.md', kind: 'agent', frontmatter: { name: 'src' } }),
      mockNode({ path: 'mcp://images', kind: 'mcp', virtual: true, frontmatter: { name: 'images' } }),
    ];
    const links: Link[] = [
      {
        source: '.claude/agents/src.md',
        target: 'mcp://images',
        kind: 'references',
        confidence: 0.85,
        sources: ['mcp-tools'],
        trigger: { originalTrigger: 'mcp__images__*', normalizedTrigger: 'mcp://images' },
      },
    ];
    liftResolvedLinkConfidence(links, nodes, makeCtx());
    strictEqual(links[0]!.resolvedTarget, 'mcp://images');
  });
});

describe('collectBrokenLinks', () => {
  it('does NOT mark a mention resolved via filename-basename as broken', () => {
    // `@filed` resolves to `filed.md` via the filename identifier, even
    // though the node's `frontmatter.name` is a different string. This
    // is the case the old frontmatter-name-only reference-broken index
    // false-flagged.
    const nodes = [
      mockNode({ path: '.claude/agents/src.md', kind: 'agent', frontmatter: { name: 'src' } }),
      mockNode({
        path: '.claude/agents/filed.md',
        kind: 'agent',
        frontmatter: { name: 'real-agent-name' },
      }),
    ];
    const links = [mockMention('@filed', 'filed', '.claude/agents/src.md')];
    const broken = collectBrokenLinks(links, nodes, makeCtx());
    strictEqual(broken.has(links[0]!), false);
  });

  it('does NOT mark a slash resolved via dirname (skill without name) as broken', () => {
    const nodes = [
      mockNode({ path: 'src.md', kind: 'markdown', provider: 'core', frontmatter: {} }),
      mockNode({ path: '.claude/skills/nameless/SKILL.md', kind: 'skill', frontmatter: {} }),
    ];
    const links = [mockSlash('/nameless', '/nameless', 'src.md')];
    const broken = collectBrokenLinks(links, nodes, makeCtx());
    strictEqual(broken.has(links[0]!), false);
  });

  it('marks a mention with no matching node anywhere as broken', () => {
    const nodes = [
      mockNode({ path: '.claude/agents/src.md', kind: 'agent', frontmatter: { name: 'src' } }),
    ];
    const links = [mockMention('@ghost', 'ghost', '.claude/agents/src.md')];
    const broken = collectBrokenLinks(links, nodes, makeCtx());
    strictEqual(broken.has(links[0]!), true);
  });

  it('checks path-style links at confidence 1.0 too (annotation dangling ref)', () => {
    const nodes = [
      mockNode({ path: 'a.md', kind: 'markdown', provider: 'core', frontmatter: {} }),
      mockNode({ path: 'real.md', kind: 'markdown', provider: 'core', frontmatter: {} }),
    ];
    const good: Link = {
      source: 'a.md',
      target: 'real.md',
      kind: 'references',
      confidence: 1.0,
      sources: ['annotations'],
    };
    const bad: Link = {
      source: 'a.md',
      target: 'ghost.md',
      kind: 'references',
      confidence: 1.0,
      sources: ['annotations'],
    };
    const broken = collectBrokenLinks([good, bad], nodes, makeCtx());
    strictEqual(broken.has(good), false);
    strictEqual(broken.has(bad), true);
  });

  // ---- on-disk existence probe (third clause of the definition) ----

  function pathLink(target: string, source = 'a.md'): Link {
    return {
      source,
      target,
      kind: 'references',
      confidence: 0.9,
      sources: ['markdown-link'],
      trigger: { originalTrigger: `./${target}`, normalizedTrigger: target },
    };
  }

  it('does NOT mark a path-style link whose target the probe finds on disk', () => {
    // The reported false positive: `[schema](./report.schema.json)`
    // points at a real file that is never indexed as a node.
    const nodes = [mockNode({ path: 'a.md', kind: 'markdown', provider: 'core' })];
    const link = pathLink('report.schema.json');
    const broken = collectBrokenLinks([link], nodes, makeCtx(), () => true);
    strictEqual(broken.has(link), false);
  });

  it('keeps a path-style link broken when the probe misses too', () => {
    const nodes = [mockNode({ path: 'a.md', kind: 'markdown', provider: 'core' })];
    const link = pathLink('missing.json');
    const broken = collectBrokenLinks([link], nodes, makeCtx(), () => false);
    strictEqual(broken.has(link), true);
  });

  it('never consults the probe for trigger-style links (/, @, $ sigils)', () => {
    const nodes = [
      mockNode({ path: '.claude/agents/src.md', kind: 'agent', frontmatter: { name: 'src' } }),
    ];
    const links = [
      mockMention('@ghost', 'ghost', '.claude/agents/src.md'),
      mockSlash('/ghost', '/ghost', '.claude/agents/src.md'),
      mockSlash('$ghost', '$ghost', '.claude/agents/src.md'),
    ];
    const consulted: string[] = [];
    const broken = collectBrokenLinks(links, nodes, makeCtx(), (target) => {
      consulted.push(target);
      return true; // would clear the verdict if it ever fired
    });
    deepStrictEqual(consulted, []);
    for (const link of links) strictEqual(broken.has(link), true);
  });

  it('does not consult the probe for links already resolved in-graph', () => {
    const nodes = [
      mockNode({ path: 'a.md', kind: 'markdown', provider: 'core' }),
      mockNode({ path: 'real.md', kind: 'markdown', provider: 'core' }),
    ];
    const consulted: string[] = [];
    const broken = collectBrokenLinks([pathLink('real.md')], nodes, makeCtx(), (target) => {
      consulted.push(target);
      return false;
    });
    deepStrictEqual(consulted, []);
    strictEqual(broken.size, 0);
  });

  it('treats a trigger-less link as path-style for the probe (annotation refs)', () => {
    const nodes = [mockNode({ path: 'a.md', kind: 'markdown', provider: 'core' })];
    const link: Link = {
      source: 'a.md',
      target: 'assets/logo.png',
      kind: 'references',
      confidence: 1.0,
      sources: ['annotations'],
    };
    const broken = collectBrokenLinks([link], nodes, makeCtx(), () => true);
    strictEqual(broken.has(link), false);
  });
});
