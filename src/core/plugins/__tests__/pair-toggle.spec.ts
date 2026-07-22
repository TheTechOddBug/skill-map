/**
 * Unit tests for the pair-toggle helper (`core/plugins/pair-toggle.ts`),
 * the enable-axis half of Modelo B
 * (spec/plugin-author-guide.md §Paired extensions (pair toggle)).
 *
 * Covers: symmetric eager enable (1:1, 1:n, n:1), reference-counted
 * disable in both directions, requested keys counting as disabled inside
 * the refcount, idempotency (companion already requested / already in
 * target state), edgeless independence, and the edge collector's
 * canonicalization grammar.
 */

import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import {
  collectPairEdges,
  expandPairToggle,
  toEnableConfigKey,
  type IPairEdge,
  type IPairEdgeSource,
} from '../pair-toggle.js';

/** 1:1 pair, the shipping shape of all ten built-in pairs. */
const PAIR: IPairEdge[] = [
  { fixerKey: 'core/ai-verbosity-action', finderKey: 'core/ai-verbosity-analyzer' },
];

/** n:1 shape: two fixers referencing the same analyzer. */
const TWO_FIXERS: IPairEdge[] = [
  { fixerKey: 'p/fix-a', finderKey: 'p/finder' },
  { fixerKey: 'p/fix-b', finderKey: 'p/finder' },
];

/** 1:n shape: one fixer referencing two analyzers. */
const TWO_FINDERS: IPairEdge[] = [
  { fixerKey: 'p/fix', finderKey: 'p/finder-a' },
  { fixerKey: 'p/fix', finderKey: 'p/finder-b' },
];

const allEnabled = (): boolean => true;
const allDisabled = (): boolean => false;

describe('expandPairToggle, enable direction', () => {
  it('enabling a fixer pulls its disabled finder', () => {
    const r = expandPairToggle({
      requestedKeys: ['core/ai-verbosity-action'],
      enabled: true,
      edges: PAIR,
      isCurrentlyEnabled: allDisabled,
    });
    deepStrictEqual(r.finalKeys, ['core/ai-verbosity-action', 'core/ai-verbosity-analyzer']);
    deepStrictEqual(r.added, [
      { key: 'core/ai-verbosity-analyzer', via: 'core/ai-verbosity-action', role: 'finder' },
    ]);
  });

  it('enabling a finder pulls every disabled fixer referencing it', () => {
    const r = expandPairToggle({
      requestedKeys: ['p/finder'],
      enabled: true,
      edges: TWO_FIXERS,
      isCurrentlyEnabled: allDisabled,
    });
    deepStrictEqual(r.finalKeys, ['p/finder', 'p/fix-a', 'p/fix-b']);
  });

  it('enabling a fixer pulls every disabled finder it references (1:n)', () => {
    const r = expandPairToggle({
      requestedKeys: ['p/fix'],
      enabled: true,
      edges: TWO_FINDERS,
      isCurrentlyEnabled: allDisabled,
    });
    deepStrictEqual(r.finalKeys, ['p/fix', 'p/finder-a', 'p/finder-b']);
  });

  it('a companion already enabled is a no-op (no addition, no write)', () => {
    const r = expandPairToggle({
      requestedKeys: ['core/ai-verbosity-action'],
      enabled: true,
      edges: PAIR,
      isCurrentlyEnabled: (k) => k === 'core/ai-verbosity-analyzer',
    });
    deepStrictEqual(r.finalKeys, ['core/ai-verbosity-action']);
    deepStrictEqual(r.added, []);
  });
});

describe('expandPairToggle, disable direction (refcount)', () => {
  it('disabling a finder pulls the fixer it exclusively feeds', () => {
    const r = expandPairToggle({
      requestedKeys: ['core/ai-verbosity-analyzer'],
      enabled: false,
      edges: PAIR,
      isCurrentlyEnabled: allEnabled,
    });
    deepStrictEqual(r.finalKeys, ['core/ai-verbosity-analyzer', 'core/ai-verbosity-action']);
    deepStrictEqual(r.added, [
      { key: 'core/ai-verbosity-action', via: 'core/ai-verbosity-analyzer', role: 'fixer' },
    ]);
  });

  it('a fixer survives while another enabled finder still feeds it', () => {
    const r = expandPairToggle({
      requestedKeys: ['p/finder-a'],
      enabled: false,
      edges: TWO_FINDERS,
      isCurrentlyEnabled: allEnabled,
    });
    // p/fix still references the enabled p/finder-b: it survives.
    deepStrictEqual(r.finalKeys, ['p/finder-a']);
  });

  it('disabling BOTH finders of a 1:n fixer in one call pulls the fixer once', () => {
    const r = expandPairToggle({
      requestedKeys: ['p/finder-a', 'p/finder-b'],
      enabled: false,
      edges: TWO_FINDERS,
      isCurrentlyEnabled: allEnabled,
    });
    // Requested keys count as disabled inside the refcount: neither
    // finder keeps p/fix alive, and it is added exactly once.
    deepStrictEqual(r.finalKeys, ['p/finder-a', 'p/finder-b', 'p/fix']);
  });

  it('disabling a fixer pulls its exclusively-referenced finder', () => {
    const r = expandPairToggle({
      requestedKeys: ['core/ai-verbosity-action'],
      enabled: false,
      edges: PAIR,
      isCurrentlyEnabled: allEnabled,
    });
    deepStrictEqual(r.finalKeys, ['core/ai-verbosity-action', 'core/ai-verbosity-analyzer']);
  });

  it('a finder survives while another enabled fixer still references it', () => {
    const r = expandPairToggle({
      requestedKeys: ['p/fix-a'],
      enabled: false,
      edges: TWO_FIXERS,
      isCurrentlyEnabled: allEnabled,
    });
    // p/fix-b still enabled and referencing p/finder: the finder survives.
    deepStrictEqual(r.finalKeys, ['p/fix-a']);
  });

  it('disabling both fixers of an n:1 finder pulls the finder', () => {
    const r = expandPairToggle({
      requestedKeys: ['p/fix-a', 'p/fix-b'],
      enabled: false,
      edges: TWO_FIXERS,
      isCurrentlyEnabled: allEnabled,
    });
    deepStrictEqual(r.finalKeys, ['p/fix-a', 'p/fix-b', 'p/finder']);
  });

  it('a companion already disabled is a no-op', () => {
    const r = expandPairToggle({
      requestedKeys: ['core/ai-verbosity-analyzer'],
      enabled: false,
      edges: PAIR,
      isCurrentlyEnabled: (k) => k !== 'core/ai-verbosity-action',
    });
    deepStrictEqual(r.added, []);
  });

  it('no transitive closure: a pulled companion does not pull its own edges', () => {
    // Chain: fix-1 -> finder-shared <- fix-2 -> finder-far.
    const chain: IPairEdge[] = [
      { fixerKey: 'p/fix-1', finderKey: 'p/finder-shared' },
      { fixerKey: 'p/fix-2', finderKey: 'p/finder-shared' },
      { fixerKey: 'p/fix-2', finderKey: 'p/finder-far' },
    ];
    // Disabling fix-1 leaves finder-shared alive (fix-2 still enabled),
    // so nothing else moves; far edges are never walked transitively.
    const r = expandPairToggle({
      requestedKeys: ['p/fix-1'],
      enabled: false,
      edges: chain,
      isCurrentlyEnabled: allEnabled,
    });
    deepStrictEqual(r.finalKeys, ['p/fix-1']);
  });
});

describe('expandPairToggle, independence', () => {
  it('an edgeless extension toggles alone', () => {
    for (const enabled of [true, false]) {
      const r = expandPairToggle({
        requestedKeys: ['core/markdown-link'],
        enabled,
        edges: PAIR,
        isCurrentlyEnabled: enabled ? allDisabled : allEnabled,
      });
      deepStrictEqual(r.finalKeys, ['core/markdown-link']);
    }
  });

  it('a companion already in the requested set is not re-added', () => {
    const r = expandPairToggle({
      requestedKeys: ['core/ai-verbosity-analyzer', 'core/ai-verbosity-action'],
      enabled: false,
      edges: PAIR,
      isCurrentlyEnabled: allEnabled,
    });
    deepStrictEqual(r.finalKeys, ['core/ai-verbosity-analyzer', 'core/ai-verbosity-action']);
    deepStrictEqual(r.added, []);
  });
});

describe('collectPairEdges', () => {
  const SOURCES: IPairEdgeSource[] = [
    { key: 'core/ai-verbosity-analyzer', kind: 'analyzer' },
    {
      key: 'core/ai-verbosity-action',
      kind: 'action',
      analyzerIds: ['core/ai-verbosity-analyzer'],
    },
    // Bare declaration canonicalizes to the qualified analyzer key.
    { key: 'p/finder', kind: 'analyzer' },
    { key: 'p/fix', kind: 'action', analyzerIds: ['finder'] },
    // Dangling reference: no analyzer resolves, no edge (benign-race posture).
    { key: 'p/orphan-fix', kind: 'action', analyzerIds: ['p/gone-analyzer'] },
    // Non-fixer action and non-action kinds contribute nothing.
    { key: 'core/node-bump', kind: 'action' },
    { key: 'core/markdown-link', kind: 'extractor' },
  ];

  it('emits one edge per fixer-analyzer match, canonicalized', () => {
    deepStrictEqual(collectPairEdges(SOURCES), [
      { fixerKey: 'core/ai-verbosity-action', finderKey: 'core/ai-verbosity-analyzer' },
      { fixerKey: 'p/fix', finderKey: 'p/finder' },
    ]);
  });

  it('emits n edges for an analyzerIds array of length n', () => {
    const edges = collectPairEdges([
      { key: 'p/finder-a', kind: 'analyzer' },
      { key: 'p/finder-b', kind: 'analyzer' },
      { key: 'p/fix', kind: 'action', analyzerIds: ['p/finder-a', 'p/finder-b'] },
    ]);
    strictEqual(edges.length, 2);
  });
});

describe('toEnableConfigKey', () => {
  it('maps qualified and bare ids to their config dot-paths', () => {
    strictEqual(
      toEnableConfigKey('core/ai-verbosity-action'),
      'plugins.core.extensions.ai-verbosity-action.enabled',
    );
    strictEqual(toEnableConfigKey('core'), 'plugins.core.enabled');
  });
});
