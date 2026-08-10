import { describe, it } from 'node:test';
import { deepStrictEqual, ok, strictEqual } from 'node:assert';

import { frontmatterYamlParser } from '../index.js';

describe('parsers/frontmatter-yaml', () => {
  it('parses well-formed frontmatter and preserves the body verbatim', () => {
    const raw = '---\nname: foo\ndescription: bar\n---\nbody text';
    const out = frontmatterYamlParser.parse(raw, 'test.md');
    deepStrictEqual(out.frontmatter, { name: 'foo', description: 'bar' });
    strictEqual(out.frontmatterRaw, 'name: foo\ndescription: bar');
    strictEqual(out.body, 'body text');
  });

  it('returns empty frontmatter when there is no fence', () => {
    const raw = 'just body, no frontmatter';
    const out = frontmatterYamlParser.parse(raw, 'test.md');
    deepStrictEqual(out.frontmatter, {});
    strictEqual(out.frontmatterRaw, '');
    strictEqual(out.body, raw);
  });

  it('returns empty frontmatter when YAML is malformed', () => {
    // Tab indentation inside a mapping is a YAML error.
    const raw = '---\nname: foo\n\tbad: tab\n---\nbody';
    const out = frontmatterYamlParser.parse(raw, 'test.md');
    deepStrictEqual(out.frontmatter, {});
    strictEqual(out.body, 'body');
  });

  it('emits a parse-error issue when YAML is malformed (audit L1)', () => {
    // Tab indentation inside a mapping is a YAML error; the parser
    // keeps `parsed = {}` (historic fallback) AND surfaces a single
    // issue with the sanitised parser message so the orchestrator can
    // warn the author.
    const raw = '---\nname: foo\n\tbad: tab\n---\nbody';
    const out = frontmatterYamlParser.parse(raw, 'a/b/test.md');
    deepStrictEqual(out.frontmatter, {});
    ok(out.issues && out.issues.length === 1, 'one issue emitted');
    const issue = out.issues![0]!;
    strictEqual(issue.code, 'frontmatter-parse-error');
    ok(issue.message.length > 0, 'issue message non-empty');
    // Sanitised: single line, no control chars, no NUL.
    ok(!/[\r\n\t\x00]/.test(issue.message), 'message has no control chars');
    // Sanitised: no ANSI ESC.
    ok(!/\x1b/.test(issue.message), 'message has no ANSI ESC');
  });

  it('appends the quoting hint when an unquoted value carries a second colon', () => {
    // The single most common authored mistake: a `: ` inside a plain
    // scalar reads as a new mapping key and breaks the whole block.
    const raw = '---\nname: foo\ndescription: use this when: something happens\n---\nbody';
    const out = frontmatterYamlParser.parse(raw, 'test.md');
    ok(out.issues && out.issues.length === 1, 'one issue emitted');
    const issue = out.issues![0]!;
    strictEqual(issue.code, 'frontmatter-parse-error');
    ok(/wrap the value in quotes/.test(issue.message), `hint expected; got: ${issue.message}`);
  });

  it('appends the quoting hint for a trailing colon at end of line', () => {
    const raw = '---\ndescription: ends with a colon:\n---\nbody';
    const out = frontmatterYamlParser.parse(raw, 'test.md');
    ok(out.issues && out.issues.length === 1, 'one issue emitted');
    ok(/wrap the value in quotes/.test(out.issues![0]!.message));
  });

  it('does NOT append the hint for unrelated YAML errors (tab indentation)', () => {
    const raw = '---\nname: foo\n\tbad: tab\n---\nbody';
    const out = frontmatterYamlParser.parse(raw, 'test.md');
    ok(out.issues && out.issues.length === 1, 'one issue emitted');
    ok(
      !/wrap the value in quotes/.test(out.issues![0]!.message),
      `no hint expected; got: ${out.issues![0]!.message}`,
    );
  });

  it('declared empty block → `{}` with NO parse-error issue (js-yaml 5 empty-document throw filtered)', () => {
    const raw = '---\n\n---\nbody';
    const out = frontmatterYamlParser.parse(raw, 'test.md');
    deepStrictEqual(out.frontmatter, {});
    strictEqual(out.frontmatterDeclared, true);
    ok(out.issues === undefined || out.issues.length === 0, 'no issue for an empty block');
  });

  it('comments-only block behaves like the empty one', () => {
    const raw = '---\n# just a note\n---\nbody';
    const out = frontmatterYamlParser.parse(raw, 'test.md');
    deepStrictEqual(out.frontmatter, {});
    ok(out.issues === undefined || out.issues.length === 0);
  });

  it('omits issues on the happy path', () => {
    const raw = '---\nname: foo\n---\nbody';
    const out = frontmatterYamlParser.parse(raw, 'test.md');
    ok(out.issues === undefined || out.issues.length === 0);
  });

  it('strips prototype-pollution keys (`__proto__`, `constructor`, `prototype`)', () => {
    const raw = [
      '---',
      'name: ok',
      '__proto__:',
      '  evil: true',
      'constructor:',
      '  bad: true',
      'prototype:',
      '  also: bad',
      '---',
      'body',
    ].join('\n');
    const out = frontmatterYamlParser.parse(raw, 'test.md');
    deepStrictEqual(Object.keys(out.frontmatter).sort(), ['name']);
    strictEqual(out.frontmatter['name'], 'ok');
    // Sanity: no global prototype mutation leaked.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    strictEqual((Object.prototype as any).evil, undefined);
  });

  it('strips prototype-pollution keys at every nesting depth (audit M2)', () => {
    // Nested `__proto__`, `constructor`, `prototype` keys are dropped
    // by `stripPrototypePollution`. Before M2, the shallow filter
    // only caught the root-level keys; this case survived and exposed
    // a downstream deep-merge to the `__proto__` setter.
    const raw = [
      '---',
      'name: ok',
      'meta:',
      '  __proto__:',
      '    polluted: true',
      '  fine: keep-me',
      'nested:',
      '  deeper:',
      '    constructor:',
      '      evil: true',
      '    safe: yes',
      'arr:',
      '  - __proto__:',
      '      bad: 1',
      '    inside: still-here',
      '---',
      'body',
    ].join('\n');
    const out = frontmatterYamlParser.parse(raw, 'test.md');
    // Root keys keep their original names but their VALUES are deep-cleaned.
    deepStrictEqual(Object.keys(out.frontmatter).sort(), ['arr', 'meta', 'name', 'nested']);
    const meta = out.frontmatter['meta'] as Record<string, unknown>;
    deepStrictEqual(Object.keys(meta).sort(), ['fine']);
    // The own-property `__proto__` at depth 1 is gone, the surviving
    // sibling stays.
    strictEqual(Object.hasOwn(meta, '__proto__'), false);
    strictEqual(meta['fine'], 'keep-me');

    const nested = out.frontmatter['nested'] as Record<string, unknown>;
    const deeper = nested['deeper'] as Record<string, unknown>;
    deepStrictEqual(Object.keys(deeper).sort(), ['safe']);
    strictEqual(Object.hasOwn(deeper, 'constructor'), false);

    const arr = out.frontmatter['arr'] as Record<string, unknown>[];
    strictEqual(arr.length, 1);
    deepStrictEqual(Object.keys(arr[0]!).sort(), ['inside']);
    strictEqual(Object.hasOwn(arr[0]!, '__proto__'), false);
    strictEqual(arr[0]!['inside'], 'still-here');

    // Sanity: no global prototype mutation leaked anywhere.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    strictEqual((Object.prototype as any).polluted, undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    strictEqual((Object.prototype as any).bad, undefined);
  });

  it('handles CRLF line endings in the fence', () => {
    const raw = '---\r\nname: foo\r\n---\r\nbody';
    const out = frontmatterYamlParser.parse(raw, 'test.md');
    deepStrictEqual(out.frontmatter, { name: 'foo' });
    strictEqual(out.body, 'body');
  });

  it('returns frontmatterRaw when frontmatter parses to a non-object (e.g. a list)', () => {
    // A YAML sequence at the top level, not an object. Parser should
    // not populate frontmatter (we only accept mapping shapes), but
    // frontmatterRaw still reflects what was between the fences.
    const raw = '---\n- one\n- two\n---\nbody';
    const out = frontmatterYamlParser.parse(raw, 'test.md');
    deepStrictEqual(out.frontmatter, {});
    strictEqual(out.frontmatterRaw, '- one\n- two');
    strictEqual(out.body, 'body');
  });

  it('uses path argument only for diagnostics, does not affect output', () => {
    const raw = '---\nname: x\n---\nbody';
    const a = frontmatterYamlParser.parse(raw, 'one/path.md');
    const b = frontmatterYamlParser.parse(raw, 'totally/different.md');
    deepStrictEqual(a, b);
  });

  describe('bodyLineOffset', () => {
    it('counts the frontmatter block lines, fences included', () => {
      // L1 ---, L2 name, L3 tags, L4 ---, body starts at file L5.
      const raw = '---\nname: foo\ntags: [a]\n---\nbody line';
      const out = frontmatterYamlParser.parse(raw, 'test.md');
      strictEqual(out.bodyLineOffset, 4);
    });

    it('handles a declared-but-empty block', () => {
      // L1 ---, L2 (blank), L3 ---, body starts at file L4.
      const raw = '---\n\n---\nbody';
      const out = frontmatterYamlParser.parse(raw, 'test.md');
      strictEqual(out.bodyLineOffset, 3);
    });

    it('counts CRLF newlines the same as LF', () => {
      const raw = '---\r\nname: foo\r\n---\r\nbody';
      const out = frontmatterYamlParser.parse(raw, 'test.md');
      strictEqual(out.bodyLineOffset, 3);
    });

    it('is absent when no fence matches (body is the whole file)', () => {
      const out = frontmatterYamlParser.parse('just prose\nno fence', 'test.md');
      strictEqual(out.bodyLineOffset, undefined);
    });
  });
});
