/**
 * Projection + matching for `annotations.issueSuppressions`: qualified
 * and bare analyzer spellings both match, `value` is strict and
 * case-sensitive, malformed entries are skipped defensively.
 */

import { describe, it } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';

import {
  isIssueSuppressed,
  issueSuppressionsFromAnnotations,
} from '../issue-suppressions.js';

const QUALIFIED = 'plug/analyzer-x';

describe('issueSuppressionsFromAnnotations', () => {
  it('projects well-formed entries and keeps the note', () => {
    const entries = issueSuppressionsFromAnnotations({
      issueSuppressions: [
        { analyzer: QUALIFIED, value: '@Token', note: 'intentional prose' },
        { analyzer: 'analyzer-x', value: '@scope/pkg' },
      ],
    });
    deepStrictEqual(entries, [
      { analyzer: QUALIFIED, value: '@Token', note: 'intentional prose' },
      { analyzer: 'analyzer-x', value: '@scope/pkg' },
    ]);
  });

  it('yields [] on absent, non-object, or non-array shapes', () => {
    deepStrictEqual(issueSuppressionsFromAnnotations(null), []);
    deepStrictEqual(issueSuppressionsFromAnnotations(undefined), []);
    deepStrictEqual(issueSuppressionsFromAnnotations('nope'), []);
    deepStrictEqual(issueSuppressionsFromAnnotations({}), []);
    deepStrictEqual(issueSuppressionsFromAnnotations({ issueSuppressions: 'nope' }), []);
  });

  it('skips entries missing the (analyzer, value) key pair', () => {
    const entries = issueSuppressionsFromAnnotations({
      issueSuppressions: [
        { analyzer: QUALIFIED },
        { value: '@Token' },
        { analyzer: '', value: '@Token' },
        { analyzer: QUALIFIED, value: '' },
        null,
        'nope',
        { analyzer: QUALIFIED, value: '@Kept' },
      ],
    });
    deepStrictEqual(entries, [{ analyzer: QUALIFIED, value: '@Kept' }]);
  });
});

describe('isIssueSuppressed', () => {
  const entries = [
    { analyzer: QUALIFIED, value: '@Token' },
    { analyzer: 'analyzer-y', value: '@Other' },
  ];

  it('matches the qualified spelling verbatim', () => {
    strictEqual(isIssueSuppressed(QUALIFIED, '@Token', entries), true);
  });

  it('matches a bare-stored analyzer against the qualified caller id', () => {
    strictEqual(isIssueSuppressed('plug/analyzer-y', '@Other', entries), true);
  });

  it('is exact and case-sensitive on value', () => {
    strictEqual(isIssueSuppressed(QUALIFIED, '@token', entries), false);
    strictEqual(isIssueSuppressed(QUALIFIED, '@Toke', entries), false);
  });

  it('never matches across analyzers', () => {
    strictEqual(isIssueSuppressed('plug/analyzer-z', '@Token', entries), false);
  });

  it('is false over an empty entry list', () => {
    strictEqual(isIssueSuppressed(QUALIFIED, '@Token', []), false);
  });
});
