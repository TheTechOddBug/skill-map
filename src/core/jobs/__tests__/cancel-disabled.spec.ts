/**
 * Unit tests for `cancelQueuedJobsForKeys`, the shared DB leg of the
 * disable cascade (`spec/job-lifecycle.md` §Cancellation, user decision
 * 2026-07-21): disabling an extension cancels its `queued` jobs through
 * the same primitive as `sm jobs cancel`. Real file-backed SQLite
 * (never `:memory:`, see feedback_sqlite_in_memory_workaround).
 *
 * Matching contract: qualified keys match a job's `extension_id`
 * exactly; a bare plugin key matches every extension of that plugin by
 * `<plugin>/` prefix. `running` jobs are never touched.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deepStrictEqual, strictEqual } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import { cancelQueuedJobsForKeys } from '../cancel-disabled.js';
import { SqliteStorageAdapter } from '../../../kernel/adapters/sqlite/index.js';
import type { IJobSubmitRow } from '../../../kernel/types/storage.js';

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
 * Submit one queued job. Callers vary the identity fields so the unique
 * partial index over active `(extension_id, node_id, content_hash)`
 * never trips.
 */
async function submitQueued(
  adapter: SqliteStorageAdapter,
  overrides: Partial<IJobSubmitRow> & { id: string; extensionId: string },
): Promise<void> {
  const row: IJobSubmitRow = {
    extensionVersion: '1.0.0',
    extensionKind: 'action',
    nodeId: `${overrides.id}.md`,
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

async function statusOf(adapter: SqliteStorageAdapter, id: string): Promise<string> {
  const job = await adapter.jobs.get(id);
  if (!job) throw new Error(`job ${id} missing`);
  return job.status;
}

before(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'skill-map-cancel-disabled-'));
});

after(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe('cancelQueuedJobsForKeys', () => {
  it('cancels queued jobs matching a qualified key and leaves the rest untouched', async () => {
    const adapter = await openAdapter(freshDbPath('qualified'));
    try {
      await submitQueued(adapter, { id: 'j1', extensionId: 'core/ai-tagger-action' });
      await submitQueued(adapter, { id: 'j2', extensionId: 'core/ai-tagger-action' });
      await submitQueued(adapter, { id: 'j3', extensionId: 'core/ai-summarizer-action' });

      const cancelled = await cancelQueuedJobsForKeys(
        adapter,
        ['core/ai-tagger-action'],
        Date.now(),
      );

      deepStrictEqual(cancelled.sort(), ['j1', 'j2']);
      strictEqual(await statusOf(adapter, 'j1'), 'cancelled');
      strictEqual(await statusOf(adapter, 'j2'), 'cancelled');
      strictEqual(await statusOf(adapter, 'j3'), 'queued', 'other extensions stay queued');
    } finally {
      await adapter.close();
    }
  });

  it('a bare plugin key cancels every extension of that plugin by prefix', async () => {
    const adapter = await openAdapter(freshDbPath('bare'));
    try {
      await submitQueued(adapter, { id: 'j1', extensionId: 'core/ai-tagger-action' });
      await submitQueued(adapter, { id: 'j2', extensionId: 'core/ai-summarizer-action' });
      await submitQueued(adapter, { id: 'j3', extensionId: 'my-plugin/finder' });

      const cancelled = await cancelQueuedJobsForKeys(adapter, ['core'], Date.now());

      deepStrictEqual(cancelled.sort(), ['j1', 'j2']);
      strictEqual(await statusOf(adapter, 'j3'), 'queued');
    } finally {
      await adapter.close();
    }
  });

  it('never touches a running job (the agent already claimed the work)', async () => {
    const adapter = await openAdapter(freshDbPath('running'));
    try {
      await submitQueued(adapter, { id: 'j1', extensionId: 'core/ai-tagger-action' });
      const claim = await adapter.jobs.claim('agent', Date.now());
      strictEqual(claim?.id, 'j1', 'claim picks the only queued job');

      const cancelled = await cancelQueuedJobsForKeys(
        adapter,
        ['core/ai-tagger-action'],
        Date.now(),
      );

      deepStrictEqual(cancelled, []);
      strictEqual(await statusOf(adapter, 'j1'), 'running');
    } finally {
      await adapter.close();
    }
  });

  it('is a clean no-op on an empty key set and on a queue with no matches', async () => {
    const adapter = await openAdapter(freshDbPath('noop'));
    try {
      await submitQueued(adapter, { id: 'j1', extensionId: 'core/ai-tagger-action' });
      deepStrictEqual(await cancelQueuedJobsForKeys(adapter, [], Date.now()), []);
      deepStrictEqual(
        await cancelQueuedJobsForKeys(adapter, ['other/finder'], Date.now()),
        [],
      );
      strictEqual(await statusOf(adapter, 'j1'), 'queued');
    } finally {
      await adapter.close();
    }
  });

  it('a prefix key never matches an extension of a longer plugin id', async () => {
    // `core` must not match `core-markdown/foo`: the prefix carries the
    // trailing slash.
    const adapter = await openAdapter(freshDbPath('prefix'));
    try {
      await submitQueued(adapter, { id: 'j1', extensionId: 'core-markdown/extractor' });
      deepStrictEqual(await cancelQueuedJobsForKeys(adapter, ['core'], Date.now()), []);
      strictEqual(await statusOf(adapter, 'j1'), 'queued');
    } finally {
      await adapter.close();
    }
  });
});
