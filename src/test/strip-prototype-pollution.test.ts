/**
 * Unit tests for the shared prototype-pollution defence.
 *
 * The helper is the trust-boundary primitive used by every parser that
 * accepts external JSON / YAML (settings, sidecars, plugin manifests).
 * If `__proto__` ever leaked through here, every downstream consumer
 * would inherit the pollution, so the tests cover the shape variations
 * the helper accepts.
 *
 * Note: tainted fixtures are built via `JSON.parse('{"__proto__": …}')`
 * the only reliable way to land `__proto__` as an OWN property. The
 * object-literal form `{ __proto__: x }` is the ES2015 special syntax
 * that sets `[[Prototype]]` instead of an own property.
 */

import { describe, it } from 'node:test';
import {
  deepStrictEqual,
  ok,
  strictEqual,
} from 'node:assert';

import {
  FORBIDDEN_KEYS,
  stripPrototypePollution,
} from '../kernel/util/strip-prototype-pollution.js';

describe('stripPrototypePollution', () => {
  it('exports the closed forbidden-key set', () => {
    deepStrictEqual(
      [...FORBIDDEN_KEYS].sort(),
      ['__proto__', 'constructor', 'prototype'],
    );
  });

  it('passes primitives through unchanged', () => {
    strictEqual(stripPrototypePollution(null), null);
    strictEqual(stripPrototypePollution(undefined), undefined);
    strictEqual(stripPrototypePollution(42), 42);
    strictEqual(stripPrototypePollution('hello'), 'hello');
    strictEqual(stripPrototypePollution(true), true);
  });

  it('removes forbidden keys at the top level', () => {
    const tainted = JSON.parse(
      '{"ok": 1, "__proto__": {"polluted": true}, "constructor": "bad", "prototype": "also bad"}',
    );
    const cleaned = stripPrototypePollution(tainted) as Record<string, unknown>;
    deepStrictEqual(cleaned, { ok: 1 });
    strictEqual(
      Object.prototype.hasOwnProperty.call(cleaned, '__proto__'),
      false,
    );
    strictEqual(
      Object.prototype.hasOwnProperty.call(cleaned, 'constructor'),
      false,
    );
    strictEqual(
      Object.prototype.hasOwnProperty.call(cleaned, 'prototype'),
      false,
    );
  });

  it('removes forbidden keys at every nested depth', () => {
    const tainted = JSON.parse(`{
      "level1": {
        "ok": "a",
        "__proto__": {"polluted": "L1"},
        "level2": {
          "ok": "b",
          "constructor": "polluted-L2",
          "arr": [
            {"ok": "inArray", "prototype": "polluted-array-item"}
          ]
        }
      }
    }`);
    const cleaned = stripPrototypePollution(tainted);
    deepStrictEqual(cleaned, {
      level1: {
        ok: 'a',
        level2: {
          ok: 'b',
          arr: [{ ok: 'inArray' }],
        },
      },
    });
  });

  it('does not mutate the input', () => {
    const input = JSON.parse('{"ok": 1, "__proto__": {"polluted": true}}');
    stripPrototypePollution(input);
    ok(Object.prototype.hasOwnProperty.call(input, '__proto__'));
  });

  it('preserves arrays of primitives', () => {
    deepStrictEqual(
      stripPrototypePollution([1, 'two', null, true]),
      [1, 'two', null, true],
    );
  });

  it('does NOT pollute Object.prototype as a side effect', () => {
    const tainted = JSON.parse('{"__proto__": {"polluted": true}}');
    stripPrototypePollution(tainted);
    strictEqual(
      (Object.prototype as Record<string, unknown>)['polluted'],
      undefined,
    );
  });
});
