/**
 * Unit tests for `matchesProviderPrecondition`, the gate enforcing
 * `spec/architecture.md` §Universal extractors and per-provider
 * extractors: a provider-specific extractor runs only when BOTH the
 * node's provider matches the extractor's declared allowlist AND the
 * active lens is in the same allowlist.
 *
 * Universal extractors (no `precondition.provider`) are unaffected
 * by the lens; the gate is a no-op for them.
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
    it('runs on a node with any provider, under any lens', () => {
      const ex = buildExtractor(undefined);
      const cases: ReadonlyArray<{ nodeProvider: string; activeProvider: string | null }> = [
        { nodeProvider: 'claude', activeProvider: 'claude' },
        { nodeProvider: 'claude', activeProvider: 'gemini' },
        { nodeProvider: 'gemini', activeProvider: null },
        { nodeProvider: 'openai', activeProvider: 'agent-skills' },
      ];
      for (const c of cases) {
        strictEqual(
          matchesProviderPrecondition(ex, c.nodeProvider, c.activeProvider),
          true,
          `expected true for node=${c.nodeProvider}, lens=${String(c.activeProvider)}`,
        );
      }
    });

    it('runs even when the allowlist is the empty array', () => {
      // `precondition.provider: []` semantically means "no constraint"
      // (the field is declared but empty). Same outcome as undefined.
      const ex = buildExtractor([]);
      strictEqual(matchesProviderPrecondition(ex, 'claude', 'gemini'), true);
    });
  });

  describe('single-provider extractor (declares [claude])', () => {
    const ex = buildExtractor(['claude']);

    it('runs when both node and lens are claude', () => {
      strictEqual(matchesProviderPrecondition(ex, 'claude', 'claude'), true);
    });

    it('skips when node is claude but lens is gemini (lens mismatch)', () => {
      strictEqual(matchesProviderPrecondition(ex, 'claude', 'gemini'), false);
    });

    it('skips when node is gemini but lens is claude (node mismatch)', () => {
      strictEqual(matchesProviderPrecondition(ex, 'gemini', 'claude'), false);
    });

    it('skips when neither node nor lens is claude', () => {
      strictEqual(matchesProviderPrecondition(ex, 'gemini', 'openai'), false);
    });

    it('skips when active lens is null (no setting, no auto-detect signal)', () => {
      strictEqual(matchesProviderPrecondition(ex, 'claude', null), false);
    });
  });

  describe('multi-provider extractor (declares [claude, gemini])', () => {
    const ex = buildExtractor(['claude', 'gemini']);

    it('runs when both node and lens fall inside the allowlist', () => {
      const cases: ReadonlyArray<{ nodeProvider: string; activeProvider: string }> = [
        { nodeProvider: 'claude', activeProvider: 'claude' },
        { nodeProvider: 'claude', activeProvider: 'gemini' },
        { nodeProvider: 'gemini', activeProvider: 'claude' },
        { nodeProvider: 'gemini', activeProvider: 'gemini' },
      ];
      for (const c of cases) {
        strictEqual(
          matchesProviderPrecondition(ex, c.nodeProvider, c.activeProvider),
          true,
          `expected true for node=${c.nodeProvider}, lens=${c.activeProvider}`,
        );
      }
    });

    it('skips when node is in the allowlist but lens is outside', () => {
      strictEqual(matchesProviderPrecondition(ex, 'claude', 'openai'), false);
    });

    it('skips when lens is in the allowlist but node is outside', () => {
      strictEqual(matchesProviderPrecondition(ex, 'openai', 'claude'), false);
    });

    it('skips when active lens is null', () => {
      strictEqual(matchesProviderPrecondition(ex, 'claude', null), false);
    });
  });
});
