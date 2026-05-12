/**
 * Audit L6, `/api/issues` pagination + filter contract tests.
 *
 * Mirrors `server-pagination.test.ts` (which covers `/api/nodes`) but
 * for the issues route. The fixture plants ~150 synthetic
 * `scan_issues` rows directly (the orchestrator does not naturally
 * yield that many per scan); the test verifies:
 *
 *   - default pagination: `limit=100`, `offset=0`, `total` is the
 *     full match count (NOT just the returned slice);
 *   - custom `?limit=` / `?offset=` slice the page deterministically;
 *   - `?limit=1001` rejects with 400 `bad-query` (mirrors `/api/nodes`
 *     `MAX_LIMIT=1000`);
 *   - each filter individually (severity, analyzerId qualified +
 *     short form, node) constrains both `total` AND the page slice;
 *   - combined filters intersect, and `total` reflects the full
 *     intersection (audit L6's load-bearing invariant: the prior
 *     route loaded every row into memory and filtered in JS, so a
 *     pathological scope blew the heap; the SQL push must preserve
 *     the contract).
 *
 * Drives the route end-to-end via `createServer({...})` + `fetch` so
 * the test exercises the Hono pipeline (route registration, env
 * validation, error envelope) and the storage adapter together.
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { SqliteStorageAdapter } from '../kernel/adapters/sqlite/index.js';
import {
  createServer,
  type IServerOptions,
  type IServerHandle,
} from '../server/index.js';

const ISSUE_FIXTURE_COUNT = 150; // > MAX_LIMIT defaults so paging is observable

let tmpRoot: string;
let dbPath: string;

before(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-server-issues-paginate-'));
  dbPath = join(tmpRoot, 'issues.db');
  await primeIssuesDb(dbPath);
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

/**
 * Plant a controlled mix of issue rows directly into `scan_issues`:
 *
 *   - 100 rows: `core/broken-ref`, severity `error`, node `target.md`
 *     plus a per-row unique companion.
 *   - 30 rows: `core/superseded`, severity `warn`, node mix.
 *   - 20 rows: `plugin/orphan`, severity `info`, unrelated nodes.
 *
 * Total 150 rows. Tests pick filters expecting specific subset sizes
 * derived from this shape.
 */
async function primeIssuesDb(db: string): Promise<void> {
  const adapter = new SqliteStorageAdapter({ databasePath: db, autoBackup: false });
  await adapter.init();
  try {
    const inserts: {
      analyzerId: string;
      severity: 'error' | 'warn' | 'info';
      nodeIdsJson: string;
      linkIndicesJson: null;
      message: string;
      detail: null;
      fixJson: null;
      dataJson: null;
    }[] = [];

    for (let i = 0; i < 100; i++) {
      inserts.push({
        analyzerId: 'core/broken-ref',
        severity: 'error',
        nodeIdsJson: JSON.stringify(['target.md', `companion-${i}.md`]),
        linkIndicesJson: null,
        message: `broken-ref-${i}`,
        detail: null,
        fixJson: null,
        dataJson: null,
      });
    }
    for (let i = 0; i < 30; i++) {
      inserts.push({
        analyzerId: 'core/superseded',
        severity: 'warn',
        nodeIdsJson: JSON.stringify([`legacy-${i}.md`]),
        linkIndicesJson: null,
        message: `superseded-${i}`,
        detail: null,
        fixJson: null,
        dataJson: null,
      });
    }
    for (let i = 0; i < 20; i++) {
      inserts.push({
        analyzerId: 'plugin/orphan',
        severity: 'info',
        nodeIdsJson: JSON.stringify([`orphan-${i}.md`]),
        linkIndicesJson: null,
        message: `orphan-${i}`,
        detail: null,
        fixJson: null,
        dataJson: null,
      });
    }
    // Bulk-insert in chunks to keep the statement size sane.
    await adapter.db.insertInto('scan_issues').values(inserts).execute();
  } finally {
    await adapter.close();
  }
}

function defaultOptions(overrides: Partial<IServerOptions> = {}): IServerOptions {
  return {
    port: 0,
    host: '127.0.0.1',
    scope: 'project',
    dbPath,
    uiDist: null,
    noUi: false,
    noBuiltIns: true, // route does not need the pipeline; skip plugin discovery
    noPlugins: true,
    open: false,
    devCors: false,
    noWatcher: true,
    ...overrides,
  };
}

async function bootAndUse<T>(
  options: IServerOptions,
  fn: (handle: IServerHandle) => Promise<T>,
): Promise<T> {
  const handle = await createServer(options);
  try {
    return await fn(handle);
  } finally {
    await handle.close();
  }
}

interface IListEnvelope<T> {
  items: T[];
  filters: Record<string, unknown>;
  counts: { total: number; returned: number; page?: { offset: number; limit: number } };
}

interface IIssueShape {
  analyzerId: string;
  severity: 'error' | 'warn' | 'info';
  nodeIds: string[];
}

function url(handle: IServerHandle, path: string): string {
  return `http://127.0.0.1:${handle.address.port}${path}`;
}

describe('/api/issues, pagination + filters', () => {
  it('default page caps at limit=100, total reports the full table', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/issues'));
      assert.equal(res.status, 200);
      const env = (await res.json()) as IListEnvelope<IIssueShape>;
      assert.equal(env.items.length, 100);
      assert.equal(env.counts.returned, 100);
      assert.equal(env.counts.total, ISSUE_FIXTURE_COUNT);
      assert.deepEqual(env.counts.page, { offset: 0, limit: 100 });
    });
  });

  it('?limit=10 returns 10 items, total stays full', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/issues?limit=10'));
      const env = (await res.json()) as IListEnvelope<IIssueShape>;
      assert.equal(env.items.length, 10);
      assert.equal(env.counts.total, ISSUE_FIXTURE_COUNT);
      assert.deepEqual(env.counts.page, { offset: 0, limit: 10 });
    });
  });

  it('?limit=10&offset=5 skips the first 5 rows (id-stable paging)', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res1 = await fetch(url(handle, '/api/issues?limit=10&offset=0'));
      const res2 = await fetch(url(handle, '/api/issues?limit=10&offset=5'));
      const env1 = (await res1.json()) as IListEnvelope<IIssueShape>;
      const env2 = (await res2.json()) as IListEnvelope<IIssueShape>;
      assert.equal(env1.items.length, 10);
      assert.equal(env2.items.length, 10);
      // offset=5's first item lines up with offset=0's 6th (index 5).
      assert.deepEqual(env2.items[0], env1.items[5]);
    });
  });

  it('?limit=1000 (= MAX) is accepted; returns every row in one page', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/issues?limit=1000'));
      assert.equal(res.status, 200);
      const env = (await res.json()) as IListEnvelope<IIssueShape>;
      assert.equal(env.items.length, ISSUE_FIXTURE_COUNT);
      assert.equal(env.counts.page!.limit, 1000);
    });
  });

  it('?limit=1001 (> MAX) rejects with 400 bad-query', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/issues?limit=1001'));
      assert.equal(res.status, 400);
      const body = (await res.json()) as { error: { code: string; message: string } };
      assert.equal(body.error.code, 'bad-query');
      assert.match(body.error.message, /1000/);
    });
  });

  it('?limit=-1 rejects with 400 bad-query', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/issues?limit=-1'));
      assert.equal(res.status, 400);
    });
  });

  it('?offset=foo rejects with 400 bad-query', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/issues?offset=foo'));
      assert.equal(res.status, 400);
    });
  });

  it('?severity=warn narrows total + items to warn rows only', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/issues?severity=warn'));
      const env = (await res.json()) as IListEnvelope<IIssueShape>;
      assert.equal(env.counts.total, 30); // fixture has exactly 30 warn rows
      for (const issue of env.items) assert.equal(issue.severity, 'warn');
    });
  });

  it('?severity=error,info matches both severities (IN clause)', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/issues?severity=error,info'));
      const env = (await res.json()) as IListEnvelope<IIssueShape>;
      assert.equal(env.counts.total, 100 + 20);
      for (const issue of env.items) assert.ok(['error', 'info'].includes(issue.severity));
    });
  });

  it('?analyzerId=core/superseded (qualified form) matches exactly that analyzer', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/issues?analyzerId=core/superseded'));
      const env = (await res.json()) as IListEnvelope<IIssueShape>;
      assert.equal(env.counts.total, 30);
      for (const issue of env.items) assert.equal(issue.analyzerId, 'core/superseded');
    });
  });

  it('?analyzerId=broken-ref (short form) matches via suffix LIKE clause', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/issues?analyzerId=broken-ref'));
      const env = (await res.json()) as IListEnvelope<IIssueShape>;
      assert.equal(env.counts.total, 100);
      for (const issue of env.items) assert.equal(issue.analyzerId, 'core/broken-ref');
    });
  });

  it('?node=target.md keeps issues whose nodeIds JSON array contains the path', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, `/api/issues?node=${encodeURIComponent('target.md')}`));
      const env = (await res.json()) as IListEnvelope<IIssueShape>;
      // Every `core/broken-ref` row contains `target.md` (planted that
      // way in primeIssuesDb).
      assert.equal(env.counts.total, 100);
      for (const issue of env.items) {
        assert.ok(issue.nodeIds.includes('target.md'));
      }
    });
  });

  it('combined filters intersect: severity + analyzerId + node', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(
        url(
          handle,
          `/api/issues?severity=error&analyzerId=broken-ref&node=${encodeURIComponent('target.md')}`,
        ),
      );
      const env = (await res.json()) as IListEnvelope<IIssueShape>;
      // All 100 broken-ref rows are error + carry target.md.
      assert.equal(env.counts.total, 100);
      for (const issue of env.items) {
        assert.equal(issue.severity, 'error');
        assert.equal(issue.analyzerId, 'core/broken-ref');
        assert.ok(issue.nodeIds.includes('target.md'));
      }
    });
  });

  it('total reflects full filter match, NOT just the page slice', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      // Filter to 100 rows, ask for a 10-row page. total must stay 100.
      const res = await fetch(url(handle, '/api/issues?analyzerId=broken-ref&limit=10'));
      const env = (await res.json()) as IListEnvelope<IIssueShape>;
      assert.equal(env.items.length, 10);
      assert.equal(env.counts.returned, 10);
      assert.equal(env.counts.total, 100);
    });
  });

  it('echoes the active filters back in the envelope', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/issues?severity=error,warn&node=target.md'));
      const env = (await res.json()) as IListEnvelope<IIssueShape>;
      assert.deepEqual(env.filters['severity'], ['error', 'warn']);
      assert.equal(env.filters['node'], 'target.md');
      assert.equal(env.filters['analyzerId'], null);
    });
  });

  it('returns an empty envelope when DB is absent (graceful degradation)', async () => {
    await bootAndUse(
      defaultOptions({ dbPath: join(tmpRoot, 'absent', 'never-existed.db') }),
      async (handle) => {
        const res = await fetch(url(handle, '/api/issues'));
        assert.equal(res.status, 200);
        const env = (await res.json()) as IListEnvelope<IIssueShape>;
        assert.equal(env.items.length, 0);
        assert.equal(env.counts.total, 0);
        assert.deepEqual(env.counts.page, { offset: 0, limit: 100 });
      },
    );
  });
});
