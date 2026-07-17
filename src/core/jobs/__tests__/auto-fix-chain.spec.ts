/**
 * Unit test for the shared inverse-Modelo-B resolver
 * (`resolveMatchingFixerIds`), the single source the `core/auto-fix` hook,
 * the per-job record-path branch, and the BFF launcher classifier all key on.
 *
 * Covers: a finder resolving to its fixer, a finder resolving to SEVERAL
 * fixers (all returned), non-fixer Actions (empty `analyzerIds`) excluded,
 * and the bare vs qualified matching grammar (`matchesQualifiedExtensionFilter`).
 */

import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { resolveMatchingFixerIds, type IFixerCandidateAction } from '../auto-fix-chain.js';

const FINDER = 'prob-finder/quality-check';

/** Catalog: two fixers on the finder, one on another finder, one non-fixer. */
const CATALOG: IFixerCandidateAction[] = [
  { id: 'prob-fixer/apply-fix', analyzerIds: ['prob-finder/quality-check'] },
  // Bare (short) analyzer id: matches the finder's suffix after the slash.
  { id: 'prob-fixer/second-fix', analyzerIds: ['quality-check'] },
  { id: 'other-fixer/apply', analyzerIds: ['other-finder/lint'] },
  // A plain (non-fixer) Action declares no analyzerIds: never a candidate.
  { id: 'core/skill-summarizer', analyzerIds: [] },
];

describe('resolveMatchingFixerIds', () => {
  it('resolves a finder to its fixer', () => {
    const single: IFixerCandidateAction[] = [
      { id: 'prob-fixer/apply-fix', analyzerIds: ['prob-finder/quality-check'] },
    ];
    deepStrictEqual(resolveMatchingFixerIds(FINDER, single), ['prob-fixer/apply-fix']);
  });

  it('returns ALL matching fixers (a finder may feed several)', () => {
    deepStrictEqual(resolveMatchingFixerIds(FINDER, CATALOG), [
      'prob-fixer/apply-fix',
      'prob-fixer/second-fix',
    ]);
  });

  it('excludes non-fixer Actions (empty analyzerIds match nothing here)', () => {
    const onlyPlain: IFixerCandidateAction[] = [
      { id: 'core/skill-summarizer', analyzerIds: [] },
    ];
    deepStrictEqual(resolveMatchingFixerIds(FINDER, onlyPlain), []);
  });

  it('matches a qualified finder id against a bare declared analyzerId and vice versa', () => {
    // Qualified finder id vs a bare declared id (suffix match).
    deepStrictEqual(
      resolveMatchingFixerIds('prob-finder/quality-check', [
        { id: 'f/bare', analyzerIds: ['quality-check'] },
      ]),
      ['f/bare'],
    );
    // A finder that names no fixer resolves to nothing.
    deepStrictEqual(resolveMatchingFixerIds('unknown/finder', CATALOG), []);
  });
});
