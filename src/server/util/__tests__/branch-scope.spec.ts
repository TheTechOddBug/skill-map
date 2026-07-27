/**
 * Unit contract of the shared branch-scope resolver
 * (`spec/cli-contract.md` §Map scope overrides): filtering, de-dup,
 * the root-inference rule, and the include/exclude conflict.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { resolveBranchScope } from '../branch-scope.js';

describe('resolveBranchScope', () => {
  it('no params resolves to the whole corpus (root included, nothing listed)', () => {
    const r = resolveBranchScope({ include: [], exclude: [] });
    assert.ok(r.ok);
    assert.deepEqual(r.scope, { include: [], exclude: [], rootExcluded: false });
  });

  it('filters empty strings and de-dupes both lists', () => {
    const r = resolveBranchScope({
      include: ['app', '', 'app'],
      exclude: ['noise', 'noise', ''],
    });
    assert.ok(r.ok);
    assert.deepEqual(r.scope.include, ['app']);
    assert.deepEqual(r.scope.exclude, ['noise']);
  });

  it('infers an excluded root for a bare include list (historical union form)', () => {
    const r = resolveBranchScope({ include: ['app'], exclude: [] });
    assert.ok(r.ok);
    assert.equal(r.scope.rootExcluded, true);
  });

  it('infers an included root when every include only rescues part of an exclude', () => {
    const r = resolveBranchScope({
      include: ['vendor/keep'],
      exclude: ['vendor'],
    });
    assert.ok(r.ok);
    assert.equal(r.scope.rootExcluded, false);
  });

  it('infers an excluded root when ANY include stands outside every exclude', () => {
    const r = resolveBranchScope({
      include: ['vendor/keep', 'app'],
      exclude: ['vendor'],
    });
    assert.ok(r.ok);
    assert.equal(r.scope.rootExcluded, true);
  });

  it('infers an included root for the pure-subtractive form (excludes only)', () => {
    const r = resolveBranchScope({ include: [], exclude: ['noise'] });
    assert.ok(r.ok);
    assert.equal(r.scope.rootExcluded, false);
  });

  it('a stated excludeRoot always beats the inference', () => {
    const explicitOff = resolveBranchScope({
      include: ['app'],
      exclude: [],
      excludeRoot: false,
    });
    assert.ok(explicitOff.ok);
    assert.equal(explicitOff.scope.rootExcluded, false);

    const explicitOn = resolveBranchScope({
      include: [],
      exclude: [],
      excludeRoot: true,
    });
    assert.ok(explicitOn.ok);
    assert.equal(explicitOn.scope.rootExcluded, true);
  });

  it('the string-prefix boundary does not fool the inference (app vs app2)', () => {
    // `app2` is NOT under `app/`, so the include stands outside every
    // exclude and the root infers excluded.
    const r = resolveBranchScope({ include: ['app2'], exclude: ['app'] });
    assert.ok(r.ok);
    assert.equal(r.scope.rootExcluded, true);
  });

  it('rejects a path present in both lists, naming it', () => {
    const r = resolveBranchScope({
      include: ['app', 'docs'],
      exclude: ['docs'],
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.conflictPath, 'docs');
  });
});
