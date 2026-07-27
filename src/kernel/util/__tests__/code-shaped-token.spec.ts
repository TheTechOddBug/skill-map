/**
 * Shape table for `isCodeShapedAtToken`, the prose-side sibling of the
 * code-region resolution gate: uppercase identifier shapes and
 * single-slash npm scopes read as code payload; lowercase handles,
 * paths, and extension-bearing tails do not.
 */

import { describe, it } from 'node:test';
import { strictEqual } from 'node:assert';

import { isCodeShapedAtToken } from '../code-shaped-token.js';

describe('isCodeShapedAtToken', () => {
  const CASES: [token: string, expected: boolean, why: string][] = [
    ['@ApiSecurity', true, 'PascalCase decorator shape'],
    ['@Injectable', true, 'PascalCase decorator shape'],
    ['@apiSecurity', true, 'camelCase identifier shape'],
    ['@API', true, 'all-caps identifier shape'],
    ['@nestjs/swagger', true, 'npm scope, single slash, lowercase'],
    ['@changesets/cli', true, 'npm scope, single slash, lowercase'],
    ['@my-agent', false, 'lowercase handle, the legit mention shape'],
    ['@team_lead', false, 'lowercase handle with underscore'],
    ['@a', false, 'single lowercase char'],
    ['@scope/pkg/deep', false, 'multi-slash reads as a path'],
    ['@scope/file.md', false, 'extension tail is at-file turf'],
    ['@Scope/Name', false, 'scoped but not lowercase npm shape'],
    ['@./docs/x', false, 'relative path prefix'],
    ['@/abs/path', false, 'absolute path prefix'],
    ['@', false, 'bare sigil'],
    ['foo/bar.md', false, 'no @ sigil at all'],
  ];

  for (const [token, expected, why] of CASES) {
    it(`${token} -> ${expected} (${why})`, () => {
      strictEqual(isCodeShapedAtToken(token), expected);
    });
  }
});
