/**
 * Pollution-defence unit tests for the kernel, covers `mergeNode-
 * WithEnrichments` (audit H3) and the claude provider's
 * `splitFrontmatter` strip (audit L2). Both are pure functions; the
 * tests do not need a DB or a spawned CLI.
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { claudeProvider } from '../../plugins/claude/providers/claude/index.js';
import { resolveProviderWalk } from '../../kernel/extensions/index.js';
import { mergeNodeWithEnrichments, type IPersistedEnrichment } from '../../kernel/orchestrator.js';
import type { Node } from '../../kernel/types.js';

function fakeNode(frontmatter: Record<string, unknown>): Node {
  return {
    path: 'agents/x.md',
    kind: 'agent',
    provider: 'claude',
    frontmatterHash: 'h',
    bodyHash: 'b',
    bytes: { frontmatter: 0, body: 0, total: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
    frontmatter,
  } as unknown as Node;
}

function fakeEnrichment(value: Record<string, unknown>, when = 1): IPersistedEnrichment {
  return {
    nodePath: 'agents/x.md',
    extractorId: 'fake',
    bodyHashAtEnrichment: 'h',
    value: value as Partial<Node>,
    stale: false,
    enrichedAt: when,
    isProbabilistic: false,
  };
}

describe('mergeNodeWithEnrichments, pollution defence (audit H3)', () => {
  it('strips __proto__ from node.frontmatter without reshaping the merged prototype', () => {
    const merged = mergeNodeWithEnrichments(
      fakeNode({ name: 'arq', __proto__: { polluted: 'yes' } }),
      [],
    );
    assert.equal(merged['name'], 'arq');
    assert.equal(Object.getPrototypeOf(merged), Object.prototype);
    assert.equal(({} as Record<string, unknown>)['polluted'], undefined);
  });

  it('strips __proto__ from enrichment row.value', () => {
    const merged = mergeNodeWithEnrichments(
      fakeNode({ name: 'arq' }),
      [fakeEnrichment({ description: 'D', __proto__: { leak: 1 } })],
    );
    assert.equal(merged['name'], 'arq');
    assert.equal(merged['description'], 'D');
    assert.equal(Object.getPrototypeOf(merged), Object.prototype);
    assert.equal(({} as Record<string, unknown>)['leak'], undefined);
  });

  it('strips constructor / prototype from row.value', () => {
    const merged = mergeNodeWithEnrichments(
      fakeNode({ name: 'arq' }),
      [fakeEnrichment({ constructor: { hijack: 1 }, prototype: { also: 1 }, ok: 'yes' })],
    );
    assert.equal(merged['ok'], 'yes');
    assert.ok(!Object.prototype.hasOwnProperty.call(merged, 'constructor'));
    assert.ok(!Object.prototype.hasOwnProperty.call(merged, 'prototype'));
  });

  it('preserves last-write-wins semantics under sorted enrichedAt order', () => {
    const merged = mergeNodeWithEnrichments(fakeNode({ field: 'base' }), [
      fakeEnrichment({ field: 'older' }, 1),
      fakeEnrichment({ field: 'newer' }, 2),
    ]);
    assert.equal(merged['field'], 'newer');
  });

  it('strips __proto__ / constructor / prototype at every nesting depth (audit M2)', () => {
    // `assignSafe` (inside `mergeNodeWithEnrichments`) deep-strips its
    // source via `stripPrototypePollution`. Pre-M2 only the root-level
    // forbidden names were filtered; a nested
    // `meta.__proto__ = { polluted: true }` survived as an own property
    // on the merged object's `meta` field, ready to fire the
    // `__proto__` setter in a future deep merge.
    const merged = mergeNodeWithEnrichments(
      fakeNode({ name: 'arq', meta: { __proto__: { polluted: true }, ok: 'yes' } }),
      [
        fakeEnrichment({
          // Nested in the enrichment source too.
          nested: {
            deeper: { constructor: { hijack: 1 }, safe: 'kept' },
            arr: [{ __proto__: { bad: 1 }, inside: 'still-here' }],
          },
        }),
      ],
    );
    // Author meta keeps the legitimate sibling, drops the nested __proto__.
    const fmMeta = merged['meta'] as Record<string, unknown>;
    assert.equal(fmMeta['ok'], 'yes');
    assert.equal(Object.prototype.hasOwnProperty.call(fmMeta, '__proto__'), false);
    // Enrichment nested deeper.constructor is gone; safe sibling stays.
    const nested = merged['nested'] as Record<string, unknown>;
    const deeper = nested['deeper'] as Record<string, unknown>;
    assert.equal(deeper['safe'], 'kept');
    assert.equal(Object.prototype.hasOwnProperty.call(deeper, 'constructor'), false);
    // Array element loses __proto__ but keeps its sibling.
    const arr = nested['arr'] as Record<string, unknown>[];
    assert.equal(arr[0]!['inside'], 'still-here');
    assert.equal(Object.prototype.hasOwnProperty.call(arr[0]!, '__proto__'), false);
    // Object.prototype itself stays clean.
    assert.equal(({} as Record<string, unknown>)['polluted'], undefined);
    assert.equal(({} as Record<string, unknown>)['bad'], undefined);
    assert.equal(({} as Record<string, unknown>)['hijack'], undefined);
  });
});

describe('claude provider walk, pollution defence (audit L2)', () => {
  let root: string;

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'sm-pollution-walk-'));
    mkdirSync(join(root, '.claude', 'agents'), { recursive: true });
    writeFileSync(
      join(root, '.claude', 'agents', 'evil.md'),
      [
        '---',
        'name: evil',
        '__proto__:',
        '  polluted: yes',
        'constructor:',
        '  hijack: 1',
        '---',
        'body',
        '',
      ].join('\n'),
    );
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('strips __proto__ / constructor / prototype from parsed YAML frontmatter', async () => {
    const seen: Array<Record<string, unknown>> = [];
    for await (const raw of resolveProviderWalk(claudeProvider)([root])) {
      seen.push(raw.frontmatter);
    }
    assert.equal(seen.length, 1);
    const fm = seen[0]!;
    assert.equal(fm['name'], 'evil');
    assert.ok(!Object.prototype.hasOwnProperty.call(fm, '__proto__'));
    assert.ok(!Object.prototype.hasOwnProperty.call(fm, 'constructor'));
    assert.equal(Object.getPrototypeOf(fm), Object.prototype);
    // Object.prototype itself is unchanged.
    assert.equal(({} as Record<string, unknown>)['polluted'], undefined);
    assert.equal(({} as Record<string, unknown>)['hijack'], undefined);
  });
});
