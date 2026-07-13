/**
 * Storage integration tests for the `state_summaries` write-through
 * (`kernel/adapters/sqlite/summaries.ts` + the `recordJobTerminal`
 * summary fold in `jobs.ts`). Uses a real file-path SQLite DB via
 * `SqliteStorageAdapter` (never `:memory:`, which yields an empty
 * Kysely-side schema, see feedback_sqlite_in_memory_workaround).
 *
 * Covers:
 *   - upsertSummary REPLACES (not duplicates) on a second write for the
 *     same (node_id, summarizer_action_id).
 *   - upsertSummaryForNode reads the node's live kind + body_hash and
 *     skips (returns false) when the node is absent.
 *   - recordJobTerminal folds the summary upsert into the record tx when a
 *     summary intent is supplied AND the node exists; the row carries the
 *     right keys + serialized report + body_hash_at_generation.
 *   - recordJobTerminal writes NO summary row when no intent is supplied
 *     (a non-summarizer action).
 *   - recordJobTerminal against a node deleted from the scan skips the
 *     summary but still writes the execution + transitions the job.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strictEqual, ok } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import { SqliteStorageAdapter } from '../index.js';
import {
  listSummariesForNode,
  upsertSummary,
  upsertSummaryForNode,
} from '../summaries.js';
import type { ExecutionRecord } from '../../../types.js';
import type { IJobSubmitRow, ISummaryWriteIntent } from '../../../types/storage.js';

let tempRoot: string;
let counter = 0;

const NODE_PATH = 'notes/guide.md';
const BODY_HASH = 'b'.repeat(64);
const ACTION_ID = 'core/markdown-summarizer';
const JOB_ID = 'd-20260101-000000-0001';

const REPORT = {
  whatItCovers: 'A short guide to the thing.',
  confidence: 0.9,
  safety: { injectionDetected: false, contentQuality: 'clean' },
};

function freshDbPath(label: string): string {
  counter += 1;
  return join(tempRoot, `${label}-${counter}.db`);
}

async function openAdapter(dbPath: string): Promise<SqliteStorageAdapter> {
  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  return adapter;
}

async function insertNode(
  adapter: SqliteStorageAdapter,
  opts: { path: string; kind: string; bodyHash: string },
): Promise<void> {
  await adapter.db
    .insertInto('scan_nodes')
    .values({
      path: opts.path,
      kind: opts.kind,
      provider: 'markdown',
      title: null,
      description: null,
      stability: null,
      version: null,
      sidecarStatus: null,
      annotationsJson: null,
      sidecarRootJson: null,
      frontmatterJson: '{}',
      bodyHash: opts.bodyHash,
      frontmatterHash: 'f'.repeat(64),
      bytesFrontmatter: 0,
      bytesBody: 8,
      bytesTotal: 8,
      tokensFrontmatter: null,
      tokensBody: null,
      tokensTotal: null,
      externalRefsJson: null,
      scannedAt: Date.now(),
      modifiedAtMs: null,
      virtual: 0,
      derivedFromJson: null,
    })
    .execute();
}

/** Submit one queued job for NODE_PATH and claim it so it is `running`. */
async function seedRunning(adapter: SqliteStorageAdapter): Promise<void> {
  const row: IJobSubmitRow = {
    id: JOB_ID,
    actionId: ACTION_ID,
    actionVersion: '1.0.0',
    nodeId: NODE_PATH,
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
    extensionId: ACTION_ID,
    extensionVersion: '1.0.0',
    nodeIds: [NODE_PATH],
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
    reportPath: JSON.stringify(REPORT),
    jobId: JOB_ID,
    ...overrides,
  };
}

function summaryIntent(): ISummaryWriteIntent {
  return {
    summarizerActionId: ACTION_ID,
    summarizerVersion: '1.0.0',
    generatedAt: 2000,
    summaryJson: JSON.stringify(REPORT),
  };
}

before(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'skill-map-summaries-'));
});

after(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe('upsertSummary + listSummariesForNode', () => {
  it('a second write for the same (node, action) REPLACES, not duplicates', async () => {
    const adapter = await openAdapter(freshDbPath('upsert'));
    try {
      const base = {
        nodeId: NODE_PATH,
        kind: 'markdown',
        summarizerActionId: ACTION_ID,
        summarizerVersion: '1.0.0',
        bodyHashAtGeneration: BODY_HASH,
        generatedAt: 1000,
        summaryJson: JSON.stringify({ whatItCovers: 'first' }),
      };
      await upsertSummary(adapter.db, base);
      await upsertSummary(adapter.db, {
        ...base,
        bodyHashAtGeneration: 'c'.repeat(64),
        generatedAt: 2000,
        summaryJson: JSON.stringify({ whatItCovers: 'second' }),
      });

      const rows = await listSummariesForNode(adapter.db, NODE_PATH);
      strictEqual(rows.length, 1, 'one row after the conflict, not two');
      strictEqual(rows[0]!.bodyHashAtGeneration, 'c'.repeat(64), 'body hash refreshed');
      strictEqual(rows[0]!.generatedAt, 2000, 'generatedAt refreshed');
      strictEqual(rows[0]!.report['whatItCovers'], 'second', 'summary_json replaced in place');
    } finally {
      await adapter.close();
    }
  });
});

describe('upsertSummaryForNode', () => {
  it('reads the node kind + body_hash and upserts when the node exists', async () => {
    const adapter = await openAdapter(freshDbPath('for-node'));
    try {
      await insertNode(adapter, { path: NODE_PATH, kind: 'markdown', bodyHash: BODY_HASH });
      const wrote = await upsertSummaryForNode(adapter.db, NODE_PATH, summaryIntent());
      strictEqual(wrote, true);

      const rows = await listSummariesForNode(adapter.db, NODE_PATH);
      strictEqual(rows.length, 1);
      strictEqual(rows[0]!.kind, 'markdown', 'kind read from scan_nodes');
      strictEqual(rows[0]!.bodyHashAtGeneration, BODY_HASH, 'body_hash read from scan_nodes');
    } finally {
      await adapter.close();
    }
  });

  it('skips (returns false) when the node is absent', async () => {
    const adapter = await openAdapter(freshDbPath('for-node-absent'));
    try {
      const wrote = await upsertSummaryForNode(adapter.db, 'gone.md', summaryIntent());
      strictEqual(wrote, false);
      const rows = await listSummariesForNode(adapter.db, 'gone.md');
      strictEqual(rows.length, 0);
    } finally {
      await adapter.close();
    }
  });
});

describe('recordJobTerminal summary write-through', () => {
  it('upserts a state_summaries row (right keys + report) when a summary intent + live node are present', async () => {
    const adapter = await openAdapter(freshDbPath('record-summary'));
    try {
      await insertNode(adapter, { path: NODE_PATH, kind: 'markdown', bodyHash: BODY_HASH });
      await seedRunning(adapter);
      await adapter.jobs.recordTerminal(buildExecution({}), summaryIntent());

      const job = await adapter.jobs.get(JOB_ID);
      strictEqual(job!.status, 'completed');

      const rows = await adapter.summaries.forNode(NODE_PATH);
      strictEqual(rows.length, 1);
      const s = rows[0]!;
      strictEqual(s.nodeId, NODE_PATH);
      strictEqual(s.kind, 'markdown');
      strictEqual(s.summarizerActionId, ACTION_ID);
      strictEqual(s.summarizerVersion, '1.0.0');
      strictEqual(s.bodyHashAtGeneration, BODY_HASH);
      strictEqual(s.report['whatItCovers'], REPORT.whatItCovers);
    } finally {
      await adapter.close();
    }
  });

  it('writes NO summary row when no summary intent is supplied (non-summarizer action)', async () => {
    const adapter = await openAdapter(freshDbPath('record-no-summary'));
    try {
      await insertNode(adapter, { path: NODE_PATH, kind: 'markdown', bodyHash: BODY_HASH });
      await seedRunning(adapter);
      await adapter.jobs.recordTerminal(buildExecution({}));

      strictEqual((await adapter.jobs.get(JOB_ID))!.status, 'completed');
      strictEqual((await adapter.history.list({})).length, 1, 'execution still written');
      strictEqual((await adapter.summaries.forNode(NODE_PATH)).length, 0, 'no summary row');
    } finally {
      await adapter.close();
    }
  });

  it('skips the summary but still writes the execution when the node was deleted from the scan', async () => {
    const adapter = await openAdapter(freshDbPath('record-deleted-node'));
    try {
      // No scan_nodes row for NODE_PATH: the node was deleted / renamed
      // between submit and record.
      await seedRunning(adapter);
      await adapter.jobs.recordTerminal(buildExecution({}), summaryIntent());

      const job = await adapter.jobs.get(JOB_ID);
      strictEqual(job!.status, 'completed', 'job still transitions');
      const execs = await adapter.history.list({});
      strictEqual(execs.length, 1, 'execution record still lands');
      strictEqual(execs[0]!.jobId, JOB_ID);
      strictEqual((await adapter.summaries.forNode(NODE_PATH)).length, 0, 'summary skipped');
    } finally {
      await adapter.close();
    }
  });
});
