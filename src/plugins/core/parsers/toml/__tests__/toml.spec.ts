import { describe, it } from 'node:test';
import { deepStrictEqual, ok, strictEqual } from 'node:assert';

import { tomlParser } from '../index.js';

describe('parsers/toml', () => {
  it('parses a TOML manifest into frontmatter, body stays empty', () => {
    const raw = 'name = "deploy"\ndescription = "ship it"\n';
    const out = tomlParser.parse(raw, 'cmd.toml');
    deepStrictEqual(out.frontmatter, { name: 'deploy', description: 'ship it' });
    strictEqual(out.frontmatterRaw, raw);
    strictEqual(out.body, '');
  });

  it('parses nested tables', () => {
    const out = tomlParser.parse('[meta]\nowner = "x"\n', 'cmd.toml');
    deepStrictEqual(out.frontmatter, { meta: { owner: 'x' } });
  });

  it('returns empty frontmatter and a parse-error issue on malformed TOML', () => {
    const out = tomlParser.parse('name = "unterminated', 'a/b/cmd.toml');
    deepStrictEqual(out.frontmatter, {});
    ok(out.issues && out.issues.length === 1, 'one issue emitted');
    const issue = out.issues![0]!;
    strictEqual(issue.code, 'frontmatter-parse-error');
    ok(issue.message.length > 0, 'issue message non-empty');
    // Sanitised: newlines and tabs are collapsed to single spaces, none survive.
    ok(!issue.message.includes('\n'), 'message has no newlines');
    ok(!issue.message.includes('\t'), 'message has no tabs');
  });

  it('omits issues on the happy path', () => {
    const out = tomlParser.parse('name = "ok"\n', 'cmd.toml');
    ok(out.issues === undefined || out.issues.length === 0);
  });

  it('does not leak prototype pollution from a __proto__ key', () => {
    const out = tomlParser.parse('name = "ok"\n"__proto__" = { polluted = true }\n', 'cmd.toml');
    strictEqual(out.frontmatter['name'], 'ok');
    strictEqual(Object.hasOwn(out.frontmatter, '__proto__'), false);
    // Sanity: no global prototype mutation leaked.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    strictEqual((Object.prototype as any).polluted, undefined);
  });
});
