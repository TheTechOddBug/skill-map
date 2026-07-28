/**
 * Regression coverage for the bounded YAML entry point (audit H2).
 *
 * A "billion laughs" document, a few hundred bytes of mutually
 * referencing anchors, used to parse fine (js-yaml returns a cheap
 * shared-reference DAG) and then exhaust the heap the moment anything
 * materialised it, taking the whole `sm serve` process down.
 *
 * The load-bearing case is the FIRST one: it uses only 81 alias tokens,
 * comfortably under `maxAliases: 100`, and still denotes 9^9 nodes. It
 * exists to prove the parser cap alone is not the defence, the expansion
 * budget is. A first cut of this fix set only `maxAliases` and looked
 * green against a weaker test; this case caught it.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { YAMLException } from 'js-yaml';

import { loadYamlSafe, YAML_LOAD_LIMITS, YAML_MAX_EXPANDED_NODES } from '../safe-yaml.js';

/**
 * Exponential alias expansion: each level references the previous one
 * `fanOut` times, so `levels` levels denote `fanOut^levels` leaves from a
 * payload that stays a few hundred bytes on disk. Total alias TOKENS is
 * `fanOut * levels`, which is what `maxAliases` counts.
 */
function billionLaughs(levels: number, fanOut: number): string {
  const lines = ['a0: &a0 "boom"'];
  for (let i = 1; i <= levels; i += 1) {
    const refs = Array.from({ length: fanOut }, () => `*a${i - 1}`).join(', ');
    lines.push(`a${i}: &a${i} [${refs}]`);
  }
  return lines.join('\n');
}

describe('loadYamlSafe, alias-expansion bound', () => {
  it('refuses a bomb that stays UNDER the alias cap (9^9 nodes, 81 tokens)', () => {
    const bomb = billionLaughs(9, 9);
    // 81 alias tokens: under `maxAliases: 100`, so the parser cap does
    // not fire. Only the expansion budget can catch this one.
    assert.ok(9 * 9 < YAML_LOAD_LIMITS.maxAliases, 'bomb must stay under the token cap');
    // The payload really is tiny: no byte cap could have caught it.
    assert.ok(bomb.length < 1024, `bomb is ${bomb.length} bytes`);
    assert.throws(
      () => loadYamlSafe(bomb),
      (err: unknown) => err instanceof YAMLException && /node budget/.test((err as Error).message),
      'expected a YAMLException naming the expansion budget',
    );
  });

  it('refuses the low-fan-out shape too (2 refs per level buys 2^N/2)', () => {
    assert.throws(
      () => loadYamlSafe(billionLaughs(40, 2)),
      (err: unknown) => err instanceof YAMLException,
    );
  });

  it('refuses a cyclic anchor outright (denotes an infinite document)', () => {
    assert.throws(
      () => loadYamlSafe('a: &a\n  self: *a\n'),
      (err: unknown) => err instanceof YAMLException && /cyclic/.test((err as Error).message),
    );
  });

  it('completes fast, the budget check costs distinct nodes, not expanded ones', () => {
    const started = process.hrtime.bigint();
    assert.throws(() => loadYamlSafe(billionLaughs(9, 9)));
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    // Materialising 9^9 nodes would take minutes and blow the heap;
    // memoised measurement is effectively instant.
    assert.ok(elapsedMs < 1000, `budget check took ${elapsedMs}ms`);
  });

  it('the cap is the only limit that departs from the js-yaml defaults', () => {
    // maxDepth / maxTotalMergeKeys match upstream defaults and exist to
    // pin them; maxAliases is the one that closes the hole (upstream
    // default is -1, unlimited).
    assert.equal(YAML_LOAD_LIMITS.maxAliases, 100);
    assert.equal(YAML_LOAD_LIMITS.maxDepth, 100);
    assert.equal(YAML_LOAD_LIMITS.maxTotalMergeKeys, 10_000);
    assert.equal(YAML_MAX_EXPANDED_NODES, 100_000);
  });

  it('honest documents still parse, including modest anchor reuse', () => {
    const doc = loadYamlSafe(['base: &base', '  kind: skill', 'a: *base', 'b: *base'].join('\n'));
    assert.deepEqual(doc, {
      base: { kind: 'skill' },
      a: { kind: 'skill' },
      b: { kind: 'skill' },
    });
  });

  it('merge keys do not merge under the JSON_SCHEMA pin (they stay literal)', () => {
    // Documents the reason `maxTotalMergeKeys` is belt-and-braces here:
    // the `<<` merge type belongs to the default schema, which the pin
    // excludes, so merge expansion is unreachable in the first place.
    const doc = loadYamlSafe(['base: &base', '  kind: skill', 'a:', '  <<: *base'].join('\n')) as {
      a: Record<string, unknown>;
    };
    assert.deepEqual(Object.keys(doc.a), ['<<']);
  });

  it('keeps the JSON_SCHEMA pin, executable tags never construct', () => {
    assert.throws(() => loadYamlSafe('fn: !!js/function "function () { return 1; }"'));
  });

  it('an empty document throws, the js-yaml 5 behaviour callers special-case', () => {
    // `plugins/core/parsers/frontmatter-yaml` classifies this throw as
    // "declared but empty" rather than an authoring defect; the helper
    // must not paper over it.
    assert.throws(() => loadYamlSafe('   \n# just a comment\n'), YAMLException);
  });
});
