/**
 * Unit tests for the post-walk transforms registry.
 *
 * Tests focus on the runner contract (sequencing, return-vs-mutate
 * threading), NOT on the wrapped functions' own behaviour: `dedupeLinks`
 * and `liftMentionConfidence` have their own dedicated specs.
 */

import { describe, it } from 'node:test';
import { strictEqual, deepStrictEqual } from 'node:assert';

import {
  applyPostWalkTransforms,
  POST_WALK_TRANSFORMS,
  type IPostWalkTransform,
} from '../post-walk-transforms.js';
import type { Link, Node } from '../../types.js';

function mockLink(over: Partial<Link>): Link {
  return {
    source: 'a.md',
    target: 'b.md',
    kind: 'references',
    confidence: 0.9,
    sources: ['markdown-link'],
    ...over,
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
    applyPostWalkTransforms([], [], transforms);
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
    const out = applyPostWalkTransforms([], [], transforms);
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
    const out = applyPostWalkTransforms(input, [], transforms);
    strictEqual(out, input);
    strictEqual(out[0]!.confidence, 0.1);
  });

  it('returns the input unchanged when no transforms are registered', () => {
    const input = [mockLink({})];
    const out = applyPostWalkTransforms(input, [], []);
    strictEqual(out, input);
  });

  it('default registry runs dedupe BEFORE lift-mention-confidence', () => {
    // Two identical mention emits AND a node that resolves the trigger.
    // The bump must run AFTER dedup so it sees one merged link, not
    // two unmerged duplicates.
    const nodes: Node[] = [
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
    const a = mockLink({
      target: 'reviewer.md',
      kind: 'mentions',
      confidence: 0.5,
      sources: ['at-directive'],
      trigger: { originalTrigger: '@reviewer', normalizedTrigger: '@reviewer' },
    });
    const b = mockLink({
      target: 'reviewer.md',
      kind: 'mentions',
      confidence: 0.5,
      sources: ['at-directive'],
      trigger: { originalTrigger: '@reviewer', normalizedTrigger: '@reviewer' },
    });
    const out = applyPostWalkTransforms([a, b], nodes);
    strictEqual(out.length, 1);
    strictEqual(out[0]!.confidence, 1);
  });

  it('default registry exposes dedupe-links and lift-mention-confidence in that order', () => {
    deepStrictEqual(
      POST_WALK_TRANSFORMS.map((t) => t.id),
      ['dedupe-links', 'lift-mention-confidence'],
    );
  });
});
