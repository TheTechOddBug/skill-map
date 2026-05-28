/**
 * Unit tests for the Signal IR resolver phase. Covers intra-Signal
 * candidate ranking (with and without `IProvider.resolverRules.kindPriority`),
 * cross-Signal range-overlap collision resolution + tiebreak chain, the
 * external-URL pseudo-link cluster skip, and frontmatter / sidecar scope
 * pass-through.
 *
 * The resolver is a pure function; no I/O, no DB, no AJV. Each test
 * constructs Signals + a (possibly null) IProvider + an extractorOrder
 * array and asserts on the resulting `links[]` shape AND on each
 * Signal's `resolution` annotation.
 */

import { describe, it } from 'node:test';
import { strictEqual, deepStrictEqual, ok } from 'node:assert';

import type { IProvider } from '../../extensions/provider.js';
import type { Signal, SignalCandidate } from '../../types.js';
import { resolveSignals } from '../resolver.js';

function makeSignal(opts: {
  source?: string;
  scope?: 'body' | 'frontmatter' | 'sidecar';
  range?: { start: number; end: number } | null;
  raw?: string;
  candidates: SignalCandidate[];
}): Signal {
  return {
    source: opts.source ?? 'a.md',
    scope: opts.scope ?? 'body',
    range: opts.range ?? null,
    raw: opts.raw ?? 'raw-text',
    candidates: opts.candidates,
  };
}

function makeCandidate(opts: Partial<SignalCandidate> & { extractorId: string }): SignalCandidate {
  return {
    extractorId: opts.extractorId,
    kind: opts.kind ?? 'references',
    target: opts.target ?? 'target.md',
    confidence: opts.confidence ?? 0.9,
    ...(opts.rationale !== undefined ? { rationale: opts.rationale } : {}),
    ...(opts.trigger !== undefined ? { trigger: opts.trigger } : {}),
  };
}

function makeProvider(opts?: { kindPriority?: readonly ('invokes' | 'references' | 'mentions' | 'supersedes')[] }): IProvider {
  return {
    id: 'test-provider',
    pluginId: 'test',
    kind: 'provider',
    description: 'test fixture',
    version: '1.0.0',
    presentation: { label: 'Test', color: '#000000' },
    classify: () => null,
    kinds: {},
    ...(opts?.kindPriority ? { resolverRules: { kindPriority: opts.kindPriority } } : {}),
  };
}

describe('resolveSignals · empty + minimal cases', () => {
  it('returns empty arrays when no Signal is emitted', () => {
    const result = resolveSignals({ signals: [], activeProvider: null, extractorOrder: [] });
    deepStrictEqual(result.links, []);
    deepStrictEqual(result.resolvedSignals, []);
  });

  it('materialises a single-candidate Signal as a Link with the candidate verbatim', () => {
    const signal = makeSignal({
      range: { start: 0, end: 10 },
      candidates: [makeCandidate({ extractorId: 'core/markdown-link', kind: 'references', target: 'a.md', confidence: 0.95 })],
    });
    const result = resolveSignals({ signals: [signal], activeProvider: null, extractorOrder: ['core/markdown-link'] });
    strictEqual(result.links.length, 1);
    strictEqual(result.links[0]!.source, 'a.md');
    strictEqual(result.links[0]!.target, 'a.md');
    strictEqual(result.links[0]!.confidence, 0.95);
    deepStrictEqual(result.links[0]!.sources, ['core/markdown-link']);
    deepStrictEqual(signal.resolution, { outcome: 'materialised', winnerIndex: 0 });
  });
});

describe('resolveSignals · intra-Signal ranking', () => {
  it('higher-confidence candidate wins when no kindPriority is declared', () => {
    const signal = makeSignal({
      candidates: [
        makeCandidate({ extractorId: 'a', kind: 'mentions', confidence: 0.5 }),
        makeCandidate({ extractorId: 'b', kind: 'references', confidence: 0.85 }),
      ],
    });
    resolveSignals({ signals: [signal], activeProvider: null, extractorOrder: ['a', 'b'] });
    strictEqual(signal.resolution?.winnerIndex, 1);
  });

  it('kindPriority overrides confidence: lower-confidence + earlier-listed kind wins', () => {
    const signal = makeSignal({
      candidates: [
        makeCandidate({ extractorId: 'a', kind: 'mentions', confidence: 0.9 }),
        makeCandidate({ extractorId: 'b', kind: 'invokes', confidence: 0.5 }),
      ],
    });
    const provider = makeProvider({ kindPriority: ['invokes', 'mentions'] });
    resolveSignals({ signals: [signal], activeProvider: provider, extractorOrder: ['a', 'b'] });
    strictEqual(signal.resolution?.winnerIndex, 1);
  });

  it('extractor declaration order breaks ties when kind + confidence are identical', () => {
    const signal = makeSignal({
      candidates: [
        makeCandidate({ extractorId: 'second', kind: 'references', confidence: 0.5 }),
        makeCandidate({ extractorId: 'first', kind: 'references', confidence: 0.5 }),
      ],
    });
    resolveSignals({ signals: [signal], activeProvider: null, extractorOrder: ['first', 'second'] });
    strictEqual(signal.resolution?.winnerIndex, 1);
  });
});

describe('resolveSignals · cross-Signal range overlap', () => {
  it('disjoint ranges both materialise', () => {
    const a = makeSignal({ range: { start: 0, end: 5 }, candidates: [makeCandidate({ extractorId: 'x' })] });
    const b = makeSignal({ range: { start: 10, end: 15 }, candidates: [makeCandidate({ extractorId: 'y' })] });
    const result = resolveSignals({ signals: [a, b], activeProvider: null, extractorOrder: ['x', 'y'] });
    strictEqual(result.links.length, 2);
    strictEqual(a.resolution?.outcome, 'materialised');
    strictEqual(b.resolution?.outcome, 'materialised');
  });

  it('longer-range wins overlap with equal confidence + kind', () => {
    const longer = makeSignal({
      range: { start: 10, end: 30 },
      candidates: [makeCandidate({ extractorId: 'long', kind: 'references', confidence: 0.85 })],
    });
    const shorter = makeSignal({
      range: { start: 15, end: 22 },
      candidates: [makeCandidate({ extractorId: 'short', kind: 'references', confidence: 0.85 })],
    });
    const result = resolveSignals({ signals: [longer, shorter], activeProvider: null, extractorOrder: ['long', 'short'] });
    strictEqual(result.links.length, 1);
    strictEqual(result.links[0]!.sources[0], 'long');
    strictEqual(longer.resolution?.outcome, 'materialised');
    strictEqual(shorter.resolution?.outcome, 'rejected');
    strictEqual(shorter.resolution?.rejectedBy?.extractorId, 'long');
    strictEqual(shorter.resolution?.rejectedBy?.reason, 'longer-range');
  });

  it('higher-confidence wins overlap with equal range + kind', () => {
    const stronger = makeSignal({
      range: { start: 5, end: 15 },
      candidates: [makeCandidate({ extractorId: 'strong', kind: 'references', confidence: 0.95 })],
    });
    const weaker = makeSignal({
      range: { start: 5, end: 15 },
      candidates: [makeCandidate({ extractorId: 'weak', kind: 'references', confidence: 0.5 })],
    });
    const result = resolveSignals({ signals: [stronger, weaker], activeProvider: null, extractorOrder: ['strong', 'weak'] });
    strictEqual(result.links.length, 1);
    strictEqual(result.links[0]!.sources[0], 'strong');
    strictEqual(weaker.resolution?.rejectedBy?.reason, 'higher-confidence');
  });

  it('kind-priority wins overlap when confidence + range are identical', () => {
    const provider = makeProvider({ kindPriority: ['invokes', 'references'] });
    const invokesSignal = makeSignal({
      range: { start: 0, end: 10 },
      candidates: [makeCandidate({ extractorId: 'a', kind: 'invokes', confidence: 0.7 })],
    });
    const referencesSignal = makeSignal({
      range: { start: 0, end: 10 },
      candidates: [makeCandidate({ extractorId: 'b', kind: 'references', confidence: 0.7 })],
    });
    const result = resolveSignals({ signals: [invokesSignal, referencesSignal], activeProvider: provider, extractorOrder: ['a', 'b'] });
    strictEqual(result.links.length, 1);
    strictEqual(result.links[0]!.sources[0], 'a');
    strictEqual(referencesSignal.resolution?.rejectedBy?.reason, 'kind-priority');
  });

  it('declaration order breaks overlap when everything else is identical', () => {
    const first = makeSignal({
      range: { start: 0, end: 10 },
      candidates: [makeCandidate({ extractorId: 'first', kind: 'references', confidence: 0.7 })],
    });
    const second = makeSignal({
      range: { start: 0, end: 10 },
      candidates: [makeCandidate({ extractorId: 'second', kind: 'references', confidence: 0.7 })],
    });
    const result = resolveSignals({ signals: [first, second], activeProvider: null, extractorOrder: ['first', 'second'] });
    strictEqual(result.links.length, 1);
    strictEqual(result.links[0]!.sources[0], 'first');
    strictEqual(second.resolution?.rejectedBy?.reason, 'earlier-declaration');
    strictEqual(second.resolution?.rejectedBy?.extractorId, 'first');
  });
});

describe('resolveSignals · external-URL cluster skip', () => {
  it('two http-targeted signals at the same range both materialise (no collision)', () => {
    const a = makeSignal({
      range: { start: 0, end: 20 },
      candidates: [makeCandidate({ extractorId: 'url-a', target: 'https://example.com/a', kind: 'references', confidence: 0.3 })],
    });
    const b = makeSignal({
      range: { start: 0, end: 20 },
      candidates: [makeCandidate({ extractorId: 'url-b', target: 'http://example.com/b', kind: 'references', confidence: 0.3 })],
    });
    const result = resolveSignals({ signals: [a, b], activeProvider: null, extractorOrder: ['url-a', 'url-b'] });
    strictEqual(result.links.length, 2);
    strictEqual(a.resolution?.outcome, 'materialised');
    strictEqual(b.resolution?.outcome, 'materialised');
  });

  it('mixed cluster (one external + one internal) DOES collide; internal-only path applies', () => {
    const external = makeSignal({
      range: { start: 0, end: 20 },
      candidates: [makeCandidate({ extractorId: 'url', target: 'https://example.com', confidence: 0.95 })],
    });
    const internal = makeSignal({
      range: { start: 0, end: 20 },
      candidates: [makeCandidate({ extractorId: 'internal', target: 'docs.md', confidence: 0.7 })],
    });
    const result = resolveSignals({ signals: [external, internal], activeProvider: null, extractorOrder: ['url', 'internal'] });
    // Higher confidence wins; external Signal's external URL is fine in
    // the materialised set because the caller routes via isExternalUrlLink.
    strictEqual(result.links.length, 1);
    ok(external.resolution?.outcome === 'materialised' || internal.resolution?.outcome === 'materialised');
  });
});

describe('resolveSignals · non-body scope pass-through', () => {
  it('frontmatter Signals never enter overlap detection', () => {
    const a = makeSignal({
      scope: 'frontmatter',
      range: null,
      candidates: [makeCandidate({ extractorId: 'mcp-tools', kind: 'references', target: 'mcp://x' })],
    });
    const b = makeSignal({
      scope: 'frontmatter',
      range: null,
      candidates: [makeCandidate({ extractorId: 'mcp-tools', kind: 'references', target: 'mcp://y' })],
    });
    const result = resolveSignals({ signals: [a, b], activeProvider: null, extractorOrder: ['mcp-tools'] });
    strictEqual(result.links.length, 2);
    strictEqual(a.resolution?.outcome, 'materialised');
    strictEqual(b.resolution?.outcome, 'materialised');
  });

  it('sidecar Signals never enter overlap detection', () => {
    const a = makeSignal({
      scope: 'sidecar',
      range: null,
      candidates: [makeCandidate({ extractorId: 'annotations', kind: 'supersedes', target: 'old.md' })],
    });
    const result = resolveSignals({ signals: [a], activeProvider: null, extractorOrder: ['annotations'] });
    strictEqual(result.links.length, 1);
    strictEqual(a.resolution?.outcome, 'materialised');
  });
});

describe('resolveSignals · materialised Link shape parity', () => {
  it('preserves trigger metadata + maps range.start to link.location.offset', () => {
    const signal = makeSignal({
      raw: '@./foo.md',
      range: { start: 42, end: 51 },
      candidates: [
        makeCandidate({
          extractorId: 'at-directive',
          kind: 'references',
          target: 'foo.md',
          confidence: 0.85,
          trigger: { originalTrigger: '@./foo.md', normalizedTrigger: 'foo.md' },
        }),
      ],
    });
    const result = resolveSignals({ signals: [signal], activeProvider: null, extractorOrder: ['at-directive'] });
    strictEqual(result.links.length, 1);
    const link = result.links[0]!;
    strictEqual(link.location?.offset, 42);
    strictEqual(link.trigger?.normalizedTrigger, 'foo.md');
    strictEqual(link.trigger?.originalTrigger, '@./foo.md');
    deepStrictEqual(link.sources, ['at-directive']);
  });

  it('keeps the resolvedSignals array length equal to input length', () => {
    const signals: Signal[] = [
      makeSignal({ range: { start: 0, end: 5 }, candidates: [makeCandidate({ extractorId: 'a' })] }),
      makeSignal({ range: { start: 3, end: 8 }, candidates: [makeCandidate({ extractorId: 'b' })] }),
      makeSignal({ range: { start: 20, end: 25 }, candidates: [makeCandidate({ extractorId: 'c' })] }),
    ];
    const result = resolveSignals({ signals, activeProvider: null, extractorOrder: ['a', 'b', 'c'] });
    strictEqual(result.resolvedSignals.length, 3);
  });
});
