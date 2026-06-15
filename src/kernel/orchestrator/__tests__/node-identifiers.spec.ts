/**
 * Unit tests for `collectNameCollisions`, the kernel-side detection that
 * `core/name-collision` projects. Verifies the three things the analyzer
 * no longer owns: kind eligibility (only kinds whose `identifiers`
 * include `frontmatter.name`), normalisation (case / separator variants
 * of one name collide), and the >= 2 distinct-paths threshold.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

import { collectNameCollisions } from '../node-identifiers.js';
import type { IProviderKind } from '../../extensions/index.js';
import type { Node } from '../../types.js';

function node(path: string, kind: string, name: string | undefined, provider = 'claude'): Node {
  return { path, kind, provider, frontmatter: name === undefined ? {} : { name } } as unknown as Node;
}

// `command` resolves by name, `markdown` is addressed by path only.
const REGISTRY: ReadonlyMap<string, IProviderKind> = new Map<string, IProviderKind>([
  ['claude/command', { identifiers: ['frontmatter.name', 'filename-basename'] } as unknown as IProviderKind],
  ['claude/agent', { identifiers: ['frontmatter.name'] } as unknown as IProviderKind],
  ['core/markdown', { identifiers: [] } as unknown as IProviderKind],
]);

describe('collectNameCollisions', () => {
  it('flags two name-resolvable nodes that declare the same name', () => {
    const collisions = collectNameCollisions(
      [node('a/deploy.md', 'command', 'deploy'), node('b/deploy.md', 'command', 'deploy')],
      REGISTRY,
    );
    assert.equal(collisions.size, 1);
    const claims = collisions.get('deploy');
    assert.ok(claims);
    assert.equal(claims!.length, 2);
    // Sorted by path for determinism.
    assert.deepEqual(claims!.map((c) => c.path), ['a/deploy.md', 'b/deploy.md']);
  });

  it('collides across case / separator variants (normalised)', () => {
    const collisions = collectNameCollisions(
      [node('a.md', 'command', 'Deploy'), node('b.md', 'agent', 'deploy')],
      REGISTRY,
    );
    assert.equal(collisions.size, 1);
    assert.ok(collisions.has('deploy'));
    // Cross-kind claim carries each node's own kind.
    assert.deepEqual(collisions.get('deploy')!.map((c) => c.kind).sort(), ['agent', 'command']);
  });

  it('ignores kinds that do not declare frontmatter.name (plain markdown)', () => {
    const collisions = collectNameCollisions(
      [node('a.md', 'markdown', 'deploy'), node('b.md', 'markdown', 'deploy')],
      REGISTRY,
    );
    assert.equal(collisions.size, 0);
  });

  it('stays silent for a single claimant or an empty / missing name', () => {
    assert.equal(collectNameCollisions([node('a.md', 'command', 'deploy')], REGISTRY).size, 0);
    assert.equal(
      collectNameCollisions(
        [node('a.md', 'command', undefined), node('b.md', 'command', '')],
        REGISTRY,
      ).size,
      0,
    );
  });
});
