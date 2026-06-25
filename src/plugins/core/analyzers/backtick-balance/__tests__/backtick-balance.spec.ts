/**
 * Coverage for the `core/backtick-balance` built-in analyzer
 * (`plugins/core/analyzers/backtick-balance/index.ts`).
 *
 * The analyzer re-reads each node's file from disk, so these tests
 * write real fixtures into an OS tempdir (`os.tmpdir()`, NOT the repo
 * `.tmp/`) and point `ctx.cwd` at it, mirroring the on-disk pattern in
 * `reference-broken-trigger-resolution.spec.ts`.
 *
 * Behaviour pinned (from the validated POC, zero false positives):
 *   - Balanced inline span + balanced fence -> no issue.
 *   - An open inline backtick -> one `warn` at the exact file line.
 *   - An unclosed fenced block -> one `warn` for the fence (and the
 *     inline pass is cut: only the fence issue fires).
 *   - A double-backtick span wrapping a literal backtick -> no issue.
 *   - A backslash-escaped backtick in prose -> no issue (the escape fix).
 *   - Virtual nodes and unreadable files are skipped.
 */

import { after, before, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { backtickBalanceAnalyzer } from '../index.js';
import type { IAnalyzerContext } from '../../../../../kernel/extensions/index.js';
import type { Node } from '../../../../../kernel/types.js';

let tmpRoot: string;
let counter = 0;

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-backtick-balance-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

/** Write a fixture file under the tempdir; return its tmpRoot-relative path. */
function writeFixture(lines: string[]): string {
  counter += 1;
  const rel = `node-${counter}.md`;
  writeFileSync(join(tmpRoot, rel), lines.join('\n'));
  return rel;
}

function mockNode(over: Partial<Node>): Node {
  return {
    path: 'node.md',
    kind: 'markdown',
    provider: 'markdown',
    bodyHash: '0'.repeat(64),
    frontmatterHash: '0'.repeat(64),
    bytes: { frontmatter: 0, body: 0, total: 0 },
    frontmatter: {},
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
    ...over,
  };
}

function ctxWith(nodes: Node[]): IAnalyzerContext {
  return {
    nodes,
    links: [],
    settings: {},
    cwd: tmpRoot,
    emitContribution: () => {
      /* unused */
    },
  };
}

/** Frontmatter block of height 4 (`---`, two keys, `---`); body starts at file line 5. */
const FRONTMATTER = ['---', 'name: x', 'description: y', '---', ''];

describe('core/backtick-balance analyzer', () => {
  it('emits no issue for balanced inline spans and a balanced fence', async () => {
    const path = writeFixture([
      ...FRONTMATTER,
      'A balanced `inline` span and a fence below:',
      '',
      '```js',
      'const a = 1;',
      '```',
      '',
      'Done.',
    ]);
    const issues = await backtickBalanceAnalyzer.evaluate(ctxWith([mockNode({ path })]));
    assert.deepEqual(issues, []);
  });

  it('emits one warn for an open inline backtick at the exact file line', async () => {
    const path = writeFixture([
      ...FRONTMATTER,
      'Here is an `unclosed span.',
    ]);
    const issues = await backtickBalanceAnalyzer.evaluate(ctxWith([mockNode({ path })]));
    assert.equal(issues.length, 1);
    const issue = issues[0]!;
    assert.equal(issue.severity, 'warn');
    assert.equal(issue.analyzerId, 'backtick-balance');
    assert.equal(issue.data?.['kind'], 'inline');
    // Frontmatter height 4 + body line 2 (blank line 1, prose line 2) = file line 6.
    assert.equal(issue.data?.['line'], 6);
    assert.match(issue.message, /L6: /);
    assert.equal(issue.detail, 'Here is an `unclosed span.');
    assert.ok(issue.fix?.summary);
  });

  it('emits one warn for an unclosed fenced block and cuts the inline pass', async () => {
    const path = writeFixture([
      ...FRONTMATTER,
      'Some intro text.',
      '```js',
      'const a = `still inside the fence',
      'more code',
    ]);
    const issues = await backtickBalanceAnalyzer.evaluate(ctxWith([mockNode({ path })]));
    assert.equal(issues.length, 1);
    const issue = issues[0]!;
    assert.equal(issue.severity, 'warn');
    assert.equal(issue.data?.['kind'], 'fence');
    // Frontmatter height 4 + opening fence at body line 3 = file line 7.
    assert.equal(issue.data?.['line'], 7);
  });

  it('emits no issue for a double-backtick span wrapping a literal backtick', async () => {
    const path = writeFixture([
      ...FRONTMATTER,
      'Use ``code ` here`` to wrap a literal backtick.',
    ]);
    const issues = await backtickBalanceAnalyzer.evaluate(ctxWith([mockNode({ path })]));
    assert.deepEqual(issues, []);
  });

  it('emits no issue for a backslash-escaped backtick in prose', async () => {
    // ``` is a literal backtick; `\\` is a single backslash. The
    // body line therefore contains exactly one escaped backtick.
    const path = writeFixture([
      ...FRONTMATTER,
      'A literal \\` backtick stays plain text.',
    ]);
    const issues = await backtickBalanceAnalyzer.evaluate(ctxWith([mockNode({ path })]));
    assert.deepEqual(issues, []);
  });

  it('skips virtual nodes (no backing file)', async () => {
    const node = mockNode({ path: 'mcp://github', virtual: true });
    const issues = await backtickBalanceAnalyzer.evaluate(ctxWith([node]));
    assert.deepEqual(issues, []);
  });

  it('skips nodes whose file cannot be read', async () => {
    const node = mockNode({ path: 'does-not-exist.md' });
    const issues = await backtickBalanceAnalyzer.evaluate(ctxWith([node]));
    assert.deepEqual(issues, []);
  });
});
