/**
 * `GET /api/scan?meta=1` integration tests.
 *
 * The metadata-only read returns the scan envelope with empty `nodes` /
 * `links` / `issues` arrays but real `COUNT(*)` stats, so the SPA can
 * hydrate its header + banners at boot without the full-corpus payload
 * (paired with `/api/folders` for the tree and `/api/branch` for the map).
 *
 * Coverage:
 *   - absent DB → empty scan shape.
 *   - node / link / issue arrays are empty, stats counts are the real
 *     row counts, scan-meta scalars (scanCeiling / scanTruncated /
 *     maxRenderNodes / providers) round-trip.
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
  const tmp = mkdtempSync(join(tmpdir(), 'skill-map-scan-meta-endpoint-'));
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
    mcpServer: false,
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

describe('GET /api/scan?meta=1', () => {
  it('absent DB → empty scan shape', async () => {
    await bootAndUse(async (handle) => {
      const res = await fetch(url(handle, '/api/scan?meta=1'));
      assert.equal(res.status, 200);
      const body = (await res.json()) as ScanResult;
      assert.equal(body.nodes.length, 0);
      assert.equal(body.links.length, 0);
      assert.equal(body.issues.length, 0);
      assert.equal(body.stats.nodesCount, 0);
    });
  });

  it('empties the row arrays but reports real counts + scan-meta scalars', async () => {
    await prime(
      [makeNode('foo.md'), makeNode('bar.md'), makeNode('baz.md')],
      [makeIssue('error', ['foo.md']), makeIssue('warn', ['bar.md'])],
    );
    await bootAndUse(async (handle) => {
      const res = await fetch(url(handle, '/api/scan?meta=1'));
      assert.equal(res.status, 200);
      const body = (await res.json()) as ScanResult;
      // Arrays are empty (the whole point: no full-corpus payload).
      assert.equal(body.nodes.length, 0);
      assert.equal(body.links.length, 0);
      assert.equal(body.issues.length, 0);
      // ...but stats carry the real COUNT(*) figures.
      assert.equal(body.stats.nodesCount, 3);
      assert.equal(body.stats.issuesCount, 2);
      assert.equal(body.stats.linksCount, 0);
      // Scan-meta scalars round-trip (defaults applied at persist time).
      assert.equal(body.scanCeiling, 5000);
      assert.equal(body.maxRenderNodes, 256);
      assert.equal(body.scanTruncated, false);
      assert.deepEqual(body.providers, ['claude']);
    });
  });
});
