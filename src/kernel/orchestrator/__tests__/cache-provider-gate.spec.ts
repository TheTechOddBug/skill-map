/**
 * Unit tests for `matchesProviderPrecondition`, the gate enforcing
 * `spec/architecture.md` §Universal extractors and per-provider
 * extractors: a provider-specific extractor runs when the active lens
 * is in the extractor's declared allowlist, regardless of which
 * provider classified the node.
 *
 * Universal extractors (no `precondition.provider`) are unaffected
 * by the lens; the gate is a no-op for them.
 *
 * The node's own provider is intentionally NOT part of the gate (see
 * the function's docstring): the lens is the single discriminator,
 * because the runtime grammar it represents applies across every
 * markdown surface, including files the provider's `classify()`
 * disclaimed to `core/markdown`.
 */

import { describe, it } from 'node:test';
import { strictEqual } from 'node:assert';

import type { IExtractor } from '../../extensions/index.js';
import { matchesProviderPrecondition } from '../cache.js';

function buildExtractor(providers: readonly string[] | undefined): IExtractor {
  return {
    id: 'fixture',
    pluginId: 'fixture-plugin',
    kind: 'extractor',
    version: '1.0.0',
    description: 'Fixture extractor for the provider gate tests.',
    scope: 'body',
    ...(providers ? { precondition: { provider: providers.slice() } } : {}),
    extract(): void {},
  };
}

describe('matchesProviderPrecondition', () => {
  describe('universal extractors (no precondition.provider)', () => {
    it('runs under any lens, including null', () => {
      const ex = buildExtractor(undefined);
      const cases: ReadonlyArray<string | null> = [
        'claude',
        'antigravity',
        'openai',
        'agent-skills',
        null,
      ];
      for (const activeProvider of cases) {
        strictEqual(
          matchesProviderPrecondition(ex, activeProvider),
          true,
          `expected true for lens=${String(activeProvider)}`,
        );
      }
    });

    it('runs even when the allowlist is the empty array', () => {
      // `precondition.provider: []` semantically means "no constraint"
      // (the field is declared but empty). Same outcome as undefined.
      const ex = buildExtractor([]);
      strictEqual(matchesProviderPrecondition(ex, 'antigravity'), true);
    });
  });

  describe('single-provider extractor (declares [claude])', () => {
    const ex = buildExtractor(['claude']);

    it('runs when the lens is claude', () => {
      strictEqual(matchesProviderPrecondition(ex, 'claude'), true);
    });

    it('skips when the lens is antigravity', () => {
      strictEqual(matchesProviderPrecondition(ex, 'antigravity'), false);
    });

    it('skips when the lens is null (no setting, no auto-detect signal)', () => {
      strictEqual(matchesProviderPrecondition(ex, null), false);
    });
  });

  describe('multi-provider extractor (declares [claude, antigravity])', () => {
    const ex = buildExtractor(['claude', 'antigravity']);

    it('runs when the lens is in the allowlist', () => {
      strictEqual(matchesProviderPrecondition(ex, 'claude'), true);
      strictEqual(matchesProviderPrecondition(ex, 'antigravity'), true);
    });

    it('skips when the lens is outside the allowlist', () => {
      strictEqual(matchesProviderPrecondition(ex, 'openai'), false);
    });

    it('skips when the lens is null', () => {
      strictEqual(matchesProviderPrecondition(ex, null), false);
    });
  });
});
