/**
 * `kernel/util/analyzer-filter.ts:matchesAnalyzerFilter`, the shared
 * `--analyzers` / `?analyzerId=` matcher.
 *
 * The persisted `analyzerId` is SHORT / kebab-case with no `/` (spec
 * `issue.schema.json` pins `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`). The filter
 * accepts BOTH the short form (`node-stability`) and the qualified
 * `<plugin>/<id>` form (`core/node-stability`), matching either against
 * the short stored id. The regression that motivated these tests: a
 * qualified filter entry (`core/node-stability`) used to fail to match a
 * short stored id (`node-stability`) because the matcher only stripped
 * the suffix from the (slash-less) stored id and never from the filter.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { matchesAnalyzerFilter } from '../analyzer-filter.js';

describe('matchesAnalyzerFilter', () => {
  it('matches an empty filter against anything', () => {
    assert.equal(matchesAnalyzerFilter('node-stability', []), true);
  });

  it('matches the short stored id against a short filter entry', () => {
    assert.equal(matchesAnalyzerFilter('node-stability', ['node-stability']), true);
  });

  it('matches the short stored id against a QUALIFIED filter entry (the bug)', () => {
    // `core/foo` filter vs the persisted short `foo`: this is the
    // regression. Previously returned false because the matcher never
    // reduced the filter entry to its suffix.
    assert.equal(matchesAnalyzerFilter('foo', ['core/foo']), true);
    assert.equal(
      matchesAnalyzerFilter('node-stability', ['core/node-stability']),
      true,
    );
  });

  it('matches when one entry in a mixed filter list qualifies', () => {
    assert.equal(
      matchesAnalyzerFilter('node-stability', [
        'core/schema-violation',
        'core/node-stability',
      ]),
      true,
    );
  });

  it('does not match a non-listed short id', () => {
    assert.equal(matchesAnalyzerFilter('node-stability', ['schema-violation']), false);
    assert.equal(
      matchesAnalyzerFilter('node-stability', ['core/schema-violation']),
      false,
    );
  });

  it('does not match when only the plugin prefix differs but the suffix is wrong', () => {
    assert.equal(matchesAnalyzerFilter('foo', ['core/bar']), false);
  });

  it('matches a QUALIFIED arg against a short filter entry (prob-advisory path)', () => {
    // `detectProbAnalyzerIds` passes the qualified id and lets a short
    // filter token match its suffix. Symmetric to the persisted-issue path.
    assert.equal(matchesAnalyzerFilter('core/foo', ['foo']), true);
  });

  it('matches a QUALIFIED arg against an identical qualified filter entry', () => {
    assert.equal(matchesAnalyzerFilter('core/foo', ['core/foo']), true);
  });

  it('does not match a QUALIFIED arg against an unrelated short filter entry', () => {
    assert.equal(matchesAnalyzerFilter('core/foo', ['bar']), false);
  });
});
