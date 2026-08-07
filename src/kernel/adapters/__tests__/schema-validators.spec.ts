/**
 * Module-level cache for `loadSchemaValidators`. The CLI
 * pays ~100 ms cold to read + AJV-compile 17 schemas (plus 8 supporting
 * `$ref` targets) on every invocation. Caching lets a second call in
 * the same process return the same instance for free, which matters as
 * future verbs validate at multiple boundaries (today: only
 * `sm history stats --json` does it once; tomorrow: `sm doctor`,
 * `sm record`, etc. will too).
 */

import { describe, it, after } from 'node:test';
import { strictEqual, ok } from 'node:assert/strict';

import {
  _resetSchemaValidatorsCacheForTests,
  loadSchemaValidators,
  SCHEMA_NAMES,
  type TSchemaName,
} from '../schema-validators.js';

after(() => {
  // Leave the global cache in a clean state for any later test that runs
  // in the same process.
  _resetSchemaValidatorsCacheForTests();
});

describe('loadSchemaValidators (module-level cache)', () => {
  it('returns the SAME instance across calls in the same process', () => {
    _resetSchemaValidatorsCacheForTests();
    const a = loadSchemaValidators();
    const b = loadSchemaValidators();
    strictEqual(a, b, 'cached call must reuse the prior instance');
  });

  it('the cached validator stays functional (validate works on cached instance)', () => {
    _resetSchemaValidatorsCacheForTests();
    const v = loadSchemaValidators();
    // Pull the same instance again, then validate against it. If the cache
    // returned a stale or torn-down object, this would throw.
    const again = loadSchemaValidators();
    strictEqual(v, again);
    const result = again.validate('issue', {
      analyzerId: 'orphan',
      severity: 'info',
      nodeIds: ['skills/foo.md'],
      message: 'Orphan',
    });
    ok(result.ok, `validate() must work on cached instance; got: ${result.ok ? '' : result.errors}`);
  });

  it('the test-only reset hook produces a fresh instance', () => {
    _resetSchemaValidatorsCacheForTests();
    const a = loadSchemaValidators();
    _resetSchemaValidatorsCacheForTests();
    const b = loadSchemaValidators();
    ok(a !== b, 'reset must force a new instance on the next call');
  });
});

describe('lazy per-schema compile', () => {
  it('every declared schema name compiles through the lazy path', () => {
    // Guards the lazy split against a missing supporting `$ref`: the
    // historical eager loop compiled everything at load() and would
    // have caught a broken reference at boot; this sweep keeps that
    // coverage by forcing codegen for the full catalog.
    _resetSchemaValidatorsCacheForTests();
    const v = loadSchemaValidators();
    for (const name of SCHEMA_NAMES) {
      const fn = v.getValidator(name);
      strictEqual(typeof fn, 'function', `getValidator('${name}') must compile`);
    }
    for (const kind of ['provider', 'extractor', 'analyzer', 'action', 'formatter', 'hook'] as const) {
      strictEqual(typeof v.validatorForExtension(kind), 'function');
    }
  });

  it('compiles on demand and memoizes: same function instance across calls', () => {
    _resetSchemaValidatorsCacheForTests();
    const v = loadSchemaValidators();
    const first = v.getValidator('node');
    const second = v.getValidator('node');
    strictEqual(first, second, 'per-name compile must be cached');
  });

  it('an unknown schema name still throws the documented error', () => {
    _resetSchemaValidatorsCacheForTests();
    const v = loadSchemaValidators();
    let threw = false;
    try {
      v.getValidator('nope' as TSchemaName);
    } catch (err) {
      threw = true;
      ok(String(err).includes('Unknown schema: nope'));
    }
    ok(threw, 'unknown names must throw, not return undefined');
  });

  it('validatePluginManifest compiles lazily and still validates', () => {
    _resetSchemaValidatorsCacheForTests();
    const v = loadSchemaValidators();
    const bad = v.validatePluginManifest({});
    ok(!bad.ok, 'an empty object is not a valid plugin manifest');
  });
});
