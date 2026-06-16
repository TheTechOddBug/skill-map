/**
 * Unit tests for the global link-dedup pass that runs after
 * `walkAndExtract` and before `recomputeLinkCounts` / analyzers.
 *
 * The deduper is the single source of truth for "two extracts of the
 * same edge collapse into one persisted row"; the canonical case is two
 * extractors converging on the same edge (e.g. a body markdown-link and
 * a sidecar annotation both resolving `A → B` as `references`), which
 * produces two identical `(A→B, references)` emits. Without dedup the
 * link counters double-count.
 */

import { describe, it } from 'node:test';
import { strictEqual, deepStrictEqual } from 'node:assert';

import { dedupeLinks } from '../extractors.js';
import type { Link } from '../../types.js';

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

describe('dedupeLinks', () => {
  it('returns an empty array when given an empty input', () => {
    deepStrictEqual(dedupeLinks([]), []);
  });

  it('passes a single link through unchanged', () => {
    const link = mockLink({});
    const out = dedupeLinks([link]);
    strictEqual(out.length, 1);
    strictEqual(out[0], link);
  });

  it('collapses two identical `(source, target, kind, trigger)` emissions', () => {
    // Two extractors converged on the same edge: both produced an
    // identical `(A→B, references)` emit. After dedup, exactly one
    // survives.
    const a = mockLink({ kind: 'references', sources: ['markdown-link'] });
    const b = mockLink({ kind: 'references', sources: ['markdown-link'] });
    const out = dedupeLinks([a, b]);
    strictEqual(out.length, 1);
  });

  it('keeps edges that differ in `kind` (same endpoints)', () => {
    const ref = mockLink({ kind: 'references' });
    const inv = mockLink({ kind: 'invokes' });
    const out = dedupeLinks([ref, inv]);
    strictEqual(out.length, 2);
  });

  it('keeps references + points rows with identical endpoints AND trigger (Decision #127)', () => {
    // The markdown-link + backtick-path coexistence contract: both
    // extractors resolve the same target (same normalizedTrigger), but
    // the kinds differ, so the rows MUST survive as two edges with
    // their own attributions, never a sources union.
    const prose = mockLink({
      kind: 'references',
      sources: ['markdown-link'],
      trigger: { originalTrigger: 'refs/a.md', normalizedTrigger: 'skills/demo/refs/a.md' },
    });
    const backtick = mockLink({
      kind: 'points',
      sources: ['backtick-path'],
      trigger: { originalTrigger: 'refs/a.md', normalizedTrigger: 'skills/demo/refs/a.md' },
    });
    const out = dedupeLinks([prose, backtick]);
    strictEqual(out.length, 2);
    deepStrictEqual(out[0]!.sources, ['markdown-link']);
    deepStrictEqual(out[1]!.sources, ['backtick-path']);
  });

  it('keeps edges that differ in direction (A→B vs B→A)', () => {
    const ab = mockLink({ source: 'a.md', target: 'b.md' });
    const ba = mockLink({ source: 'b.md', target: 'a.md' });
    const out = dedupeLinks([ab, ba]);
    strictEqual(out.length, 2);
  });

  it('treats different `normalizedTrigger` values as distinct edges', () => {
    // Two slash invocations targetting the same node via different
    // aliases. Each is a real edge with its own provenance.
    const t1 = mockLink({
      kind: 'invokes',
      sources: ['slash'],
      trigger: { originalTrigger: '/deploy', normalizedTrigger: '/deploy' },
    });
    const t2 = mockLink({
      kind: 'invokes',
      sources: ['slash'],
      trigger: { originalTrigger: '/deploy-alt', normalizedTrigger: '/deploy alt' },
    });
    const out = dedupeLinks([t1, t2]);
    strictEqual(out.length, 2);
  });

  it('unions `sources[]` from duplicate emissions, preserving first-seen order', () => {
    // Same edge surfaced by two extractors: body markdown-link AND
    // backtick-path. The deduped row keeps both attributions so a future
    // inspector can render "this edge comes from N sources".
    const fromBody = mockLink({ sources: ['markdown-link'] });
    const fromBacktick = mockLink({ sources: ['backtick-path'] });
    const out = dedupeLinks([fromBody, fromBacktick]);
    strictEqual(out.length, 1);
    deepStrictEqual(out[0]!.sources, ['markdown-link', 'backtick-path']);
  });

  it('does not duplicate a source value when both occurrences already list it', () => {
    const a = mockLink({ sources: ['markdown-link'] });
    const b = mockLink({ sources: ['markdown-link'] });
    const out = dedupeLinks([a, b]);
    strictEqual(out.length, 1);
    deepStrictEqual(out[0]!.sources, ['markdown-link']);
  });

  it('keeps the FIRST occurrence as the winner (deterministic order)', () => {
    const first = mockLink({ confidence: 0.9 });
    const second = mockLink({ confidence: 0.3 });
    const out = dedupeLinks([first, second]);
    strictEqual(out.length, 1);
    // The first-seen Link object wins, the merged `sources` mutates
    // it in place. The confidence reflects the merge policy
    // (max-of-both), which in this case stays 0.9 because the second
    // duplicate is weaker.
    strictEqual(out[0]!.confidence, 0.9);
  });

  it('bumps confidence to the maximum when a later duplicate has a stronger signal', () => {
    // Real-world case: `at-directive` (0.85) emits first, then
    // `markdown-link` (0.95) emits the same edge on the same node. The
    // merged record carries the markdown-link's stronger 0.95 so the
    // UI's opacity / confidence-driven rules see the strongest signal.
    const atDirective = mockLink({ confidence: 0.85, sources: ['at-directive'] });
    const markdownLink = mockLink({ confidence: 0.95, sources: ['markdown-link'] });
    const out = dedupeLinks([atDirective, markdownLink]);
    strictEqual(out.length, 1);
    strictEqual(out[0]!.confidence, 0.95);
    deepStrictEqual(out[0]!.sources, ['at-directive', 'markdown-link']);
  });

  it('handles many duplicates of the same edge in one pass', () => {
    const links = Array.from({ length: 50 }, () =>
      mockLink({ kind: 'references', sources: ['markdown-link'] }),
    );
    const out = dedupeLinks(links);
    strictEqual(out.length, 1);
  });
});
