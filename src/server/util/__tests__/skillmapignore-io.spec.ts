/**
 * `server/util/skillmapignore-io.ts` unit tests.
 *
 * The route (`routes/project-ignore.ts`) is exercised end-to-end in
 * `routes/__tests__/project-ignore-route.spec.ts`. These tests cover
 * the read/write helper in isolation:
 *
 *   - `readPatterns` filters comments and blank lines, trims entries.
 *   - `readPatterns` tolerates a missing file (returns []).
 *   - `readPatterns` tolerates CRLF line endings.
 *   - `writePatterns` preserves comments + blanks in original
 *     positions when a pattern stays.
 *   - `writePatterns` drops the line for a pattern that disappears.
 *   - `writePatterns` appends new patterns at the end.
 *   - `buildContent` (exported) covers edge cases without disk I/O.
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  buildContent,
  readPatterns,
  writePatterns,
} from '../skillmapignore-io.js';

let tmp: string;

before(() => {
  tmp = mkdtempSync(join(tmpdir(), 'skill-map-ignore-io-'));
});

after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function fresh(): string {
  return mkdtempSync(join(tmp, 'cwd-'));
}

describe('readPatterns', () => {
  it('returns [] when .skillmapignore is missing', () => {
    assert.deepEqual(readPatterns(fresh()), []);
  });

  it('drops comments and blank lines, trims entries', () => {
    const cwd = fresh();
    writeFileSync(
      join(cwd, '.skillmapignore'),
      '# header\n\nnode_modules/\n  dist/  \n# trailing\n',
      'utf8',
    );
    assert.deepEqual(readPatterns(cwd), ['node_modules/', 'dist/']);
  });

  it('tolerates CRLF line endings', () => {
    const cwd = fresh();
    writeFileSync(
      join(cwd, '.skillmapignore'),
      '# header\r\nnode_modules/\r\n\r\ndist/\r\n',
      'utf8',
    );
    assert.deepEqual(readPatterns(cwd), ['node_modules/', 'dist/']);
  });
});

describe('writePatterns', () => {
  it('writes a fresh file with one pattern per line + trailing newline', () => {
    const cwd = fresh();
    writePatterns(cwd, ['a', 'b']);
    const content = readFileSync(join(cwd, '.skillmapignore'), 'utf8');
    assert.equal(content, 'a\nb\n');
  });

  it('preserves comments + blank lines for patterns that survive', () => {
    const cwd = fresh();
    const original =
      '# top comment\n' +
      '\n' +
      'node_modules/\n' +
      '# middle comment\n' +
      'dist/\n' +
      '\n' +
      '# bottom comment\n';
    writeFileSync(join(cwd, '.skillmapignore'), original, 'utf8');
    writePatterns(cwd, ['node_modules/', 'dist/']);
    const content = readFileSync(join(cwd, '.skillmapignore'), 'utf8');
    assert.equal(content, original);
  });

  it('drops the line for a removed pattern while keeping comments', () => {
    const cwd = fresh();
    writeFileSync(
      join(cwd, '.skillmapignore'),
      '# header\nnode_modules/\ndist/\n# trailing\n',
      'utf8',
    );
    writePatterns(cwd, ['node_modules/']);
    const content = readFileSync(join(cwd, '.skillmapignore'), 'utf8');
    assert.equal(content, '# header\nnode_modules/\n# trailing\n');
  });

  it('appends new patterns at the end after the prior comments', () => {
    const cwd = fresh();
    writeFileSync(
      join(cwd, '.skillmapignore'),
      '# header\nnode_modules/\n',
      'utf8',
    );
    writePatterns(cwd, ['node_modules/', 'dist/']);
    const content = readFileSync(join(cwd, '.skillmapignore'), 'utf8');
    assert.equal(content, '# header\nnode_modules/\ndist/\n');
  });

  it('writes an empty string when all patterns are removed and no comments survive', () => {
    const cwd = fresh();
    writeFileSync(join(cwd, '.skillmapignore'), 'a\nb\n', 'utf8');
    writePatterns(cwd, []);
    const content = readFileSync(join(cwd, '.skillmapignore'), 'utf8');
    assert.equal(content, '');
  });
});

describe('buildContent (pure)', () => {
  it('returns "" for empty input and empty new list', () => {
    assert.equal(buildContent('', []), '');
  });

  it('emits new patterns when prior is empty', () => {
    assert.equal(buildContent('', ['a', 'b']), 'a\nb\n');
  });

  it('preserves the order of prior pattern lines', () => {
    const prior = '# c\nb\na\n';
    // user kept both patterns; positions in the file must be preserved.
    assert.equal(buildContent(prior, ['a', 'b']), '# c\nb\na\n');
  });

  it('appends a new pattern after the prior content', () => {
    const prior = '# c\na\n';
    assert.equal(buildContent(prior, ['a', 'b']), '# c\na\nb\n');
  });

  it('treats CRLF input but emits LF output', () => {
    const prior = '# c\r\na\r\n';
    assert.equal(buildContent(prior, ['a']), '# c\na\n');
  });
});
