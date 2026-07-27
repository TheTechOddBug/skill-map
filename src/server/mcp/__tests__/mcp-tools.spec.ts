/**
 * Unit tests for the read-only MCP tool executors + resource reads
 * (`spec/mcp-server.md` §Tools / §Resources).
 *
 * The executors are exercised directly (no MCP transport) against a real
 * temp-file DB primed with a small graph. Per the SqliteStorageAdapter
 * convention, the DB is a `mkdtempSync` file path, never `:memory:` (the
 * adapter opens two DatabaseSync instances, so `:memory:` yields an empty
 * schema on the Kysely side).
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

// eslint-disable-next-line import-x/extensions
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

import { SqliteStorageAdapter } from '../../../kernel/adapters/sqlite/index.js';
import { persistScanResult } from '../../../kernel/adapters/sqlite/scan-persistence.js';
import type { Issue, Link, Node, ScanResult } from '../../../kernel/types.js';
import type { IMcpReadContext } from '../context.js';
import {
  readActivityResource,
  readGraphResource,
  readIssuesResource,
} from '../resources.js';
import { getBranch, getNode, listIssues, queryGraph } from '../tools.js';
import { ActivityStatsService } from '../../activity-stats.js';

const HASH = 'a'.repeat(64);

interface ITestRoot {
  tmp: string;
  cwd: string;
  dbPath: string;
}

let root: ITestRoot;

before(() => {
  const tmp = mkdtempSync(join(tmpdir(), 'skill-map-mcp-tools-'));
  root = { tmp, cwd: tmp, dbPath: join(tmp, 'primed.db') };
});

after(() => {
  rmSync(root.tmp, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(root.dbPath, { force: true });
});

function ctx(): IMcpReadContext {
  return { dbPath: root.dbPath, cwd: root.cwd };
}

function makeNode(path: string, kind = 'note'): Node {
  return {
    path,
    kind,
    provider: 'claude',
    bodyHash: HASH,
    frontmatterHash: HASH,
    bytes: { frontmatter: 0, body: 0, total: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
  };
}

function makeLink(source: string, target: string): Link {
  return { source, target, kind: 'references', confidence: 1.0, sources: ['markdown-link'] };
}

function makeIssue(severity: 'error' | 'warn' | 'info', nodeIds: string[], analyzerId = 'core/reference-broken'): Issue {
  return { analyzerId, severity, nodeIds, message: 'planted' };
}

interface IPrimeOpts {
  nodes: Node[];
  links?: Link[];
  issues?: Issue[];
  maxRenderNodes?: number;
}

async function prime(opts: IPrimeOpts): Promise<void> {
  const result: ScanResult = {
    schemaVersion: 1,
    scannedAt: Date.now(),
    roots: [root.cwd],
    providers: ['claude'],
    nodes: opts.nodes,
    links: opts.links ?? [],
    issues: opts.issues ?? [],
    ...(opts.maxRenderNodes !== undefined ? { maxRenderNodes: opts.maxRenderNodes } : {}),
    stats: {
      filesWalked: opts.nodes.length,
      filesSkipped: 0,
      nodesCount: opts.nodes.length,
      linksCount: (opts.links ?? []).length,
      issuesCount: (opts.issues ?? []).length,
      durationMs: 0,
    },
  };
  const adapter = new SqliteStorageAdapter({ databasePath: root.dbPath, autoBackup: false });
  await adapter.init();
  try {
    await persistScanResult(adapter.db, result);
  } finally {
    await adapter.close();
  }
}

describe('mcp query_graph', () => {
  it('returns the full closed subgraph with no filters', async () => {
    await prime({
      nodes: [makeNode('a.md', 'skill'), makeNode('b.md', 'agent')],
      links: [makeLink('a.md', 'b.md')],
      issues: [makeIssue('error', ['a.md'])],
    });
    const res = await queryGraph(ctx(), {});
    assert.equal(res.nodes.length, 2);
    assert.equal(res.links.length, 1);
    assert.equal(res.issues.length, 1);
  });

  it('filters by kind and re-closes links against the kept set', async () => {
    await prime({
      nodes: [makeNode('a.md', 'skill'), makeNode('b.md', 'agent')],
      links: [makeLink('a.md', 'b.md')],
      issues: [makeIssue('error', ['a.md'])],
    });
    const res = await queryGraph(ctx(), { kind: 'skill' });
    assert.deepEqual(res.nodes.map((n) => n.path), ['a.md']);
    // b.md dropped, so the a→b link cannot survive (both endpoints must remain).
    assert.equal(res.links.length, 0);
    // The issue touches a.md, which survived.
    assert.equal(res.issues.length, 1);
  });

  it('honours the limit (and re-closes links/issues against the slice)', async () => {
    await prime({
      nodes: [makeNode('a.md'), makeNode('b.md'), makeNode('c.md')],
      links: [makeLink('a.md', 'b.md')],
    });
    const res = await queryGraph(ctx(), { limit: 1 });
    assert.equal(res.nodes.length, 1);
    assert.equal(res.links.length, 0);
  });

  it('filters by has=issues', async () => {
    await prime({
      nodes: [makeNode('a.md'), makeNode('b.md')],
      issues: [makeIssue('warn', ['a.md'])],
    });
    const res = await queryGraph(ctx(), { has: 'issues' });
    assert.deepEqual(res.nodes.map((n) => n.path), ['a.md']);
  });

  it('rejects a malformed query with an invalid-params McpError', async () => {
    await prime({ nodes: [makeNode('a.md')] });
    await assert.rejects(
      () => queryGraph(ctx(), { has: 'bogus' }),
      (err: unknown) => err instanceof McpError && err.code === ErrorCode.InvalidParams,
    );
  });

  it('degrades to an empty subgraph when the DB is absent', async () => {
    const res = await queryGraph({ dbPath: join(root.tmp, 'nope.db'), cwd: root.cwd }, {});
    assert.deepEqual(res, { nodes: [], links: [], issues: [] });
  });
});

describe('mcp get_node', () => {
  it('returns the single-node bundle with incoming/outgoing links', async () => {
    await prime({
      nodes: [makeNode('a.md', 'skill'), makeNode('b.md', 'agent')],
      links: [makeLink('a.md', 'b.md')],
      issues: [makeIssue('error', ['b.md'])],
    });
    const res = await getNode(ctx(), { path: 'b.md' });
    assert.equal(res.item.path, 'b.md');
    assert.equal(res.links.incoming.length, 1);
    assert.equal(res.links.incoming[0]?.source, 'a.md');
    assert.equal(res.links.outgoing.length, 0);
    assert.equal(res.issues.length, 1);
    assert.equal('body' in res.item, false);
  });

  it('reads the file body on demand with includeBody', async () => {
    writeFileSync(join(root.cwd, 'a.md'), '---\ntitle: A\n---\nhello body\n');
    await prime({ nodes: [makeNode('a.md', 'skill')] });
    const res = await getNode(ctx(), { path: 'a.md', includeBody: true });
    assert.equal(res.item.body, 'hello body\n');
  });

  it('returns null body when includeBody is set but the file is missing', async () => {
    await prime({ nodes: [makeNode('gone.md', 'skill')] });
    const res = await getNode(ctx(), { path: 'gone.md', includeBody: true });
    assert.equal(res.item.body, null);
  });

  it('throws invalid-params for an unknown path', async () => {
    await prime({ nodes: [makeNode('a.md')] });
    await assert.rejects(
      () => getNode(ctx(), { path: 'does/not/exist.md' }),
      (err: unknown) => err instanceof McpError && err.code === ErrorCode.InvalidParams,
    );
  });
});

describe('mcp list_issues', () => {
  it('returns { items, total } and filters by severity', async () => {
    await prime({
      nodes: [makeNode('a.md'), makeNode('b.md')],
      issues: [makeIssue('error', ['a.md']), makeIssue('warn', ['b.md'])],
    });
    const all = await listIssues(ctx(), {});
    assert.equal(all.total, 2);
    assert.equal(all.items.length, 2);

    const errorsOnly = await listIssues(ctx(), { severity: 'error' });
    assert.equal(errorsOnly.total, 1);
    assert.equal(errorsOnly.items[0]?.severity, 'error');
  });

  it('filters by node path', async () => {
    await prime({
      nodes: [makeNode('a.md'), makeNode('b.md')],
      issues: [makeIssue('error', ['a.md']), makeIssue('warn', ['b.md'])],
    });
    const res = await listIssues(ctx(), { node: 'b.md' });
    assert.equal(res.total, 1);
    assert.equal(res.items[0]?.severity, 'warn');
  });

  it('degrades to empty when the DB is absent', async () => {
    const res = await listIssues({ dbPath: join(root.tmp, 'nope.db'), cwd: root.cwd }, {});
    assert.deepEqual(res, { items: [], total: 0 });
  });
});

describe('mcp get_branch', () => {
  it('projects the union of folder prefixes', async () => {
    await prime({
      nodes: [makeNode('a.md'), makeNode('sub/b.md'), makeNode('sub/c.md')],
    });
    const res = await getBranch(ctx(), { path: ['sub'] });
    assert.deepEqual(res.nodes.map((n) => n.path).sort(), ['sub/b.md', 'sub/c.md']);
    assert.equal(res.branch.total, 2);
    assert.equal(res.branch.rendered, 2);
    assert.equal(res.branch.truncated, false);
  });

  it('returns the whole corpus for an empty prefix list', async () => {
    await prime({ nodes: [makeNode('a.md'), makeNode('sub/b.md')] });
    const res = await getBranch(ctx(), { path: [] });
    assert.equal(res.branch.total, 2);
  });

  it('clamps limit below the render cap and flags truncation', async () => {
    await prime({ nodes: [makeNode('a.md'), makeNode('b.md'), makeNode('c.md')] });
    const res = await getBranch(ctx(), { path: [], limit: 2 });
    assert.equal(res.nodes.length, 2);
    assert.equal(res.branch.cap, 2);
    assert.equal(res.branch.truncated, true);
  });

  it('degrades to an empty branch when the DB is absent', async () => {
    const res = await getBranch({ dbPath: join(root.tmp, 'nope.db'), cwd: root.cwd }, { path: ['x'] });
    assert.equal(res.branch.total, 0);
    assert.deepEqual(res.nodes, []);
  });

  it('applies exclude overrides (map scope overrides, same rule as the route)', async () => {
    await prime({
      nodes: [makeNode('app/one.md'), makeNode('app/legacy/old.md'), makeNode('docs/g.md')],
    });
    const res = await getBranch(ctx(), { path: [], exclude: ['app/legacy'] });
    assert.deepEqual(res.nodes.map((n) => n.path).sort(), ['app/one.md', 'docs/g.md']);
    assert.deepEqual(res.branch.excluded, ['app/legacy']);
    assert.equal(res.branch.rootExcluded, false);
  });

  it('rejects a path present as both include and exclude (invalid params)', async () => {
    await prime({ nodes: [makeNode('a.md')] });
    await assert.rejects(
      () => getBranch(ctx(), { path: ['docs'], exclude: ['docs'] }),
      /include.*exclude|both/i,
    );
  });
});

describe('mcp resources', () => {
  it('readGraphResource returns the full ScanResult', async () => {
    await prime({ nodes: [makeNode('a.md', 'skill')], issues: [makeIssue('error', ['a.md'])] });
    const scan = await readGraphResource(ctx());
    assert.equal(scan.schemaVersion, 1);
    assert.equal(scan.nodes.length, 1);
    assert.equal(scan.issues.length, 1);
  });

  it('readGraphResource returns the empty shape when the DB is absent', async () => {
    const scan = await readGraphResource({ dbPath: join(root.tmp, 'nope.db'), cwd: root.cwd });
    assert.equal(scan.schemaVersion, 1);
    assert.deepEqual(scan.nodes, []);
  });

  it('readIssuesResource returns { items, total }', async () => {
    await prime({
      nodes: [makeNode('a.md')],
      issues: [makeIssue('error', ['a.md']), makeIssue('warn', ['a.md'])],
    });
    const res = await readIssuesResource(ctx());
    assert.equal(res.total, 2);
    assert.equal(res.items.length, 2);
  });

  it('readActivityResource returns the { since, nodes, pairs } snapshot', () => {
    const stats = new ActivityStatsService();
    const res = readActivityResource(stats);
    assert.equal(typeof res.since, 'number');
    assert.deepEqual(res.nodes, {});
    assert.deepEqual(res.pairs, {});
  });
});
