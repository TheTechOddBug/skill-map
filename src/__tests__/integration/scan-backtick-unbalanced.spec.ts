/**
 * `backtick-unbalanced` issue. The kernel stamps this during the walk
 * (in `node-build`, where the body is live) when a node body has an
 * unclosed backtick: a fenced block with no closer, or an inline span
 * with no equal-length closer. The verdict is derived from the same
 * `findBacktickImbalance` scanner `stripCodeBlocks` is built on, so it
 * cannot drift from the code-strip policy it protects.
 *
 * Asserted properties:
 *
 *   1. Unclosed fence in the body → emits `backtick-unbalanced` warn,
 *      `data.kind === 'fence'`, `detail` = the opening fence line.
 *   2. Unclosed inline span → `data.kind === 'inline'`, `detail` = the
 *      offending source line.
 *   3. Balanced body → no issue.
 *   4. Regression: a 3-backtick fence nested inside a 4-backtick wrapper
 *      is valid and yields no issue (the old analyzer's length-blind
 *      close mis-fired here).
 *   5. A backslash-escaped backtick in prose is not flagged.
 *   6. `--strict` promotes the severity to `error`.
 *   7. Incremental scans reuse the prior issue for cached nodes (so the
 *      warning does not disappear on a clean re-scan, without re-reading
 *      the file).
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { createKernel, runScan } from '../../kernel/index.js';
import type { ScanResult } from '../../kernel/index.js';
import { builtIns } from '../../plugins/built-ins.js';

let root: string;
let counter = 0;

function freshFixture(label: string): string {
  counter += 1;
  const dir = join(root, `${label}-${counter}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeNode(fixture: string, rel: string, body: string): void {
  const full = join(fixture, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body);
}

/** A valid frontmatter block + the given body lines, as one `.md` file. */
function withFrontmatter(...bodyLines: string[]): string {
  return ['---', 'name: n', 'description: d', '---', ...bodyLines, ''].join('\n');
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-map-backtick-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

async function scan(fixture: string, strict = false): Promise<ScanResult> {
  const kernel = createKernel();
  return runScan(kernel, { roots: [fixture], extensions: builtIns(), strict });
}

describe('backtick-unbalanced', () => {
  it('flags an unclosed fenced block in the body', async () => {
    const fixture = freshFixture('fence');
    writeNode(fixture, '.claude/agents/fence.md', withFrontmatter('intro text', '```js', 'const a = 1;'));
    const result = await scan(fixture);
    const issue = result.issues.find((i) => i.analyzerId === 'backtick-unbalanced');
    assert.ok(issue, `expected backtick-unbalanced; got: ${JSON.stringify(result.issues)}`);
    assert.equal(issue.severity, 'warn');
    assert.deepEqual(issue.nodeIds, ['.claude/agents/fence.md']);
    assert.equal(issue.data?.['kind'], 'fence');
    assert.equal(issue.detail, '```js');
  });

  it('flags an unclosed inline span and carries the offending line', async () => {
    const fixture = freshFixture('inline');
    writeNode(fixture, '.claude/agents/inline.md', withFrontmatter('a paragraph', 'with an `unclosed span here'));
    const result = await scan(fixture);
    const issue = result.issues.find((i) => i.analyzerId === 'backtick-unbalanced');
    assert.ok(issue, `expected backtick-unbalanced; got: ${JSON.stringify(result.issues)}`);
    assert.equal(issue.data?.['kind'], 'inline');
    assert.equal(issue.detail, 'with an `unclosed span here');
  });

  it('does not flag a balanced body (closed fence + closed inline span)', async () => {
    const fixture = freshFixture('balanced');
    writeNode(
      fixture,
      '.claude/agents/ok.md',
      withFrontmatter('a `span` and', '```js', 'const a = 1;', '```', 'done'),
    );
    const result = await scan(fixture);
    assert.equal(result.issues.find((i) => i.analyzerId === 'backtick-unbalanced'), undefined);
  });

  it('does NOT flag a fence nested inside a longer wrapper fence (regression)', async () => {
    const fixture = freshFixture('nested');
    // A 3-backtick block shown inside a 4-backtick wrapper, fully closed.
    writeNode(
      fixture,
      '.claude/agents/nested.md',
      withFrontmatter('````md', 'To start a code block, type:', '```', '````'),
    );
    const result = await scan(fixture);
    assert.equal(
      result.issues.find((i) => i.analyzerId === 'backtick-unbalanced'),
      undefined,
      'a balanced nested fence must not warn',
    );
  });

  it('does not flag a backslash-escaped backtick in prose', async () => {
    const fixture = freshFixture('escaped');
    writeNode(fixture, '.claude/agents/escaped.md', withFrontmatter('A literal \\` backtick stays plain.'));
    const result = await scan(fixture);
    assert.equal(result.issues.find((i) => i.analyzerId === 'backtick-unbalanced'), undefined);
  });

  it('--strict promotes the issue to error', async () => {
    const fixture = freshFixture('strict');
    writeNode(fixture, '.claude/agents/fence.md', withFrontmatter('intro', '```js', 'code'));
    const result = await scan(fixture, true);
    const issue = result.issues.find((i) => i.analyzerId === 'backtick-unbalanced');
    assert.ok(issue);
    assert.equal(issue.severity, 'error');
  });

  it('incremental scan reuses the issue for cached nodes', async () => {
    const fixture = freshFixture('cache');
    writeNode(fixture, '.claude/agents/fence.md', withFrontmatter('intro', '```js', 'code'));
    const first = await scan(fixture);
    assert.ok(first.issues.some((i) => i.analyzerId === 'backtick-unbalanced'), 'first pass must emit');

    const kernel = createKernel();
    const second = await runScan(kernel, {
      roots: [fixture],
      extensions: builtIns(),
      priorSnapshot: first,
      enableCache: true,
    });
    const cached = second.issues.find((i) => i.analyzerId === 'backtick-unbalanced');
    assert.ok(cached, `cached pass must reuse the issue; got: ${JSON.stringify(second.issues)}`);
    assert.equal(cached.severity, 'warn');
    assert.equal(cached.data?.['kind'], 'fence');
  });

  it('flags only the offending file in a mixed batch', async () => {
    const fixture = freshFixture('mixed');
    writeNode(fixture, '.claude/agents/clean.md', withFrontmatter('all `good` here', '```', 'x', '```'));
    writeNode(fixture, '.claude/agents/dirty.md', withFrontmatter('oops `open'));
    const result = await scan(fixture);
    const flagged = result.issues.filter((i) => i.analyzerId === 'backtick-unbalanced');
    assert.equal(flagged.length, 1);
    assert.deepEqual(flagged[0]?.nodeIds, ['.claude/agents/dirty.md']);
  });
});
