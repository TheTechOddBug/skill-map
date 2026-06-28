/**
 * Coverage for `detectUnclosedBacktick` (`orchestrator/body-syntax.ts`),
 * the kernel body-syntax check stamped during the walk. The detection
 * logic itself is pinned in `util/__tests__/strip-code-blocks.spec.ts`
 * (`findBacktickImbalance`); these tests pin the Issue shape, the
 * `backtick-unbalanced` analyzerId, and the strict severity lift.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

import { detectUnclosedBacktick } from '../body-syntax.js';

describe('detectUnclosedBacktick', () => {
  it('returns null for a balanced body', () => {
    assert.equal(detectUnclosedBacktick('A `inline` span and\n```\ncode\n```\n', 'a.md', false), null);
  });

  it('emits a warn backtick-unbalanced issue for an unclosed fence', () => {
    const issue = detectUnclosedBacktick('intro\n```js\ncode\n', 'a.md', false);
    assert.ok(issue);
    assert.equal(issue.analyzerId, 'backtick-unbalanced');
    assert.equal(issue.severity, 'warn');
    assert.deepEqual(issue.nodeIds, ['a.md']);
    assert.equal(issue.data?.['kind'], 'fence');
    assert.equal(issue.data?.['line'], 2);
    assert.match(issue.message, /unclosed fenced code block/i);
  });

  it('emits an inline issue carrying the offending source line as detail', () => {
    const issue = detectUnclosedBacktick('ok\nthen `oops here\n', 'b.md', false);
    assert.ok(issue);
    assert.equal(issue.data?.['kind'], 'inline');
    assert.equal(issue.detail, 'then `oops here');
  });

  it('lifts severity to error under strict', () => {
    const issue = detectUnclosedBacktick('intro\n```js\ncode\n', 'a.md', true);
    assert.equal(issue?.severity, 'error');
  });
});
