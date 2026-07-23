/**
 * Unit tests for the shared `claimJob` engine (`core/jobs/claim-engine.ts`):
 * the reap + atomic claim + content fetch + corruption handling that both
 * `sm jobs claim` and the MCP `claim_job` tool wrap. Seeds jobs directly
 * through the storage port (no CLI verb, no plugin runtime). Uses a
 * `mkdtempSync` file DB, never `:memory:` (the adapter opens two
 * DatabaseSync instances, see feedback_sqlite_in_memory_workaround).
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { SqliteStorageAdapter } from '../../../kernel/adapters/sqlite/index.js';
import type { IJobSubmitRow } from '../../../kernel/types/storage.js';
import { claimJob } from '../claim-engine.js';

let tmpRoot: string;
let counter = 0;

const A = { id: 'd-20260101-000000-0001', nodeId: 'a.md', contentHash: '1'.repeat(64) };

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-claim-engine-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

async function openDb(dbPath: string): Promise<SqliteStorageAdapter> {
  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  return adapter;
}

async function seedQueued(dbPath: string, job = A): Promise<void> {
  const adapter = await openDb(dbPath);
  try {
    const row: IJobSubmitRow = {
      id: job.id,
      extensionId: 'core/skill-summarizer',
      extensionVersion: '1.0.0',
      extensionKind: 'action',
      nodeId: job.nodeId,
      contentHash: job.contentHash,
      nonce: `nonce-${job.id}`,
      priority: 0,
      status: 'queued',
      ttlSeconds: 3600,
      createdAt: Date.now(),
    };
    await adapter.jobs.submit(row, {
      contentHash: row.contentHash,
      content: `RENDERED ${job.id}`,
      createdAt: row.createdAt,
    });
  } finally {
    await adapter.close();
  }
}

function freshDb(): string {
  counter += 1;
  return join(tmpRoot, `claim-${counter}.db`);
}

describe('claimJob engine', () => {
  it('returns empty on an empty queue', async () => {
    const dbPath = freshDb();
    const adapter = await openDb(dbPath);
    try {
      const outcome = await claimJob(adapter, { runner: 'agent', nowMs: Date.now() });
      assert.deepEqual(outcome, { kind: 'empty' });
    } finally {
      await adapter.close();
    }
  });

  it('claims the queued job and returns its id, nonce, content, and row', async () => {
    const dbPath = freshDb();
    await seedQueued(dbPath);
    const adapter = await openDb(dbPath);
    try {
      const outcome = await claimJob(adapter, { runner: 'agent', nowMs: Date.now() });
      assert.equal(outcome.kind, 'claimed');
      if (outcome.kind !== 'claimed') return;
      assert.equal(outcome.id, A.id);
      assert.equal(outcome.nonce, `nonce-${A.id}`);
      assert.match(outcome.content, new RegExp(A.id));
      // The re-read row is stamped running / runner agent.
      assert.equal(outcome.job.status, 'running');
      assert.equal(outcome.job.runner, 'agent');
      assert.equal(outcome.job.nodeId, A.nodeId);
    } finally {
      await adapter.close();
    }
  });

  it('marks a claimed job with a missing content row failed / job-file-missing', async () => {
    const dbPath = freshDb();
    await seedQueued(dbPath);
    const seed = await openDb(dbPath);
    try {
      await seed.db.deleteFrom('state_job_contents').where('contentHash', '=', A.contentHash).execute();
    } finally {
      await seed.close();
    }

    const adapter = await openDb(dbPath);
    try {
      const outcome = await claimJob(adapter, { runner: 'agent', nowMs: Date.now() });
      assert.deepEqual(outcome, { kind: 'corrupt', jobId: A.id });
      // The engine recorded the failure itself (execution row documents it).
      const job = await adapter.jobs.get(A.id);
      assert.equal(job?.status, 'failed');
      assert.equal(job?.failureReason, 'job-file-missing');
      const execs = await adapter.history.list({});
      assert.equal(execs.length, 1);
      assert.equal(execs[0]?.failureReason, 'job-file-missing');
    } finally {
      await adapter.close();
    }
  });

  it('reaps an expired running job before claiming the next queued one', async () => {
    const dbPath = freshDb();
    const B = { id: 'd-20260101-000000-0002', nodeId: 'b.md', contentHash: '2'.repeat(64) };
    await seedQueued(dbPath, A);
    await seedQueued(dbPath, B);
    const seed = await openDb(dbPath);
    try {
      const first = await seed.jobs.claim('agent', Date.now());
      assert.ok(first);
      await seed.db
        .updateTable('state_jobs')
        .set({ expiresAt: Date.now() - 1000 })
        .where('id', '=', first.id)
        .execute();
    } finally {
      await seed.close();
    }

    const adapter = await openDb(dbPath);
    try {
      const outcome = await claimJob(adapter, { runner: 'agent', nowMs: Date.now() });
      assert.equal(outcome.kind, 'claimed');
      // The previously-claimed expired job was reaped to failed / abandoned.
      const reaped = await adapter.jobs.get(A.id);
      assert.equal(reaped?.status, 'failed');
      assert.equal(reaped?.failureReason, 'abandoned');
    } finally {
      await adapter.close();
    }
  });
});
