/**
 * `GET /api/folders` integration tests.
 *
 * Boots a real `createServer()` against a primed-DB tempdir, fires
 * `fetch()`, and asserts on the `RestEnvelope` (`kind: 'folders'`) shape:
 * one item per scanned node `{ path, kind, errorCount, warnCount }`, the
 * error / warn incidence rolled up per node from `scan_issues`.
 *
 * Coverage:
 *   - empty / absent DB → zero items.
 *   - one item per node with `{ path, kind }`.
 *   - errorCount / warnCount roll up issue incidence; info ignored.
 *   - no pagination (counts.total == items.length, no counts.page).
 *
 * Per-test fixture path uses `mkdtempSync` (the SqliteStorageAdapter does
 * not work with `:memory:`).
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import { SqliteStorageAdapter } from '../../../kernel/adapters/sqlite/index.js';
import { persistScanResult } from '../../../kernel/adapters/sqlite/scan-persistence.js';
import type { Issue, Node, ScanResult } from '../../../kernel/types.js';
import {
  createServer,
  type IServerOptions,
  type IServerHandle,
} from '../../index.js';

const HASH = 'a'.repeat(64);

interface ITestRoot {
  tmp: string;
  fixtureRoot: string;
  dbPath: string;
}

let root: ITestRoot;

before(() => {
  const tmp = mkdtempSync(join(tmpdir(), 'skill-map-folders-endpoint-'));
  root = { tmp, fixtureRoot: join(tmp, 'fixture'), dbPath: join(tmp, 'primed.db') };
});

after(() => {
  rmSync(root.tmp, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(root.dbPath, { force: true });
});

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

function makeIssue(severity: 'error' | 'warn' | 'info', nodeIds: string[]): Issue {
  return { analyzerId: 'core/reference-broken', severity, nodeIds, message: 'planted' };
}

async function prime(nodes: Node[], issues: Issue[]): Promise<void> {
  const result: ScanResult = {
    schemaVersion: 1,
    scannedAt: Date.now(),
    roots: [root.fixtureRoot],
    providers: ['claude'],
    nodes,
    links: [],
    issues,
    stats: {
      filesWalked: nodes.length,
      filesSkipped: 0,
      nodesCount: nodes.length,
      linksCount: 0,
      issuesCount: issues.length,
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

function defaultOptions(): IServerOptions {
  return {
    port: 0,
    host: '127.0.0.1',
    dbPath: root.dbPath,
    uiDist: null,
    noUi: false,
    noBuiltIns: false,
    noPlugins: true,
    open: false,
    devCors: false,
    noWatcher: true,
  };
}

async function bootAndUse<T>(fn: (handle: IServerHandle) => Promise<T>): Promise<T> {
  const handle = await createServer(defaultOptions(), {
    runtimeContext: { cwd: root.fixtureRoot },
  });
  try {
    return await fn(handle);
  } finally {
    await handle.close();
  }
}

function url(handle: IServerHandle, path: string): string {
  return `http://127.0.0.1:${handle.address.port}${path}`;
}

interface IFoldersBody {
  schemaVersion: string;
  kind: string;
  items: Array<{ path: string; kind: string; errorCount: number; warnCount: number }>;
  counts: { total: number; returned: number; page?: unknown };
}

describe('GET /api/folders', () => {
  it('absent DB → zero items', async () => {
    // No prime() this run, so the DB file does not exist.
    await bootAndUse(async (handle) => {
      const res = await fetch(url(handle, '/api/folders'));
      assert.equal(res.status, 200);
      const body = (await res.json()) as IFoldersBody;
      assert.equal(body.kind, 'folders');
      assert.equal(body.items.length, 0);
      assert.equal(body.counts.total, 0);
    });
  });

  it('one item per node with { path, kind }, ordered by path', async () => {
    await prime([makeNode('skills/zeta.md', 'skill'), makeNode('agents/alpha.md', 'agent')], []);
    await bootAndUse(async (handle) => {
      const res = await fetch(url(handle, '/api/folders'));
      assert.equal(res.status, 200);
      const body = (await res.json()) as IFoldersBody;
      assert.equal(body.items.length, 2);
      assert.deepEqual(
        body.items.map((i) => ({ path: i.path, kind: i.kind })),
        [
          { path: 'agents/alpha.md', kind: 'agent' },
          { path: 'skills/zeta.md', kind: 'skill' },
        ],
      );
      // Only the cheap scalar columns: no frontmatter / body / signals /
      // contributions leaked onto the item.
      assert.deepEqual(Object.keys(body.items[0]!).sort(), [
        'errorCount',
        'kind',
        'linksInCount',
        'linksOutCount',
        'modifiedAtMs',
        'path',
        'tokensTotal',
        'warnCount',
      ]);
    });
  });

  it('errorCount / warnCount roll up issue incidence per node, ignoring info', async () => {
    await prime(
      [makeNode('foo.md'), makeNode('bar.md'), makeNode('baz.md')],
      [
        makeIssue('error', ['foo.md']),
        makeIssue('error', ['foo.md', 'bar.md']),
        makeIssue('warn', ['foo.md']),
        makeIssue('warn', ['bar.md']),
        makeIssue('info', ['baz.md']),
      ],
    );
    await bootAndUse(async (handle) => {
      const res = await fetch(url(handle, '/api/folders'));
      const body = (await res.json()) as IFoldersBody;
      const byPath = new Map(body.items.map((i) => [i.path, i]));
      assert.deepEqual(
        { error: byPath.get('foo.md')!.errorCount, warn: byPath.get('foo.md')!.warnCount },
        { error: 2, warn: 1 },
      );
      assert.deepEqual(
        { error: byPath.get('bar.md')!.errorCount, warn: byPath.get('bar.md')!.warnCount },
        { error: 1, warn: 1 },
      );
      // baz only had an info issue → both badge counts are zero.
      assert.deepEqual(
        { error: byPath.get('baz.md')!.errorCount, warn: byPath.get('baz.md')!.warnCount },
        { error: 0, warn: 0 },
      );
    });
  });

  it('does not paginate (counts.total == items.length, no page window)', async () => {
    await prime([makeNode('a.md'), makeNode('b.md')], []);
    await bootAndUse(async (handle) => {
      const res = await fetch(url(handle, '/api/folders'));
      const body = (await res.json()) as IFoldersBody;
      assert.equal(body.counts.total, body.items.length);
      assert.equal(body.counts.page, undefined);
    });
  });
});
