/**
 * Storage integration tests for the `sm jobs submit` helpers
 * (`kernel/adapters/sqlite/jobs.ts`): submit / findActiveDuplicate / list /
 * get. Uses a real file-path SQLite DB via `SqliteStorageAdapter` (never
 * `:memory:`, which yields an empty Kysely-side schema, see
 * feedback_sqlite_in_memory_workaround).
 *
 * Covers the DB invariants the queue relies on:
 *   - submit writes the content row AND the job row in one transaction
 *     (content-addressed blob first).
 *   - `INSERT OR IGNORE` dedups the content blob; a post-terminal resubmit
 *     of the same content shares the single row.
 *   - the duplicate pre-check finds active (queued/running) matches only.
 *   - the unique partial index is the hard backstop: a second active job
 *     for the same (action, node, contentHash) is refused at insert time
 *     (what `--force` cannot defeat).
 *   - list filters + order, get by id / missing.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strictEqual, rejects, ok, deepStrictEqual } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import { SqliteStorageAdapter } from '../index.js';
import type { IJobSubmitRow } from '../../../types/storage.js';

let tempRoot: string;
let counter = 0;

function freshDbPath(label: string): string {
  counter += 1;
  return join(tempRoot, `${label}-${counter}.db`);
}

async function openAdapter(dbPath: string): Promise<SqliteStorageAdapter> {
  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  return adapter;
}

function row(overrides: Partial<IJobSubmitRow> & { id: string }): IJobSubmitRow {
  return {
    extensionId: 'core/skill-summarizer',
    extensionVersion: '1.0.0',
    extensionKind: 'action',
    nodeId: 'a.md',
    contentHash: 'h'.repeat(64),
    nonce: 'n'.repeat(32),
    priority: 0,
    status: 'queued',
    ttlSeconds: 3600,
    createdAt: Date.now(),
    ...overrides,
  };
}

before(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'skill-map-job-submit-'));
});

after(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe('submitJob', () => {
  it('inserts the content row and the job row in one transaction', async () => {
    const adapter = await openAdapter(freshDbPath('submit'));
    try {
      const id = await adapter.jobs.submit(
        row({ id: 'd-20260101-000000-0001' }),
        { contentHash: 'h'.repeat(64), content: 'RENDERED', createdAt: Date.now() },
      );
      strictEqual(id, 'd-20260101-000000-0001');

      const job = await adapter.jobs.get(id);
      ok(job);
      strictEqual(job.status, 'queued');
      strictEqual(job.contentHash, 'h'.repeat(64));

      const content = await adapter.db
        .selectFrom('state_job_contents')
        .selectAll()
        .where('contentHash', '=', 'h'.repeat(64))
        .executeTakeFirst();
      ok(content);
      strictEqual(content.content, 'RENDERED');
    } finally {
      await adapter.close();
    }
  });

  it('shares one content blob across a post-terminal resubmit of the same content', async () => {
    const adapter = await openAdapter(freshDbPath('shared-blob'));
    try {
      const hash = 'c'.repeat(64);
      const content = { contentHash: hash, content: 'SHARED', createdAt: Date.now() };
      await adapter.jobs.submit(row({ id: 'd-20260101-000000-0001', contentHash: hash }), content);
      // Drive the first job to a terminal state so the partial index frees
      // the (action, node, hash) slot.
      await adapter.db
        .updateTable('state_jobs')
        .set({ status: 'completed', finishedAt: Date.now() })
        .where('id', '=', 'd-20260101-000000-0001')
        .execute();
      // Resubmit the SAME content; the blob must not be duplicated.
      await adapter.jobs.submit(row({ id: 'd-20260101-000000-0002', contentHash: hash }), content);

      const blobs = await adapter.db
        .selectFrom('state_job_contents')
        .select('contentHash')
        .where('contentHash', '=', hash)
        .execute();
      strictEqual(blobs.length, 1, 'content blob stored exactly once');

      const jobs = await adapter.db
        .selectFrom('state_jobs')
        .select('id')
        .where('contentHash', '=', hash)
        .execute();
      strictEqual(jobs.length, 2, 'both jobs reference the shared blob');
    } finally {
      await adapter.close();
    }
  });

  it('freezes auto_fix through submit -> state_jobs -> rowToJob (0/1 bridged to boolean)', async () => {
    const adapter = await openAdapter(freshDbPath('auto-fix-frozen'));
    try {
      // Flagged finder submit: auto_fix rides into the row and reads back true.
      const flaggedId = 'd-20260101-000000-0001';
      await adapter.jobs.submit(
        row({ id: flaggedId, extensionKind: 'analyzer', autoFix: true, contentHash: 'a'.repeat(64) }),
        { contentHash: 'a'.repeat(64), content: 'X', createdAt: Date.now() },
      );
      const flagged = await adapter.jobs.get(flaggedId);
      ok(flagged);
      strictEqual(flagged.autoFix, true, 'the frozen flag round-trips as a boolean');

      // Omitting autoFix lands the SQL DEFAULT 0 -> false.
      const defaultId = 'd-20260101-000000-0002';
      await adapter.jobs.submit(
        row({ id: defaultId, nodeId: 'b.md', contentHash: 'b'.repeat(64) }),
        { contentHash: 'b'.repeat(64), content: 'X', createdAt: Date.now() },
      );
      const defaulted = await adapter.jobs.get(defaultId);
      ok(defaulted);
      strictEqual(defaulted.autoFix, false, 'an omitted flag defaults to false');
    } finally {
      await adapter.close();
    }
  });

  it('refuses a second ACTIVE job for the same (action, node, contentHash) via the unique index', async () => {
    const adapter = await openAdapter(freshDbPath('index-backstop'));
    try {
      const hash = 'd'.repeat(64);
      await adapter.jobs.submit(
        row({ id: 'd-20260101-000000-0001', contentHash: hash }),
        { contentHash: hash, content: 'X', createdAt: Date.now() },
      );
      await rejects(
        () =>
          adapter.jobs.submit(
            row({ id: 'd-20260101-000000-0002', contentHash: hash }),
            { contentHash: hash, content: 'X', createdAt: Date.now() },
          ),
        /unique constraint/i,
        'the partial index blocks a second queued/running duplicate',
      );
    } finally {
      await adapter.close();
    }
  });
});

describe('findActiveDuplicate', () => {
  it('returns the id of an active (queued) match and null otherwise', async () => {
    const adapter = await openAdapter(freshDbPath('dup'));
    try {
      const hash = 'e'.repeat(64);
      await adapter.jobs.submit(
        row({ id: 'd-20260101-000000-0001', contentHash: hash }),
        { contentHash: hash, content: 'X', createdAt: Date.now() },
      );
      strictEqual(
        await adapter.jobs.findActiveDuplicate('core/skill-summarizer', '1.0.0', 'a.md', hash),
        'd-20260101-000000-0001',
      );
      // A different content hash does not match.
      strictEqual(
        await adapter.jobs.findActiveDuplicate('core/skill-summarizer', '1.0.0', 'a.md', 'f'.repeat(64)),
        null,
      );
      // Once terminal, it is no longer an active duplicate.
      await adapter.db
        .updateTable('state_jobs')
        .set({ status: 'failed', finishedAt: Date.now() })
        .where('id', '=', 'd-20260101-000000-0001')
        .execute();
      strictEqual(
        await adapter.jobs.findActiveDuplicate('core/skill-summarizer', '1.0.0', 'a.md', hash),
        null,
      );
    } finally {
      await adapter.close();
    }
  });
});

describe('listJobs + getJob', () => {
  it('filters by status / action / node and orders newest-first', async () => {
    const adapter = await openAdapter(freshDbPath('list'));
    try {
      const base = Date.now();
      await adapter.jobs.submit(
        row({ id: 'd-20260101-000000-0001', nodeId: 'a.md', contentHash: '1'.repeat(64), createdAt: base }),
        { contentHash: '1'.repeat(64), content: 'A', createdAt: base },
      );
      await adapter.jobs.submit(
        row({ id: 'd-20260101-000000-0002', nodeId: 'b.md', contentHash: '2'.repeat(64), extensionId: 'core/other', createdAt: base + 10 }),
        { contentHash: '2'.repeat(64), content: 'B', createdAt: base + 10 },
      );
      await adapter.jobs.submit(
        row({ id: 'd-20260101-000000-0003', nodeId: 'a.md', contentHash: '3'.repeat(64), createdAt: base + 20 }),
        { contentHash: '3'.repeat(64), content: 'C', createdAt: base + 20 },
      );

      const all = await adapter.jobs.list({});
      deepStrictEqual(
        all.map((j) => j.id),
        ['d-20260101-000000-0003', 'd-20260101-000000-0002', 'd-20260101-000000-0001'],
        'newest-first order',
      );

      const byNode = await adapter.jobs.list({ nodeId: 'a.md' });
      deepStrictEqual(byNode.map((j) => j.nodeId), ['a.md', 'a.md']);

      // Bare-id suffix match finds the qualified action id.
      const byAction = await adapter.jobs.list({ extensionId: 'skill-summarizer' });
      deepStrictEqual(
        byAction.map((j) => j.id).sort(),
        ['d-20260101-000000-0001', 'd-20260101-000000-0003'],
      );

      const byStatus = await adapter.jobs.list({ status: 'running' });
      strictEqual(byStatus.length, 0);
    } finally {
      await adapter.close();
    }
  });

  it('getJob returns null for a missing id', async () => {
    const adapter = await openAdapter(freshDbPath('get-missing'));
    try {
      strictEqual(await adapter.jobs.get('d-20990101-000000-ffff'), null);
    } finally {
      await adapter.close();
    }
  });
});
