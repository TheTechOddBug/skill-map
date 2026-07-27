/**
 * Pure edit helpers for `annotations.issueSuppressions`: idempotent
 * merge keyed on (analyzer, value) with bidirectional qualified/bare
 * analyzer equivalence, removal echoing the entry taken out, and the
 * entry builder's optional-note shape.
 */

import { describe, it } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';

import {
  buildIssueSuppressionEntry,
  existingIssueSuppressions,
  issueSuppressionAnalyzersEquivalent,
  mergeIssueSuppression,
  removeIssueSuppression,
} from '../suppression-edit.js';

describe('existingIssueSuppressions', () => {
  it('reads the array and filters non-object entries', () => {
    const entries = existingIssueSuppressions({
      issueSuppressions: [{ analyzer: 'a', value: 'v' }, 'nope', null, 42],
    });
    deepStrictEqual(entries, [{ analyzer: 'a', value: 'v' }]);
  });

  it('yields [] on absent annotations or non-array field', () => {
    deepStrictEqual(existingIssueSuppressions(null), []);
    deepStrictEqual(existingIssueSuppressions(undefined), []);
    deepStrictEqual(existingIssueSuppressions({}), []);
    deepStrictEqual(existingIssueSuppressions({ issueSuppressions: 'nope' }), []);
  });
});

describe('issueSuppressionAnalyzersEquivalent', () => {
  it('accepts verbatim equality and bare-vs-qualified in both directions', () => {
    strictEqual(issueSuppressionAnalyzersEquivalent('plug/x', 'plug/x'), true);
    strictEqual(issueSuppressionAnalyzersEquivalent('x', 'plug/x'), true);
    strictEqual(issueSuppressionAnalyzersEquivalent('plug/x', 'x'), true);
    strictEqual(issueSuppressionAnalyzersEquivalent('x', 'x'), true);
  });

  it('rejects different qualified ids sharing a suffix, and non-strings', () => {
    strictEqual(issueSuppressionAnalyzersEquivalent('plug/x', 'other/x'), false);
    strictEqual(issueSuppressionAnalyzersEquivalent('plug/x', 'plug/y'), false);
    strictEqual(issueSuppressionAnalyzersEquivalent(undefined, 'x'), false);
    strictEqual(issueSuppressionAnalyzersEquivalent('x', 42), false);
  });
});

describe('mergeIssueSuppression', () => {
  const standing = [{ analyzer: 'core/reference-broken', value: '@ApiSecurity' }];

  it('appends a new (analyzer, value) pair', () => {
    const merged = mergeIssueSuppression(standing, {
      analyzer: 'core/reference-broken',
      value: '@nestjs/swagger',
    });
    strictEqual(merged.length, 2);
  });

  it('is idempotent across spellings and ignores the note', () => {
    const merged = mergeIssueSuppression(standing, {
      analyzer: 'reference-broken',
      value: '@ApiSecurity',
      note: 'different note',
    });
    deepStrictEqual(merged, standing);
  });

  it('treats a case-variant value as a new entry', () => {
    const merged = mergeIssueSuppression(standing, {
      analyzer: 'core/reference-broken',
      value: '@apisecurity',
    });
    strictEqual(merged.length, 2);
  });
});

describe('removeIssueSuppression', () => {
  const standing = [
    { analyzer: 'core/reference-broken', value: '@ApiSecurity', note: 'kept' },
    { analyzer: 'core/reference-broken', value: '@nestjs/swagger' },
  ];

  it('removes by exact pair and echoes the removed entry', () => {
    const { remaining, removed } = removeIssueSuppression(
      standing,
      'reference-broken',
      '@ApiSecurity',
    );
    deepStrictEqual(removed, { analyzer: 'core/reference-broken', value: '@ApiSecurity', note: 'kept' });
    deepStrictEqual(remaining, [{ analyzer: 'core/reference-broken', value: '@nestjs/swagger' }]);
  });

  it('returns null removed and the untouched list on no match', () => {
    const { remaining, removed } = removeIssueSuppression(
      standing,
      'core/reference-broken',
      '@absent',
    );
    strictEqual(removed, null);
    deepStrictEqual(remaining, standing);
  });
});

describe('buildIssueSuppressionEntry', () => {
  it('carries the note only when non-empty', () => {
    deepStrictEqual(buildIssueSuppressionEntry('core/reference-broken', '@X', 'why'), {
      analyzer: 'core/reference-broken',
      value: '@X',
      note: 'why',
    });
    deepStrictEqual(buildIssueSuppressionEntry('core/reference-broken', '@X', undefined), {
      analyzer: 'core/reference-broken',
      value: '@X',
    });
    deepStrictEqual(buildIssueSuppressionEntry('core/reference-broken', '@X', ''), {
      analyzer: 'core/reference-broken',
      value: '@X',
    });
  });
});
