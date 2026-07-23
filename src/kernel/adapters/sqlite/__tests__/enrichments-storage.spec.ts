/**
 * Storage integration tests for the `state_enrichments` write-through
 * (`kernel/adapters/sqlite/enrichments.ts` + the port surfaces on
 * `SqliteStorageAdapter`). Uses a real file-path SQLite DB via
 * `SqliteStorageAdapter` (never `:memory:`, which yields an empty
 * Kysely-side schema, see feedback_sqlite_in_memory_workaround).
 *
 * Covers:
 *   - upsertStateEnrichment REPLACES (not duplicates) on a second write
 *     for the same (node_id, provider_id); verified round-trips 0/1/NULL.
 *   - listStateEnrichmentsForNode orders by provider_id and parses data.
 *   - listStaleStateEnrichments (the `--stale` candidate set): body-hash
 *     drift picks the row up; a matching hash keeps it out; a passed
 *     stale_after picks it up; a vanished node drops out entirely.
 *   - the transactional pair: `tx.enrichments.upsertState` +
 *     `tx.history.insertExecution` commit together through
 *     `port.transaction`.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strictEqual, deepStrictEqual } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import { SqliteStorageAdapter } from '../index.js';
import {
  listStaleStateEnrichments,
  listStateEnrichmentsForNode,
  upsertStateEnrichment,
} from '../enrichments.js';
import type { ExecutionRecord } from '../../../types.js';
import type { IStateEnrichmentUpsert } from '../../../types/storage.js';

let tempRoot: string;
let counter = 0;

const NODE_PATH = 'agents/architect.md';
const BODY_HASH = 'b'.repeat(64);
const PROVIDER_ID = 'github/enrichment';

function report(localBodyHash: string): Record<string, unknown> {
  return {
    verified: true,
    sourceUrl: 'https://raw.githubusercontent.com/o/r/deadbeef/agents/architect.md',
    method: 'raw-sha',
    resolvedSha: null,
    localBodyHash,
    remoteBodyHash: localBodyHash,
  };
}

function upsertRow(overrides: Partial<IStateEnrichmentUpsert> = {}): IStateEnrichmentUpsert {
  return {
    nodeId: NODE_PATH,
    providerId: PROVIDER_ID,
    dataJson: JSON.stringify(report(BODY_HASH)),
    verified: true,
    fetchedAt: 1000,
    staleAfter: null,
    ...overrides,
  };
}

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
  opts: { path: string; bodyHash: string },
): Promise<void> {
  await adapter.db
    .insertInto('scan_nodes')
    .values({
      path: opts.path,
      kind: 'markdown',
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

before(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'skill-map-state-enrichments-'));
});

after(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe('upsertStateEnrichment + listStateEnrichmentsForNode', () => {
  it('a second write for the same (node, provider) REPLACES, not duplicates', async () => {
    const adapter = await openAdapter(freshDbPath('upsert'));
    try {
      await upsertStateEnrichment(adapter.db, upsertRow());
      await upsertStateEnrichment(
        adapter.db,
        upsertRow({
          dataJson: JSON.stringify({ ...report('c'.repeat(64)), verified: false }),
          verified: false,
          fetchedAt: 2000,
        }),
      );

      const rows = await listStateEnrichmentsForNode(adapter.db, NODE_PATH);
      strictEqual(rows.length, 1, 'one row after the conflict, not two');
      strictEqual(rows[0]!.verified, false, 'verified replaced in place');
      strictEqual(rows[0]!.fetchedAt, 2000, 'fetchedAt refreshed');
      strictEqual(rows[0]!.data['localBodyHash'], 'c'.repeat(64), 'data_json replaced in place');
    } finally {
      await adapter.close();
    }
  });

  it('verified round-trips its tri-state (true / false / null) and rows order by providerId', async () => {
    const adapter = await openAdapter(freshDbPath('tri-state'));
    try {
      await upsertStateEnrichment(adapter.db, upsertRow({ providerId: 'zzz/later', verified: null }));
      await upsertStateEnrichment(adapter.db, upsertRow({ providerId: 'aaa/first', verified: true }));

      const rows = await adapter.enrichments.listStateForNode(NODE_PATH);
      deepStrictEqual(
        rows.map((r) => [r.providerId, r.verified]),
        [
          ['aaa/first', true],
          ['zzz/later', null],
        ],
      );
    } finally {
      await adapter.close();
    }
  });
});

describe('listStaleStateEnrichments (the --stale candidate set)', () => {
  it('a body-hash drift makes the row a candidate; a matching hash keeps it out', async () => {
    const adapter = await openAdapter(freshDbPath('drift'));
    try {
      await insertNode(adapter, { path: NODE_PATH, bodyHash: BODY_HASH });
      await insertNode(adapter, { path: 'agents/other.md', bodyHash: BODY_HASH });
      // Fresh row: recorded localBodyHash matches the live body hash.
      await upsertStateEnrichment(adapter.db, upsertRow());
      // Drifted row: recorded against an older body.
      await upsertStateEnrichment(
        adapter.db,
        upsertRow({
          nodeId: 'agents/other.md',
          dataJson: JSON.stringify(report('0'.repeat(64))),
        }),
      );

      const candidates = await listStaleStateEnrichments(adapter.db, Date.now());
      deepStrictEqual(
        candidates.map((c) => c.nodeId),
        ['agents/other.md'],
        'only the drifted row is a candidate',
      );
    } finally {
      await adapter.close();
    }
  });

  it('a passed stale_after makes even a hash-matching row a candidate', async () => {
    const adapter = await openAdapter(freshDbPath('expiry'));
    try {
      await insertNode(adapter, { path: NODE_PATH, bodyHash: BODY_HASH });
      await upsertStateEnrichment(adapter.db, upsertRow({ staleAfter: 5000 }));

      strictEqual((await adapter.enrichments.listStaleStateCandidates(4999)).length, 0);
      strictEqual((await adapter.enrichments.listStaleStateCandidates(5000)).length, 1);
    } finally {
      await adapter.close();
    }
  });

  it('a row whose node vanished from the scan is not a candidate (nothing to refresh)', async () => {
    const adapter = await openAdapter(freshDbPath('vanished'));
    try {
      // No scan_nodes row at all: the state row exists but the node is gone.
      await upsertStateEnrichment(
        adapter.db,
        upsertRow({ dataJson: JSON.stringify(report('0'.repeat(64))) }),
      );
      strictEqual((await adapter.enrichments.listStaleStateCandidates(Date.now())).length, 0);
    } finally {
      await adapter.close();
    }
  });
});

describe('transactional pair: upsertState + insertExecution', () => {
  it('the state row and its execution sibling commit together', async () => {
    const adapter = await openAdapter(freshDbPath('tx-pair'));
    try {
      await insertNode(adapter, { path: NODE_PATH, bodyHash: BODY_HASH });
      const execution: ExecutionRecord = {
        id: 'e-20260101-000000-0001',
        kind: 'action',
        extensionId: PROVIDER_ID,
        extensionVersion: '1.0.0',
        nodeIds: [NODE_PATH],
        contentHash: null,
        status: 'completed',
        failureReason: null,
        exitCode: null,
        runner: 'in-process',
        startedAt: 1000,
        finishedAt: 1500,
        durationMs: 500,
        tokensIn: null,
        tokensOut: null,
        reportPath: JSON.stringify(report(BODY_HASH)),
        jobId: null,
      };
      await adapter.transaction(async (txStore) => {
        await txStore.enrichments.upsertState(upsertRow());
        await txStore.history.insertExecution(execution);
      });

      strictEqual((await adapter.enrichments.listStateForNode(NODE_PATH)).length, 1);
      const executions = await adapter.history.list({});
      strictEqual(executions.length, 1);
      strictEqual(executions[0]!.runner, 'in-process');
      strictEqual(executions[0]!.extensionId, PROVIDER_ID);
    } finally {
      await adapter.close();
    }
  });
});
