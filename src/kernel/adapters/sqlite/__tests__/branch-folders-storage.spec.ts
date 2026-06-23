/**
 * Acceptance tests for the lazy-load storage primitives the BFF
 * `/api/folders` + `/api/branch` endpoints consume:
 *
 *   - `port.scans.listLiteNodes()`, `{ path, kind, linksInCount, linksOutCount, tokensTotal, modifiedAtMs }[]` ordered by path.
 *   - `port.scans.issueCountsByPath()`, per-node error / warn incidence
 *     via `json_each` + GROUP BY (info ignored).
 *   - `port.scans.effectiveMaxRenderNodes()`, the scan's recorded cap
 *     with the 256 default on a never-scanned DB.
 *   - `port.scans.loadBranch(prefixes, limit)`, prefix-union + capped
 *     projection (nodes / links / issues / total / paths) computed in
 *     SQL.
 *
 * Rows are planted directly into the `scan_*` tables (no scan / persist
 * round-trip) so the dataset shape is fully controlled. Per-test DB uses
 * `mkdtempSync` file paths, the SqliteStorageAdapter does not work with
 * `:memory:` (two distinct DatabaseSync instances on init()).
 */

import { after, before, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SqliteStorageAdapter } from '../index.js';

let dbRoot: string;
let dbCounter = 0;

function freshDbPath(label: string): string {
  dbCounter += 1;
  return join(dbRoot, `${label}-${dbCounter}.db`);
}

before(() => {
  dbRoot = mkdtempSync(join(tmpdir(), 'skill-map-branch-folders-'));
});

after(() => {
  rmSync(dbRoot, { recursive: true, force: true });
});

const HASH = '0'.repeat(64);

async function plantNode(
  adapter: SqliteStorageAdapter,
  path: string,
  kind = 'note',
): Promise<void> {
  await adapter.db
    .insertInto('scan_nodes')
    .values({
      path,
      kind,
      provider: 'claude',
      frontmatterJson: '{}',
      bodyHash: HASH,
      frontmatterHash: HASH,
      bytesFrontmatter: 0,
      bytesBody: 0,
      bytesTotal: 0,
      tokensFrontmatter: null,
      tokensBody: null,
      tokensTotal: null,
      scannedAt: Date.now(),
    })
    .execute();
}

async function plantLink(
  adapter: SqliteStorageAdapter,
  source: string,
  target: string,
): Promise<void> {
  await adapter.db
    .insertInto('scan_links')
    .values({
      sourcePath: source,
      targetPath: target,
      kind: 'references',
      confidence: 1.0,
      sourcesJson: JSON.stringify(['markdown-link']),
      originalTrigger: null,
      normalizedTrigger: null,
      locationLine: null,
      locationColumn: null,
      locationOffset: null,
      occurrencesJson: null,
      resolvedTarget: null,
      raw: null,
    })
    .execute();
}

async function plantIssue(
  adapter: SqliteStorageAdapter,
  severity: 'error' | 'warn' | 'info',
  nodeIds: string[],
): Promise<void> {
  await adapter.db
    .insertInto('scan_issues')
    .values({
      analyzerId: 'core/reference-broken',
      severity,
      nodeIdsJson: JSON.stringify(nodeIds),
      linkIndicesJson: null,
      message: 'planted',
      detail: null,
      fixJson: null,
      dataJson: null,
    })
    .execute();
}

describe('port.scans.listLiteNodes', () => {
  it('empty DB returns zero rows', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('lite-empty'), autoBackup: false });
    await adapter.init();
    try {
      const rows = await adapter.scans.listLiteNodes();
      assert.equal(rows.length, 0);
    } finally {
      await adapter.close();
    }
  });

  it('returns { path, kind } ordered by path ASC', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('lite'), autoBackup: false });
    await adapter.init();
    try {
      await plantNode(adapter, 'skills/zeta.md', 'skill');
      await plantNode(adapter, 'agents/alpha.md', 'agent');
      const rows = await adapter.scans.listLiteNodes();
      assert.deepEqual(rows, [
        {
          path: 'agents/alpha.md',
          kind: 'agent',
          linksInCount: 0,
          linksOutCount: 0,
          tokensTotal: null,
          modifiedAtMs: null,
        },
        {
          path: 'skills/zeta.md',
          kind: 'skill',
          linksInCount: 0,
          linksOutCount: 0,
          tokensTotal: null,
          modifiedAtMs: null,
        },
      ]);
    } finally {
      await adapter.close();
    }
  });
});

describe('port.scans.issueCountsByPath', () => {
  it('empty DB returns an empty map', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('counts-empty'), autoBackup: false });
    await adapter.init();
    try {
      const map = await adapter.scans.issueCountsByPath();
      assert.equal(map.size, 0);
    } finally {
      await adapter.close();
    }
  });

  it('rolls up error / warn incidence per node, ignoring info', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('counts'), autoBackup: false });
    await adapter.init();
    try {
      // foo: 2 errors + 1 warn; bar: 1 warn; baz: only info (absent).
      await plantIssue(adapter, 'error', ['foo.md']);
      await plantIssue(adapter, 'error', ['foo.md', 'bar.md']); // bar gets a warn below; foo a 2nd error
      await plantIssue(adapter, 'warn', ['foo.md']);
      await plantIssue(adapter, 'warn', ['bar.md']);
      await plantIssue(adapter, 'info', ['baz.md']);

      const map = await adapter.scans.issueCountsByPath();
      assert.deepEqual(map.get('foo.md'), { error: 2, warn: 1 });
      // bar.md appears in one error issue (the 2-node one) + one warn.
      assert.deepEqual(map.get('bar.md'), { error: 1, warn: 1 });
      // baz.md only had an info issue, so it is absent from the map.
      assert.equal(map.has('baz.md'), false);
    } finally {
      await adapter.close();
    }
  });
});

describe('port.scans.effectiveMaxRenderNodes', () => {
  it('defaults to 256 on a never-scanned DB (no scan_meta row)', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('cap-default'), autoBackup: false });
    await adapter.init();
    try {
      assert.equal(await adapter.scans.effectiveMaxRenderNodes(), 256);
    } finally {
      await adapter.close();
    }
  });

  it('reads the persisted scan_meta.max_render_nodes', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('cap-meta'), autoBackup: false });
    await adapter.init();
    try {
      await adapter.db
        .insertInto('scan_meta')
        .values({
          id: 1,
          rootsJson: JSON.stringify(['.']),
          scannedAt: Date.now(),
          scannedByName: 'test',
          scannedByVersion: '0.0.0',
          scannedBySpecVersion: '0.0.0',
          providersJson: JSON.stringify(['claude']),
          statsFilesWalked: 0,
          statsFilesSkipped: 0,
          statsDurationMs: 0,
          scanCeiling: 50000,
          scanTruncated: 0,
          maxRenderNodes: 42,
          tokenizer: null,
          oversizedFilesJson: null,
          schemaFingerprint: null,
        })
        .execute();
      assert.equal(await adapter.scans.effectiveMaxRenderNodes(), 42);
    } finally {
      await adapter.close();
    }
  });
});

describe('port.scans.loadBranch', () => {
  it('empty DB returns an empty branch (total 0)', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('branch-empty'), autoBackup: false });
    await adapter.init();
    try {
      const branch = await adapter.scans.loadBranch([], 256);
      assert.equal(branch.total, 0);
      assert.equal(branch.nodes.length, 0);
      assert.equal(branch.links.length, 0);
      assert.equal(branch.issues.length, 0);
      assert.deepEqual(branch.paths, []);
    } finally {
      await adapter.close();
    }
  });

  it('empty prefix selects the whole corpus in stable path order', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('branch-all'), autoBackup: false });
    await adapter.init();
    try {
      await plantNode(adapter, 'b/two.md');
      await plantNode(adapter, 'a/one.md');
      const branch = await adapter.scans.loadBranch([], 256);
      assert.equal(branch.total, 2);
      assert.deepEqual(branch.nodes.map((n) => n.path), ['a/one.md', 'b/two.md']);
      assert.deepEqual(branch.paths, []);
    } finally {
      await adapter.close();
    }
  });

  it('prefix scopes to the folder node itself plus descendants only', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('branch-prefix'), autoBackup: false });
    await adapter.init();
    try {
      await plantNode(adapter, 'src');
      await plantNode(adapter, 'src/a.md');
      await plantNode(adapter, 'src/deep/b.md');
      await plantNode(adapter, 'srcother/c.md'); // shares the string prefix but NOT the path boundary
      await plantNode(adapter, 'other/d.md');

      const branch = await adapter.scans.loadBranch(['src'], 256);
      assert.equal(branch.total, 3);
      assert.deepEqual(branch.nodes.map((n) => n.path), [
        'src',
        'src/a.md',
        'src/deep/b.md',
      ]);
      assert.deepEqual(branch.paths, ['src']);
    } finally {
      await adapter.close();
    }
  });

  it('caps at limit and reports total BEFORE the cap', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('branch-cap'), autoBackup: false });
    await adapter.init();
    try {
      for (let i = 0; i < 5; i++) await plantNode(adapter, `x/n${i}.md`);
      const branch = await adapter.scans.loadBranch(['x'], 2);
      assert.equal(branch.total, 5);
      assert.equal(branch.nodes.length, 2);
      assert.deepEqual(branch.nodes.map((n) => n.path), ['x/n0.md', 'x/n1.md']);
    } finally {
      await adapter.close();
    }
  });

  it('links only when both endpoints are inside the capped node set', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('branch-links'), autoBackup: false });
    await adapter.init();
    try {
      await plantNode(adapter, 'p/a.md');
      await plantNode(adapter, 'p/b.md');
      await plantNode(adapter, 'q/c.md');
      await plantLink(adapter, 'p/a.md', 'p/b.md'); // both in branch p
      await plantLink(adapter, 'p/a.md', 'q/c.md'); // target outside branch p

      const branch = await adapter.scans.loadBranch(['p'], 256);
      assert.equal(branch.links.length, 1);
      assert.equal(branch.links[0]?.source, 'p/a.md');
      assert.equal(branch.links[0]?.target, 'p/b.md');
    } finally {
      await adapter.close();
    }
  });

  it('issues only when nodeIds intersect the capped node set', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('branch-issues'), autoBackup: false });
    await adapter.init();
    try {
      await plantNode(adapter, 'p/a.md');
      await plantNode(adapter, 'q/c.md');
      await plantIssue(adapter, 'error', ['p/a.md']); // in branch
      await plantIssue(adapter, 'warn', ['q/c.md']); // outside branch

      const branch = await adapter.scans.loadBranch(['p'], 256);
      assert.equal(branch.issues.length, 1);
      assert.deepEqual(branch.issues[0]?.nodeIds, ['p/a.md']);
    } finally {
      await adapter.close();
    }
  });

  it('a link whose target is past the cap is dropped (both-endpoints rule)', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('branch-cap-links'), autoBackup: false });
    await adapter.init();
    try {
      await plantNode(adapter, 'p/a.md');
      await plantNode(adapter, 'p/b.md');
      await plantNode(adapter, 'p/c.md');
      // a -> c, but a cap of 2 only renders a + b, so the edge to c drops.
      await plantLink(adapter, 'p/a.md', 'p/c.md');
      const branch = await adapter.scans.loadBranch(['p'], 2);
      assert.equal(branch.nodes.length, 2);
      assert.equal(branch.links.length, 0);
    } finally {
      await adapter.close();
    }
  });

  it('union of two sibling prefixes (deduped nodes, stable path order)', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('branch-union'), autoBackup: false });
    await adapter.init();
    try {
      await plantNode(adapter, 'a/one.md');
      await plantNode(adapter, 'a/two.md');
      await plantNode(adapter, 'b/three.md');
      await plantNode(adapter, 'c/four.md'); // outside both prefixes

      const branch = await adapter.scans.loadBranch(['a', 'b'], 256);
      assert.equal(branch.total, 3);
      // Union in a single stable `ORDER BY path` pass, no duplicates.
      assert.deepEqual(branch.nodes.map((n) => n.path), [
        'a/one.md',
        'a/two.md',
        'b/three.md',
      ]);
      assert.deepEqual(branch.paths, ['a', 'b']);
    } finally {
      await adapter.close();
    }
  });

  it('cap + total computed over the UNION of prefixes', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('branch-union-cap'), autoBackup: false });
    await adapter.init();
    try {
      // 2 nodes under a, 2 under b: union total 4, cap 3 renders the
      // first 3 in path order.
      await plantNode(adapter, 'a/1.md');
      await plantNode(adapter, 'a/2.md');
      await plantNode(adapter, 'b/1.md');
      await plantNode(adapter, 'b/2.md');

      const branch = await adapter.scans.loadBranch(['a', 'b'], 3);
      assert.equal(branch.total, 4);
      assert.equal(branch.nodes.length, 3);
      assert.deepEqual(branch.nodes.map((n) => n.path), [
        'a/1.md',
        'a/2.md',
        'b/1.md',
      ]);
    } finally {
      await adapter.close();
    }
  });

  it('union: a cross-prefix link is carried (both endpoints in the union)', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('branch-union-links'), autoBackup: false });
    await adapter.init();
    try {
      await plantNode(adapter, 'a/x.md');
      await plantNode(adapter, 'b/y.md');
      await plantNode(adapter, 'c/z.md'); // outside the union
      await plantLink(adapter, 'a/x.md', 'b/y.md'); // both in union {a, b}
      await plantLink(adapter, 'a/x.md', 'c/z.md'); // target outside union

      const branch = await adapter.scans.loadBranch(['a', 'b'], 256);
      assert.equal(branch.links.length, 1);
      assert.equal(branch.links[0]?.source, 'a/x.md');
      assert.equal(branch.links[0]?.target, 'b/y.md');
    } finally {
      await adapter.close();
    }
  });

  it('union: a link whose target is past the cap is dropped (both-endpoints rule)', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('branch-union-cap-links'), autoBackup: false });
    await adapter.init();
    try {
      await plantNode(adapter, 'a/1.md');
      await plantNode(adapter, 'a/2.md');
      await plantNode(adapter, 'b/1.md');
      // Edge a/1 -> b/1, but cap 2 renders only a/1 + a/2, so it drops.
      await plantLink(adapter, 'a/1.md', 'b/1.md');
      const branch = await adapter.scans.loadBranch(['a', 'b'], 2);
      assert.deepEqual(branch.nodes.map((n) => n.path), ['a/1.md', 'a/2.md']);
      assert.equal(branch.links.length, 0);
    } finally {
      await adapter.close();
    }
  });

  it('duplicate prefixes are de-duped (no double counting, paths deduped)', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('branch-dedup'), autoBackup: false });
    await adapter.init();
    try {
      await plantNode(adapter, 'a/one.md');
      await plantNode(adapter, 'a/two.md');

      const branch = await adapter.scans.loadBranch(['a', 'a'], 256);
      assert.equal(branch.total, 2);
      assert.deepEqual(branch.nodes.map((n) => n.path), ['a/one.md', 'a/two.md']);
      assert.deepEqual(branch.paths, ['a']);
    } finally {
      await adapter.close();
    }
  });

  it('a prefix that is itself a node path matches that node + its descendants', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('branch-node-prefix'), autoBackup: false });
    await adapter.init();
    try {
      await plantNode(adapter, 'docs/guide.md'); // the prefix is this exact path
      await plantNode(adapter, 'docs/guide.md/sub.md'); // descendant under it
      await plantNode(adapter, 'docs/guideline.md'); // shares the string, NOT the boundary

      const branch = await adapter.scans.loadBranch(['docs/guide.md'], 256);
      assert.equal(branch.total, 2);
      assert.deepEqual(branch.nodes.map((n) => n.path), [
        'docs/guide.md',
        'docs/guide.md/sub.md',
      ]);
    } finally {
      await adapter.close();
    }
  });
});
