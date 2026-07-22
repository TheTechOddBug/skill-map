/**
 * Unit tests for `nodeMatchesPrecondition`, focused on the
 * `frontmatterMissing` gap gate (spec
 * `action.schema.json#/properties/precondition`): the action applies
 * ONLY while the node's frontmatter is missing at least one listed
 * field. The kind / provider legs ride the same predicate and were
 * previously covered only through the route / fan-out integration
 * suites; a smoke case for each keeps this file the canonical map of
 * the matcher's semantics.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { nodeMatchesPrecondition } from '../submit-engine.js';
import type { Node } from '../../../kernel/types.js';

function makeNode(frontmatter?: Record<string, unknown>): Node {
  return {
    path: 'notes/deploy-guide.md',
    kind: 'markdown',
    provider: 'markdown',
    bodyHash: 'b'.repeat(64),
    frontmatterHash: 'f'.repeat(64),
    bytes: { total: 10, frontmatter: 0, body: 10 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
    ...(frontmatter !== undefined ? { frontmatter } : {}),
  };
}

const GATE = { frontmatterMissing: ['name', 'description'] };

describe('nodeMatchesPrecondition, frontmatterMissing gap gate', () => {
  it('matches a node with no frontmatter block at all', () => {
    assert.equal(nodeMatchesPrecondition(makeNode(), GATE), true);
  });

  it('matches when one listed field is absent', () => {
    assert.equal(nodeMatchesPrecondition(makeNode({ name: 'deploy-guide' }), GATE), true);
  });

  it('matches when a listed field is an empty string or a valueless key (null)', () => {
    assert.equal(
      nodeMatchesPrecondition(makeNode({ name: 'deploy-guide', description: '' }), GATE),
      true,
    );
    assert.equal(
      nodeMatchesPrecondition(makeNode({ name: 'deploy-guide', description: null }), GATE),
      true,
    );
  });

  it('does NOT match when every listed field carries a non-empty value', () => {
    const node = makeNode({ name: 'deploy-guide', description: 'How to deploy.' });
    assert.equal(nodeMatchesPrecondition(node, GATE), false);
  });

  it('a non-string value counts as present (nothing for the action to write)', () => {
    const node = makeNode({ name: 'deploy-guide', description: ['odd', 'shape'] });
    assert.equal(nodeMatchesPrecondition(node, GATE), false);
  });

  it('ANDs with the provider leg', () => {
    const gated = { ...GATE, provider: ['claude'] };
    // Frontmatter is missing but the provider leg refuses the node.
    assert.equal(nodeMatchesPrecondition(makeNode(), gated), false);
  });

  it('smoke: kind / provider legs and the absent-precondition default', () => {
    const node = makeNode();
    assert.equal(nodeMatchesPrecondition(node, undefined), true);
    assert.equal(nodeMatchesPrecondition(node, { kind: ['markdown/markdown'] }), true);
    assert.equal(nodeMatchesPrecondition(node, { kind: ['claude/skill'] }), false);
  });
});
