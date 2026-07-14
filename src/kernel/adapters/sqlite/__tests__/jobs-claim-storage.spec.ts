/**
 * Storage integration tests for the Step 10 Phase C job primitives
 * (`kernel/adapters/sqlite/jobs.ts`): claimNext / cancelJob /
 * cancelAllActive / failJob / failAllActive / countJobsByStatus /
 * reapExpired. Uses a real file-path SQLite DB via `SqliteStorageAdapter`
 * (never `:memory:`, which yields an empty Kysely-side schema, see
 * feedback_sqlite_in_memory_workaround).
 *
 * Covers the lifecycle invariants the runner relies on:
 *   - claim picks the highest-priority, oldest queued job first, stamps
 *     running / runner / claimedAt / expiresAt, and returns id + nonce +
 *     contentHash.
 *   - the atomic-claim race guard: two claims against a single queued job
 *     yield exactly one winner (the other sees the row already running).
 *   - --filter scopes the claim to one action id; an empty queue is null.
 *   - cancel discriminates cancelled / already-terminal / not-found and
 *     writes the terminal `cancelled` state with NO failureReason;
 *     cancelAllActive counts active rows.
 *   - fail is the symmetric transition: writes `failed` / `user-failed`,
 *     same guard; failAllActive counts active rows.
 *   - countByStatus tallies every lifecycle bucket (including cancelled).
 *   - reapExpired fails only expired running rows (abandoned), returning
 *     their ids (the `run.reap.completed` event payload) and leaving
 *     live running and queued rows untouched.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strictEqual, ok } from 'node:assert';
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

/**
 * Submit one queued job. Callers vary `id` / `nodeId` / `contentHash` /
 * `extensionId` / `priority` / `createdAt` so the unique partial index over
 * active `(extension_id, node_id, content_hash)` never trips.
 */
async function submitQueued(
  adapter: SqliteStorageAdapter,
  overrides: Partial<IJobSubmitRow> & { id: string },
): Promise<void> {
  const row: IJobSubmitRow = {
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
  await adapter.jobs.submit(row, {
    contentHash: row.contentHash,
    content: `RENDERED ${row.id}`,
    createdAt: row.createdAt,
  });
}

before(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'skill-map-job-claim-'));
});

after(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe('claimNext', () => {
  it('claims the highest-priority, oldest queued job and stamps running', async () => {
    const adapter = await openAdapter(freshDbPath('claim-order'));
    try {
      const base = 1_700_000_000_000;
      // Low priority, oldest.
      await submitQueued(adapter, {
        id: 'd-20260101-000000-0001', nodeId: 'a.md', contentHash: '1'.repeat(64), priority: 0, createdAt: base,
      });
      // High priority, newer, should win (priority DESC beats createdAt).
      await submitQueued(adapter, {
        id: 'd-20260101-000000-0002', nodeId: 'b.md', contentHash: '2'.repeat(64), priority: 5, createdAt: base + 10,
      });
      // Same high priority, but even newer, so loses the createdAt tiebreak.
      await submitQueued(adapter, {
        id: 'd-20260101-000000-0003', nodeId: 'c.md', contentHash: '3'.repeat(64), priority: 5, createdAt: base + 20,
      });

      const now = base + 1000;
      const claim = await adapter.jobs.claim('agent', now);
      ok(claim);
      strictEqual(claim.id, 'd-20260101-000000-0002', 'highest priority, oldest within the bucket');
      strictEqual(claim.nonce, 'n'.repeat(32));
      strictEqual(claim.contentHash, '2'.repeat(64));

      const job = await adapter.jobs.get(claim.id);
      ok(job);
      strictEqual(job.status, 'running');
      strictEqual(job.runner, 'agent');
      strictEqual(job.claimedAt, now);
      strictEqual(job.expiresAt, now + 3600 * 1000, 'expiresAt = claimedAt + ttlSeconds * 1000');
    } finally {
      await adapter.close();
    }
  });

  it('returns null on an empty queue', async () => {
    const adapter = await openAdapter(freshDbPath('claim-empty'));
    try {
      strictEqual(await adapter.jobs.claim('agent', Date.now()), null);
    } finally {
      await adapter.close();
    }
  });

  it('lets exactly one of two racing claims win a single queued job', async () => {
    const adapter = await openAdapter(freshDbPath('claim-race'));
    try {
      await submitQueued(adapter, { id: 'd-20260101-000000-0001' });
      const now = Date.now();
      const [a, b] = await Promise.all([
        adapter.jobs.claim('agent', now),
        adapter.jobs.claim('agent', now),
      ]);
      const winners = [a, b].filter((r) => r !== null);
      strictEqual(winners.length, 1, 'the second AND status=queued guard rejects the loser');
      strictEqual(winners[0]!.id, 'd-20260101-000000-0001');
    } finally {
      await adapter.close();
    }
  });

  it('scopes the claim to --filter <action> and returns null when nothing matches', async () => {
    const adapter = await openAdapter(freshDbPath('claim-filter'));
    try {
      await submitQueued(adapter, {
        id: 'd-20260101-000000-0001', extensionId: 'core/skill-summarizer', nodeId: 'a.md', contentHash: '1'.repeat(64),
      });
      await submitQueued(adapter, {
        id: 'd-20260101-000000-0002', extensionId: 'core/other-action', nodeId: 'b.md', contentHash: '2'.repeat(64),
      });

      const scoped = await adapter.jobs.claim('agent', Date.now(), 'core/skill-summarizer');
      ok(scoped);
      strictEqual(scoped.id, 'd-20260101-000000-0001');

      // The remaining queued job carries a different action; a filter that
      // matches no queued row returns null even though the queue is non-empty.
      strictEqual(await adapter.jobs.claim('agent', Date.now(), 'core/no-such-action'), null);
    } finally {
      await adapter.close();
    }
  });

  it('accepts a BARE action id in --filter (same semantics as listJobs)', async () => {
    const adapter = await openAdapter(freshDbPath('claim-filter-bare'));
    try {
      await submitQueued(adapter, {
        id: 'd-20260101-000000-0001', extensionId: 'core/other-action', nodeId: 'a.md', contentHash: '1'.repeat(64),
      });
      await submitQueued(adapter, {
        id: 'd-20260101-000000-0002', extensionId: 'prob-summarizer/skill-echo', nodeId: 'b.md', contentHash: '2'.repeat(64),
      });

      // Bare id claims the qualified-id job (`extension_id LIKE '%/' || filter`).
      const bare = await adapter.jobs.claim('agent', Date.now(), 'skill-echo');
      ok(bare);
      strictEqual(bare.id, 'd-20260101-000000-0002');

      // A bare id must not match a mere substring of another action.
      strictEqual(await adapter.jobs.claim('agent', Date.now(), 'ther-action'), null);
    } finally {
      await adapter.close();
    }
  });
});

describe('cancelJob + cancelAllActive', () => {
  it('cancels a queued job to the terminal cancelled state (no failureReason)', async () => {
    const adapter = await openAdapter(freshDbPath('cancel-queued'));
    try {
      await submitQueued(adapter, { id: 'd-20260101-000000-0001' });
      const now = Date.now();
      strictEqual(await adapter.jobs.cancel('d-20260101-000000-0001', now), 'cancelled');
      const job = await adapter.jobs.get('d-20260101-000000-0001');
      ok(job);
      strictEqual(job.status, 'cancelled');
      strictEqual(job.failureReason ?? null, null);
      strictEqual(job.finishedAt, now);
    } finally {
      await adapter.close();
    }
  });

  it('cancels a running job to the terminal cancelled state', async () => {
    const adapter = await openAdapter(freshDbPath('cancel-running'));
    try {
      await submitQueued(adapter, { id: 'd-20260101-000000-0001' });
      await adapter.jobs.claim('agent', Date.now());
      strictEqual(await adapter.jobs.cancel('d-20260101-000000-0001', Date.now()), 'cancelled');
      const job = await adapter.jobs.get('d-20260101-000000-0001');
      ok(job);
      strictEqual(job.status, 'cancelled');
      strictEqual(job.failureReason ?? null, null);
    } finally {
      await adapter.close();
    }
  });

  it('refuses a terminal job (already-terminal) and reports not-found for a missing id', async () => {
    const adapter = await openAdapter(freshDbPath('cancel-terminal'));
    try {
      await submitQueued(adapter, { id: 'd-20260101-000000-0001' });
      await adapter.db
        .updateTable('state_jobs')
        .set({ status: 'completed', finishedAt: Date.now() })
        .where('id', '=', 'd-20260101-000000-0001')
        .execute();
      strictEqual(await adapter.jobs.cancel('d-20260101-000000-0001', Date.now()), 'already-terminal');
      strictEqual(await adapter.jobs.cancel('d-20990101-000000-ffff', Date.now()), 'not-found');
    } finally {
      await adapter.close();
    }
  });

  it('reports the LOST race as already-terminal (0-row guarded UPDATE, never a false success)', async () => {
    const adapter = await openAdapter(freshDbPath('cancel-race'));
    try {
      await submitQueued(adapter, { id: 'd-20260101-000000-0001' });
      // First transition wins the race (the semantic equivalent of another
      // writer terminalising the job between a read and the write)...
      strictEqual(await adapter.jobs.cancel('d-20260101-000000-0001', 1000), 'cancelled');
      // ...the loser's guarded UPDATE matches 0 rows and MUST report
      // already-terminal, not a second 'cancelled' (and never re-stamp).
      strictEqual(await adapter.jobs.cancel('d-20260101-000000-0001', 2000), 'already-terminal');
      // Cross-verb race: a fail losing to a cancel reports the same.
      strictEqual(await adapter.jobs.fail('d-20260101-000000-0001', 2000), 'already-terminal');
      const job = await adapter.jobs.get('d-20260101-000000-0001');
      ok(job);
      strictEqual(job.finishedAt, 1000, 'the winning transition timestamp is preserved');
      strictEqual(job.status, 'cancelled');
      strictEqual(job.failureReason ?? null, null, 'the losing fail never stamped user-failed');
    } finally {
      await adapter.close();
    }
  });

  it('cancelAllActive transitions every queued/running job to cancelled, leaving terminal rows alone', async () => {
    const adapter = await openAdapter(freshDbPath('cancel-all'));
    try {
      await submitQueued(adapter, { id: 'd-20260101-000000-0001', nodeId: 'a.md', contentHash: '1'.repeat(64) });
      await submitQueued(adapter, { id: 'd-20260101-000000-0002', nodeId: 'b.md', contentHash: '2'.repeat(64) });
      await submitQueued(adapter, { id: 'd-20260101-000000-0003', nodeId: 'c.md', contentHash: '3'.repeat(64) });
      // One of them is running (claimed); one is already terminal.
      await adapter.jobs.claim('agent', Date.now());
      await adapter.db
        .updateTable('state_jobs')
        .set({ status: 'completed', finishedAt: Date.now() })
        .where('id', '=', 'd-20260101-000000-0003')
        .execute();

      const count = await adapter.jobs.cancelAllActive(Date.now());
      strictEqual(count, 2, 'one queued + one running were active; the completed one is untouched');
      const counts = await adapter.jobs.countByStatus();
      strictEqual(counts.cancelled, 2);
      strictEqual(counts.completed, 1);
      strictEqual(counts.failed, 0);
      strictEqual(counts.queued, 0);
      strictEqual(counts.running, 0);
    } finally {
      await adapter.close();
    }
  });
});

describe('failJob + failAllActive', () => {
  it('fails a queued job to failed / user-failed', async () => {
    const adapter = await openAdapter(freshDbPath('fail-queued'));
    try {
      await submitQueued(adapter, { id: 'd-20260101-000000-0001' });
      const now = Date.now();
      strictEqual(await adapter.jobs.fail('d-20260101-000000-0001', now), 'failed');
      const job = await adapter.jobs.get('d-20260101-000000-0001');
      ok(job);
      strictEqual(job.status, 'failed');
      strictEqual(job.failureReason, 'user-failed');
      strictEqual(job.finishedAt, now);
    } finally {
      await adapter.close();
    }
  });

  it('fails a running job to failed / user-failed', async () => {
    const adapter = await openAdapter(freshDbPath('fail-running'));
    try {
      await submitQueued(adapter, { id: 'd-20260101-000000-0001' });
      await adapter.jobs.claim('agent', Date.now());
      strictEqual(await adapter.jobs.fail('d-20260101-000000-0001', Date.now()), 'failed');
      const job = await adapter.jobs.get('d-20260101-000000-0001');
      ok(job);
      strictEqual(job.status, 'failed');
      strictEqual(job.failureReason, 'user-failed');
    } finally {
      await adapter.close();
    }
  });

  it('refuses a terminal job (already-terminal) and reports not-found for a missing id', async () => {
    const adapter = await openAdapter(freshDbPath('fail-terminal'));
    try {
      await submitQueued(adapter, { id: 'd-20260101-000000-0001' });
      // Drive it terminal via cancel; a cancelled job is terminal too.
      await adapter.jobs.cancel('d-20260101-000000-0001', Date.now());
      strictEqual(await adapter.jobs.fail('d-20260101-000000-0001', Date.now()), 'already-terminal');
      strictEqual(await adapter.jobs.fail('d-20990101-000000-ffff', Date.now()), 'not-found');
    } finally {
      await adapter.close();
    }
  });

  it('failAllActive transitions every queued/running job to failed / user-failed, counting them', async () => {
    const adapter = await openAdapter(freshDbPath('fail-all'));
    try {
      await submitQueued(adapter, { id: 'd-20260101-000000-0001', nodeId: 'a.md', contentHash: '1'.repeat(64) });
      await submitQueued(adapter, { id: 'd-20260101-000000-0002', nodeId: 'b.md', contentHash: '2'.repeat(64) });
      await adapter.jobs.claim('agent', Date.now());

      const count = await adapter.jobs.failAllActive(Date.now());
      strictEqual(count, 2);
      const counts = await adapter.jobs.countByStatus();
      strictEqual(counts.failed, 2);
      strictEqual(counts.cancelled, 0);
      strictEqual(counts.queued, 0);
      strictEqual(counts.running, 0);
    } finally {
      await adapter.close();
    }
  });
});

describe('countJobsByStatus', () => {
  it('tallies every lifecycle bucket, present even when zero', async () => {
    const adapter = await openAdapter(freshDbPath('counts'));
    try {
      // Two queued, one of which gets claimed (running).
      await submitQueued(adapter, { id: 'd-20260101-000000-0001', nodeId: 'a.md', contentHash: '1'.repeat(64) });
      await submitQueued(adapter, { id: 'd-20260101-000000-0002', nodeId: 'b.md', contentHash: '2'.repeat(64) });
      await adapter.jobs.claim('agent', Date.now());

      const counts = await adapter.jobs.countByStatus();
      strictEqual(counts.queued, 1);
      strictEqual(counts.running, 1);
      strictEqual(counts.completed, 0);
      strictEqual(counts.failed, 0);
      strictEqual(counts.cancelled, 0);
    } finally {
      await adapter.close();
    }
  });
});

describe('reapExpired', () => {
  it('fails only expired running rows (abandoned), leaving live running + queued untouched', async () => {
    const adapter = await openAdapter(freshDbPath('reap'));
    try {
      // Expired running: claim, then push expiresAt into the past.
      await submitQueued(adapter, { id: 'd-20260101-000000-0001', nodeId: 'a.md', contentHash: '1'.repeat(64) });
      await adapter.jobs.claim('agent', Date.now());
      await adapter.db
        .updateTable('state_jobs')
        .set({ expiresAt: 1000 })
        .where('id', '=', 'd-20260101-000000-0001')
        .execute();

      // Live running: claim with a fresh (far-future) expiresAt.
      await submitQueued(adapter, { id: 'd-20260101-000000-0002', nodeId: 'b.md', contentHash: '2'.repeat(64) });
      await adapter.jobs.claim('agent', Date.now());

      // Queued (never claimed).
      await submitQueued(adapter, { id: 'd-20260101-000000-0003', nodeId: 'c.md', contentHash: '3'.repeat(64) });

      const now = Date.now();
      const reaped = await adapter.jobs.reapExpired(now);
      strictEqual(reaped.length, 1, 'only the expired running row is reaped');
      strictEqual(reaped[0], 'd-20260101-000000-0001', 'the reaped id is returned');

      const expired = await adapter.jobs.get('d-20260101-000000-0001');
      ok(expired);
      strictEqual(expired.status, 'failed');
      strictEqual(expired.failureReason, 'abandoned');
      strictEqual(expired.finishedAt, now);

      const live = await adapter.jobs.get('d-20260101-000000-0002');
      ok(live);
      strictEqual(live.status, 'running', 'live running row is untouched');

      const queued = await adapter.jobs.get('d-20260101-000000-0003');
      ok(queued);
      strictEqual(queued.status, 'queued', 'queued row is untouched');
    } finally {
      await adapter.close();
    }
  });

  it('a TTL-less running job is NEVER reaped, even with claimedAt far in the past', async () => {
    const adapter = await openAdapter(freshDbPath('reap-ttl-less'));
    try {
      await submitQueued(adapter, {
        id: 'd-20260101-000000-0001',
        nodeId: 'a.md',
        contentHash: '1'.repeat(64),
        ttlSeconds: null,
      });
      // Claimed a long time ago: with no TTL, expiresAt stays NULL and
      // the reaper skips the row (spec §Reap procedure: only TTL-armed
      // rows are reapable).
      await adapter.jobs.claim('agent', 1000);
      const claimed = await adapter.jobs.get('d-20260101-000000-0001');
      ok(claimed);
      strictEqual(claimed.ttlSeconds, null);
      strictEqual(claimed.expiresAt, null, 'expiresAt stays NULL at claim time');

      const reaped = await adapter.jobs.reapExpired(Date.now());
      strictEqual(reaped.length, 0, 'nothing reaped');
      strictEqual((await adapter.jobs.get('d-20260101-000000-0001'))!.status, 'running');
    } finally {
      await adapter.close();
    }
  });

  it('a TTL-armed job still reaps exactly as before', async () => {
    const adapter = await openAdapter(freshDbPath('reap-armed'));
    try {
      await submitQueued(adapter, {
        id: 'd-20260101-000000-0001',
        nodeId: 'a.md',
        contentHash: '1'.repeat(64),
        ttlSeconds: 10,
      });
      await adapter.jobs.claim('agent', 1000);
      const claimed = await adapter.jobs.get('d-20260101-000000-0001');
      strictEqual(claimed!.expiresAt, 1000 + 10 * 1000, 'armed: expiresAt = claimedAt + ttl');

      const reaped = await adapter.jobs.reapExpired(Date.now());
      strictEqual(reaped.length, 1);
      strictEqual((await adapter.jobs.get('d-20260101-000000-0001'))!.failureReason, 'abandoned');
    } finally {
      await adapter.close();
    }
  });
});
