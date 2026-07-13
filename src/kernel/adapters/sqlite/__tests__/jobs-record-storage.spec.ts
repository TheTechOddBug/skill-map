/**
 * Storage integration tests for the Step 10 Phase D record primitives
 * (`kernel/adapters/sqlite/jobs.ts` + `history.ts`): `recordJobTerminal`
 * (the atomic execution-insert + job-transition backing `sm record`) and
 * the `history.insertExecution` port primitive. Uses a real file-path
 * SQLite DB via `SqliteStorageAdapter` (never `:memory:`, which yields an
 * empty Kysely-side schema, see feedback_sqlite_in_memory_workaround).
 *
 * Covers:
 *   - recordJobTerminal writes the state_executions row AND flips the
 *     running job to completed, in ONE transaction (report inline in
 *     report_json, finishedAt stamped).
 *   - the failed / report-invalid transition path.
 *   - the running-only UPDATE guard leaves a non-running job untouched.
 *   - history.insertExecution appends a row visible through history.list.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strictEqual, ok } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import { SqliteStorageAdapter } from '../index.js';
import type { ExecutionRecord } from '../../../types.js';
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

const JOB_ID = 'd-20260101-000000-0001';

/** Submit one queued job and claim it so it is `running`. */
async function seedRunning(adapter: SqliteStorageAdapter): Promise<void> {
  const row: IJobSubmitRow = {
    id: JOB_ID,
    actionId: 'core/markdown-summarizer',
    actionVersion: '1.0.0',
    nodeId: 'a.md',
    contentHash: 'h'.repeat(64),
    nonce: 'n'.repeat(32),
    priority: 0,
    status: 'queued',
    ttlSeconds: 3600,
    createdAt: 1000,
  };
  await adapter.jobs.submit(row, { contentHash: row.contentHash, content: 'RENDERED', createdAt: row.createdAt });
  await adapter.jobs.claim('skill', 1500);
}

function buildExecution(overrides: Partial<ExecutionRecord>): ExecutionRecord {
  return {
    id: 'e-20260101-000000-0001',
    kind: 'action',
    extensionId: 'core/markdown-summarizer',
    extensionVersion: '1.0.0',
    nodeIds: ['a.md'],
    contentHash: 'h'.repeat(64),
    status: 'completed',
    failureReason: null,
    exitCode: null,
    runner: 'skill',
    startedAt: 1500,
    finishedAt: 2000,
    durationMs: 500,
    tokensIn: 10,
    tokensOut: 20,
    reportPath: null,
    jobId: JOB_ID,
    ...overrides,
  };
}

before(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'skill-map-job-record-'));
});

after(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe('recordJobTerminal', () => {
  it('writes the execution row AND transitions the running job to completed, atomically', async () => {
    const adapter = await openAdapter(freshDbPath('record-completed'));
    try {
      await seedRunning(adapter);
      const reportJson = JSON.stringify({
        whatItCovers: 'A guide.',
        confidence: 0.9,
        safety: { injectionDetected: false, contentQuality: 'clean' },
      });
      await adapter.jobs.recordTerminal(buildExecution({ reportPath: reportJson }));

      const job = await adapter.jobs.get(JOB_ID);
      ok(job);
      strictEqual(job.status, 'completed');
      strictEqual(job.finishedAt, 2000);

      const rows = await adapter.history.list({});
      strictEqual(rows.length, 1, 'one execution row written');
      strictEqual(rows[0]!.jobId, JOB_ID);
      strictEqual(rows[0]!.status, 'completed');
      strictEqual(rows[0]!.reportPath, reportJson, 'report stored inline in report_json');
    } finally {
      await adapter.close();
    }
  });

  it('transitions the job to failed / report-invalid', async () => {
    const adapter = await openAdapter(freshDbPath('record-failed'));
    try {
      await seedRunning(adapter);
      await adapter.jobs.recordTerminal(
        buildExecution({ status: 'failed', failureReason: 'report-invalid', reportPath: null }),
      );

      const job = await adapter.jobs.get(JOB_ID);
      ok(job);
      strictEqual(job.status, 'failed');
      strictEqual(job.failureReason, 'report-invalid');
      strictEqual(job.finishedAt, 2000);

      const rows = await adapter.history.list({});
      strictEqual(rows[0]!.failureReason, 'report-invalid');
    } finally {
      await adapter.close();
    }
  });

  it('leaves a non-running job untouched (running-only UPDATE guard)', async () => {
    const adapter = await openAdapter(freshDbPath('record-guard'));
    try {
      await seedRunning(adapter);
      // Drive it terminal out-of-band, then attempt a late record.
      await adapter.jobs.cancel(JOB_ID, 1800);
      await adapter.jobs.recordTerminal(buildExecution({}));

      const job = await adapter.jobs.get(JOB_ID);
      ok(job);
      strictEqual(job.status, 'cancelled', 'the cancelled job is not re-transitioned');
      strictEqual(job.finishedAt, 1800, 'finishedAt keeps the cancel timestamp');
    } finally {
      await adapter.close();
    }
  });
});

describe('history.insertExecution', () => {
  it('appends a row visible through history.list', async () => {
    const adapter = await openAdapter(freshDbPath('history-insert'));
    try {
      await adapter.history.insertExecution(buildExecution({ jobId: null, reportPath: '{"ok":true}' }));
      const rows = await adapter.history.list({});
      strictEqual(rows.length, 1);
      strictEqual(rows[0]!.id, 'e-20260101-000000-0001');
      strictEqual(rows[0]!.reportPath, '{"ok":true}');
    } finally {
      await adapter.close();
    }
  });
});
