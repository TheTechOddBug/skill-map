/**
 * Unit tests for the post-walk transforms registry.
 *
 * Tests focus on the runner contract (sequencing, return-vs-mutate
 * threading, ctx threading), NOT on the wrapped functions' own
 * behaviour: `dedupeLinks` and `liftResolvedLinkConfidence` have their
 * own dedicated specs.
 */

import { describe, it } from 'node:test';
import { strictEqual, deepStrictEqual } from 'node:assert';

import {
  applyPostWalkTransforms,
  POST_WALK_TRANSFORMS,
  type IPostWalkTransform,
  type IPostWalkTransformCtx,
} from '../post-walk-transforms.js';
import type { IProviderKind } from '../../extensions/index.js';
import type { Link, Node } from '../../types.js';

function mockLink(over: Partial<Link>): Link {
  return {
    source: 'src.md',
    target: 'b.md',
    kind: 'references',
    confidence: 0.9,
    sources: ['markdown-link'],
    ...over,
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
 * Default ctx mirroring the built-in claude provider (the integration
 * test below relies on `claude.resolution.mentions` resolving against
 * `agent`).
 */
function makeCtx(): IPostWalkTransformCtx {
  const kindRegistry = new Map<string, IProviderKind>([
    ['claude/agent', makeKind(['frontmatter.name'])],
  ]);
  const providerResolution = new Map<string, Record<string, readonly string[]>>([
    ['claude', { mentions: ['agent'] }],
  ]);
  return {
    kindRegistry,
    providerResolution,
    activeProvider: 'claude',
    reservedNodePaths: new Set(),
  };
}

describe('applyPostWalkTransforms', () => {
  it('runs each transform in declared order', () => {
    const trace: string[] = [];
    const transforms: IPostWalkTransform[] = [
      { id: 'first', description: '', run: () => void trace.push('first') },
      { id: 'second', description: '', run: () => void trace.push('second') },
      { id: 'third', description: '', run: () => void trace.push('third') },
    ];
    applyPostWalkTransforms([], [], makeCtx(), transforms);
    deepStrictEqual(trace, ['first', 'second', 'third']);
  });

  it('threads the returned array into the next transform', () => {
    const seen: number[] = [];
    const transforms: IPostWalkTransform[] = [
      {
        id: 'replace',
        description: '',
        run: () => [mockLink({}), mockLink({})],
      },
      {
        id: 'observe',
        description: '',
        run(links) {
          seen.push(links.length);
        },
      },
    ];
    const out = applyPostWalkTransforms([], [], makeCtx(), transforms);
    strictEqual(out.length, 2);
    deepStrictEqual(seen, [2]);
  });

  it('keeps the input array when a transform returns void (in-place mutation style)', () => {
    const input = [mockLink({})];
    const transforms: IPostWalkTransform[] = [
      {
        id: 'mutates',
        description: '',
        run(links) {
          links[0]!.confidence = 0.1;
        },
      },
    ];
    const out = applyPostWalkTransforms(input, [], makeCtx(), transforms);
    strictEqual(out, input);
    strictEqual(out[0]!.confidence, 0.1);
  });

  it('returns the input unchanged when no transforms are registered', () => {
    const input = [mockLink({})];
    const out = applyPostWalkTransforms(input, [], makeCtx(), []);
    strictEqual(out, input);
  });

  it('threads the ctx to every transform', () => {
    const seenCtxs: IPostWalkTransformCtx[] = [];
    const transforms: IPostWalkTransform[] = [
      { id: 'first', description: '', run: (_l, _n, ctx) => void seenCtxs.push(ctx) },
      { id: 'second', description: '', run: (_l, _n, ctx) => void seenCtxs.push(ctx) },
    ];
    const ctx = makeCtx();
    applyPostWalkTransforms([], [], ctx, transforms);
    strictEqual(seenCtxs.length, 2);
    strictEqual(seenCtxs[0], ctx);
    strictEqual(seenCtxs[1], ctx);
  });

  it('default registry runs dedupe BEFORE lift-resolved-link-confidence', () => {
    // Two identical mention emits AND a node that resolves the
    // trigger. The lift must run AFTER dedup so it sees one merged
    // link, not two unmerged duplicates. The lift seeds the kernel's
    // 1.0 confidence baseline and records the resolution
    // (`resolvedTarget`); the penalty deltas (reserved / broken) are
    // applied later by the `core/name-reserved` / `core/reference-broken`
    // score-phase analyzers, which are outside the post-walk transform
    // registry. This clean-resolving mention keeps the 1.0 baseline.
    const nodes: Node[] = [
      {
        path: 'src.md',
        kind: 'agent',
        provider: 'claude',
        bodyHash: '0'.repeat(64),
        frontmatterHash: '0'.repeat(64),
        bytes: { frontmatter: 0, body: 0, total: 0 },
        frontmatter: { name: 'src' },
        linksOutCount: 0,
        linksInCount: 0,
        externalRefsCount: 0,
      } as unknown as Node,
      {
        path: 'reviewer.md',
        kind: 'agent',
        provider: 'claude',
        bodyHash: '0'.repeat(64),
        frontmatterHash: '0'.repeat(64),
        bytes: { frontmatter: 0, body: 0, total: 0 },
        frontmatter: { name: 'reviewer' },
        linksOutCount: 0,
        linksInCount: 0,
        externalRefsCount: 0,
      } as unknown as Node,
    ];
    const dup = (): Link =>
      mockLink({
        source: 'src.md',
        target: 'reviewer.md',
        kind: 'mentions',
        confidence: 0.5,
        sources: ['at-directive'],
        trigger: { originalTrigger: '@reviewer', normalizedTrigger: '@reviewer' },
      });
    const out = applyPostWalkTransforms([dup(), dup()], nodes, makeCtx());
    strictEqual(out.length, 1);
    strictEqual(out[0]!.resolvedTarget, 'reviewer.md');
  });

  it('default registry exposes dedupe, lift, and the code-mention gate in that order', () => {
    deepStrictEqual(
      POST_WALK_TRANSFORMS.map((t) => t.id),
      ['dedupe-links', 'lift-resolved-link-confidence', 'prune-unresolved-code-triggers'],
    );
  });
});
