/**
 * Storage integration tests for the `state_findings` write-through
 * (`kernel/adapters/sqlite/findings.ts` + the fold inside
 * `recordJobTerminal` in `jobs.ts`). Uses a real file-path SQLite DB via
 * `SqliteStorageAdapter` (never `:memory:`, which yields an empty
 * Kysely-side schema, see feedback_sqlite_in_memory_workaround).
 *
 * Covers (spec/db-schema.md §state_findings):
 *   - replaceFindingsForNode REPLACES the (node, extension) pair, BOTH
 *     origins; other extensions' rows survive.
 *   - an empty row set is a clean verdict: pure erase, not a no-op.
 *   - writeFindingsForNode stamps the node's live body_hash and skips
 *     (returns false, previous rows kept) when the node is absent.
 *   - the stale JOIN: body-hash drift AND node-gone both count as stale;
 *     default read excludes stale, includeStale returns them flagged.
 *   - listFindings filters: nodeId, extensionIds (qualified + bare),
 *     type, minSeverity, sinceMs, minConfidence.
 *   - recordJobTerminal folds the findings replace into the record tx
 *     (same-transaction atomicity: a lost record race rolls everything
 *     back, previous rows survive).
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strictEqual, deepStrictEqual, ok, rejects } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import { SqliteStorageAdapter } from '../index.js';
import {
  listFindings,
  replaceFindingsForNode,
  writeFindingsForNode,
  type IFindingInsertRow,
} from '../findings.js';
import { recordJobTerminal } from '../jobs.js';
import { JobNotRunningError } from '../../../jobs/errors.js';
import type { ExecutionRecord } from '../../../types.js';
import type { IFindingsWriteIntent, IJobSubmitRow } from '../../../types/storage.js';

let tempRoot: string;
let counter = 0;

const NODE_PATH = 'notes/guide.md';
const BODY_HASH = 'b'.repeat(64);
const FINDER_ID = 'plug/quality-check';
const JOB_ID = 'd-20260101-000000-0001';

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

function insertRow(overrides: Partial<IFindingInsertRow> = {}): IFindingInsertRow {
  return {
    origin: 'extension',
    type: 'contradiction',
    severity: 'warn',
    message: 'A contradicts B',
    detail: null,
    confidence: 0.8,
    extensionVersion: '1.0.0',
    model: null,
    bodyHashAtGeneration: BODY_HASH,
    generatedAt: 1000,
    jobId: JOB_ID,
    ...overrides,
  };
}

function intent(
  rows: IFindingsWriteIntent['rows'],
  extensionId: string = FINDER_ID,
): IFindingsWriteIntent {
  return {
    extensionId,
    extensionVersion: '1.0.0',
    generatedAt: 2000,
    jobId: JOB_ID,
    model: null,
    rows,
  };
}

/** Submit one queued job for NODE_PATH and claim it so it is `running`. */
async function seedRunning(adapter: SqliteStorageAdapter): Promise<void> {
  const row: IJobSubmitRow = {
    id: JOB_ID,
    extensionId: FINDER_ID,
    extensionVersion: '1.0.0',
    extensionKind: 'analyzer',
    nodeId: NODE_PATH,
    contentHash: 'h'.repeat(64),
    nonce: 'n'.repeat(32),
    priority: 0,
    status: 'queued',
    ttlSeconds: 3600,
    createdAt: 1000,
  };
  await adapter.jobs.submit(row, {
    contentHash: row.contentHash,
    content: 'RENDERED',
    createdAt: row.createdAt,
  });
  await adapter.jobs.claim('agent', 1500);
}

function buildExecution(overrides: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
    id: 'e-20260101-000000-0001',
    kind: 'action',
    extensionId: FINDER_ID,
    extensionVersion: '1.0.0',
    nodeIds: [NODE_PATH],
    contentHash: 'h'.repeat(64),
    status: 'completed',
    failureReason: null,
    exitCode: null,
    runner: 'agent',
    startedAt: 1500,
    finishedAt: 2000,
    durationMs: 500,
    tokensIn: 10,
    tokensOut: 20,
    reportPath: '{}',
    jobId: JOB_ID,
    ...overrides,
  };
}

before(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'skill-map-findings-'));
});

after(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe('replaceFindingsForNode (replace semantics)', () => {
  it('deletes the pair BOTH origins, keeps other extensions, inserts fresh rows', async () => {
    const adapter = await openAdapter(freshDbPath('replace'));
    try {
      await insertNode(adapter, { path: NODE_PATH, bodyHash: BODY_HASH });
      // Prior judgment: one finder row + one kernel safety row for the
      // pair, plus a row from ANOTHER extension that must survive.
      await replaceFindingsForNode(adapter.db, NODE_PATH, FINDER_ID, [
        insertRow(),
        insertRow({ origin: 'kernel', type: 'injection-detected', message: 'flagged' }),
      ]);
      await replaceFindingsForNode(adapter.db, NODE_PATH, 'other/finder', [
        insertRow({ type: 'redundancy', message: 'other extension row' }),
      ]);

      await replaceFindingsForNode(adapter.db, NODE_PATH, FINDER_ID, [
        insertRow({ type: 'incoherence', message: 'fresh verdict', generatedAt: 2000 }),
      ]);

      const rows = await listFindings(adapter.db, { nodeId: NODE_PATH });
      deepStrictEqual(
        rows.map((r) => [r.extensionId, r.type]).sort(),
        [
          ['other/finder', 'redundancy'],
          [FINDER_ID, 'incoherence'],
        ].sort(),
        'pair replaced (both origins gone), other extension untouched',
      );
    } finally {
      await adapter.close();
    }
  });

  it('an empty row set ERASES the pair (clean verdict, not a no-op)', async () => {
    const adapter = await openAdapter(freshDbPath('erase'));
    try {
      await insertNode(adapter, { path: NODE_PATH, bodyHash: BODY_HASH });
      await replaceFindingsForNode(adapter.db, NODE_PATH, FINDER_ID, [
        insertRow(),
        insertRow({ origin: 'kernel', type: 'content-suspicious', severity: 'info', message: 's' }),
      ]);
      await replaceFindingsForNode(adapter.db, NODE_PATH, FINDER_ID, []);
      strictEqual((await listFindings(adapter.db, { nodeId: NODE_PATH })).length, 0);
    } finally {
      await adapter.close();
    }
  });
});

describe('writeFindingsForNode (record-path write)', () => {
  it('stamps the live body_hash + intent metadata onto every row', async () => {
    const adapter = await openAdapter(freshDbPath('write'));
    try {
      await insertNode(adapter, { path: NODE_PATH, bodyHash: BODY_HASH });
      const wrote = await writeFindingsForNode(
        adapter.db,
        NODE_PATH,
        intent([
          {
            origin: 'extension',
            type: 'contradiction',
            severity: 'warn',
            message: 'A contradicts B',
            detail: 'evidence',
            confidence: 0.7,
          },
        ]),
      );
      strictEqual(wrote, true);
      const rows = await listFindings(adapter.db, { nodeId: NODE_PATH });
      strictEqual(rows.length, 1);
      const row = rows[0]!;
      strictEqual(row.bodyHashAtGeneration, BODY_HASH, 'live scan_nodes.body_hash stamped');
      strictEqual(row.extensionVersion, '1.0.0');
      strictEqual(row.generatedAt, 2000);
      strictEqual(row.jobId, JOB_ID);
      strictEqual(row.stale, false);
    } finally {
      await adapter.close();
    }
  });

  it('skips entirely (returns false, previous rows kept) when the node is gone', async () => {
    const adapter = await openAdapter(freshDbPath('write-gone'));
    try {
      await insertNode(adapter, { path: NODE_PATH, bodyHash: BODY_HASH });
      await replaceFindingsForNode(adapter.db, NODE_PATH, FINDER_ID, [insertRow()]);
      // The node disappears (deleted / renamed since submit).
      await adapter.db.deleteFrom('scan_nodes').where('path', '=', NODE_PATH).execute();

      const wrote = await writeFindingsForNode(adapter.db, NODE_PATH, intent([]));
      strictEqual(wrote, false);
      // Previous rows kept: visible under includeStale (node-gone = stale).
      const rows = await listFindings(adapter.db, { nodeId: NODE_PATH, includeStale: true });
      strictEqual(rows.length, 1, 'previous judgment preserved');
      strictEqual(rows[0]!.stale, true);
    } finally {
      await adapter.close();
    }
  });
});

describe('listFindings (stale JOIN + filters)', () => {
  it('body-hash drift marks stale; default read excludes, includeStale flags', async () => {
    const adapter = await openAdapter(freshDbPath('stale'));
    try {
      await insertNode(adapter, { path: NODE_PATH, bodyHash: BODY_HASH });
      await replaceFindingsForNode(adapter.db, NODE_PATH, FINDER_ID, [insertRow()]);
      // Simulate an edit + rescan: the live hash drifts.
      await adapter.db
        .updateTable('scan_nodes')
        .set({ bodyHash: 'e'.repeat(64) })
        .where('path', '=', NODE_PATH)
        .execute();

      strictEqual((await listFindings(adapter.db, {})).length, 0, 'default read excludes stale');
      const rows = await listFindings(adapter.db, { includeStale: true });
      strictEqual(rows.length, 1);
      strictEqual(rows[0]!.stale, true);
    } finally {
      await adapter.close();
    }
  });

  it('rows for nodes no longer in scan_nodes count as stale', async () => {
    const adapter = await openAdapter(freshDbPath('stale-gone'));
    try {
      // No scan_nodes row at all for the finding's node.
      await replaceFindingsForNode(adapter.db, 'gone.md', FINDER_ID, [insertRow()]);
      strictEqual((await listFindings(adapter.db, {})).length, 0);
      const rows = await listFindings(adapter.db, { includeStale: true });
      strictEqual(rows.length, 1);
      strictEqual(rows[0]!.stale, true);
    } finally {
      await adapter.close();
    }
  });

  it('applies the scalar and matching filters', async () => {
    const adapter = await openAdapter(freshDbPath('filters'));
    try {
      const OTHER = 'notes/other.md';
      await insertNode(adapter, { path: NODE_PATH, bodyHash: BODY_HASH });
      await insertNode(adapter, { path: OTHER, bodyHash: BODY_HASH });
      await replaceFindingsForNode(adapter.db, NODE_PATH, FINDER_ID, [
        insertRow({ type: 'contradiction', severity: 'error', confidence: 0.9, generatedAt: 3000 }),
        insertRow({ type: 'redundancy', severity: 'info', confidence: 0.4, generatedAt: 1000 }),
      ]);
      await replaceFindingsForNode(adapter.db, OTHER, 'other/checker', [
        insertRow({ type: 'contradiction', severity: 'warn', confidence: 0.6, generatedAt: 2000 }),
      ]);

      strictEqual((await listFindings(adapter.db, { nodeId: OTHER })).length, 1, 'nodeId');
      strictEqual(
        (await listFindings(adapter.db, { extensionIds: [FINDER_ID] })).length,
        2,
        'qualified extension filter',
      );
      strictEqual(
        (await listFindings(adapter.db, { extensionIds: ['checker'] })).length,
        1,
        'bare extension filter matches the stored suffix',
      );
      strictEqual(
        (await listFindings(adapter.db, { type: 'contradiction' })).length,
        2,
        'type filter',
      );
      strictEqual(
        (await listFindings(adapter.db, { minSeverity: 'warn' })).length,
        2,
        'minimum severity keeps warn + error, drops info',
      );
      strictEqual((await listFindings(adapter.db, { sinceMs: 2000 })).length, 2, 'sinceMs');
      strictEqual(
        (await listFindings(adapter.db, { minConfidence: 0.6 })).length,
        2,
        'minConfidence',
      );
    } finally {
      await adapter.close();
    }
  });
});

describe('recordJobTerminal findings write-through (same transaction)', () => {
  it('replaces the pair inside the record tx when a findings intent rides along', async () => {
    const adapter = await openAdapter(freshDbPath('record'));
    try {
      await insertNode(adapter, { path: NODE_PATH, bodyHash: BODY_HASH });
      await replaceFindingsForNode(adapter.db, NODE_PATH, FINDER_ID, [
        insertRow({ type: 'stale-judgment', message: 'to be replaced' }),
      ]);
      await seedRunning(adapter);

      await recordJobTerminal(
        adapter.db,
        buildExecution(),
        undefined,
        intent([
          {
            origin: 'extension',
            type: 'contradiction',
            severity: 'warn',
            message: 'fresh',
            detail: null,
            confidence: 0.8,
          },
          {
            origin: 'kernel',
            type: 'injection-detected',
            severity: 'warn',
            message: 'flagged',
            detail: null,
            confidence: 0.8,
          },
        ]),
      );

      strictEqual((await adapter.jobs.get(JOB_ID))!.status, 'completed');
      const rows = await adapter.findings.list({ nodeId: NODE_PATH });
      deepStrictEqual(
        rows.map((r) => r.type).sort(),
        ['contradiction', 'injection-detected'],
        'prior judgment replaced by the fresh finder + kernel rows',
      );
      ok(rows.every((r) => r.jobId === JOB_ID));
    } finally {
      await adapter.close();
    }
  });

  it('a lost record race rolls back EVERYTHING (previous findings survive)', async () => {
    const adapter = await openAdapter(freshDbPath('record-race'));
    try {
      await insertNode(adapter, { path: NODE_PATH, bodyHash: BODY_HASH });
      await replaceFindingsForNode(adapter.db, NODE_PATH, FINDER_ID, [
        insertRow({ type: 'prior', message: 'survives the rollback' }),
      ]);
      // Job never claimed: still queued, so the guarded UPDATE matches
      // zero rows and the transaction throws + rolls back.
      const row: IJobSubmitRow = {
        id: JOB_ID,
        extensionId: FINDER_ID,
        extensionVersion: '1.0.0',
        extensionKind: 'analyzer',
        nodeId: NODE_PATH,
        contentHash: 'h'.repeat(64),
        nonce: 'n'.repeat(32),
        priority: 0,
        status: 'queued',
        ttlSeconds: 3600,
        createdAt: 1000,
      };
      await adapter.jobs.submit(row, {
        contentHash: row.contentHash,
        content: 'RENDERED',
        createdAt: row.createdAt,
      });

      await rejects(
        recordJobTerminal(
          adapter.db,
          buildExecution(),
          undefined,
          intent([
            {
              origin: 'extension',
              type: 'contradiction',
              severity: 'warn',
              message: 'must not land',
              detail: null,
              confidence: 0.8,
            },
          ]),
        ),
        JobNotRunningError,
      );

      const rows = await adapter.findings.list({ nodeId: NODE_PATH });
      deepStrictEqual(
        rows.map((r) => r.type),
        ['prior'],
        'rolled back: prior rows intact, fresh rows absent',
      );
      strictEqual((await adapter.history.list({})).length, 0, 'no execution row either');
    } finally {
      await adapter.close();
    }
  });

  it('skips the findings write when the node vanished, execution + transition still land', async () => {
    const adapter = await openAdapter(freshDbPath('record-gone'));
    try {
      // Prior rows for the pair on a node that no longer exists.
      await replaceFindingsForNode(adapter.db, NODE_PATH, FINDER_ID, [
        insertRow({ type: 'prior', message: 'kept' }),
      ]);
      await seedRunning(adapter);

      await recordJobTerminal(adapter.db, buildExecution(), undefined, intent([]));

      strictEqual((await adapter.jobs.get(JOB_ID))!.status, 'completed', 'job transitions');
      strictEqual((await adapter.history.list({})).length, 1, 'execution lands');
      const rows = await adapter.findings.list({ nodeId: NODE_PATH, includeStale: true });
      deepStrictEqual(
        rows.map((r) => r.type),
        ['prior'],
        'previous rows kept (write skipped, not erased)',
      );
    } finally {
      await adapter.close();
    }
  });
});

describe('findings.clear + countClearable (wholesale delete)', () => {
  const OTHER = 'notes/other.md';

  /** Seed two nodes with fresh, stale, and kernel-origin rows. */
  async function seedMixed(adapter: SqliteStorageAdapter): Promise<void> {
    await insertNode(adapter, { path: NODE_PATH, bodyHash: BODY_HASH });
    await insertNode(adapter, { path: OTHER, bodyHash: BODY_HASH });
    await replaceFindingsForNode(adapter.db, NODE_PATH, FINDER_ID, [
      insertRow({ type: 'fresh-a' }),
      // Stale by hash drift: judged against a body the node no longer has.
      insertRow({ type: 'stale-a', bodyHashAtGeneration: 'd'.repeat(64) }),
    ]);
    await replaceFindingsForNode(adapter.db, NODE_PATH, 'other/checker', [
      insertRow({ type: 'injection-detected', origin: 'kernel' }),
    ]);
    await replaceFindingsForNode(adapter.db, OTHER, FINDER_ID, [
      insertRow({ type: 'fresh-b' }),
    ]);
  }

  it('clear() with no node wipes the whole table, kernel safety rows included', async () => {
    const adapter = await openAdapter(freshDbPath('clear-all'));
    try {
      await seedMixed(adapter);
      strictEqual(await adapter.findings.countClearable(), 4, 'count twin sees every row');

      strictEqual(await adapter.findings.clear(), 4, 'deleted count');
      deepStrictEqual(await adapter.findings.list({ includeStale: true }), [], 'table empty');
      strictEqual(await adapter.findings.countClearable(), 0);
    } finally {
      await adapter.close();
    }
  });

  it('clear(nodeId) deletes only that node (fresh AND stale AND kernel), others survive', async () => {
    const adapter = await openAdapter(freshDbPath('clear-node'));
    try {
      await seedMixed(adapter);
      strictEqual(await adapter.findings.countClearable(NODE_PATH), 3, 'scoped count');

      strictEqual(await adapter.findings.clear(NODE_PATH), 3);
      const rows = await adapter.findings.list({ includeStale: true });
      deepStrictEqual(
        rows.map((r) => [r.nodeId, r.type]),
        [[OTHER, 'fresh-b']],
        'the other node keeps its row',
      );
    } finally {
      await adapter.close();
    }
  });

  it('empty table: count and clear both report 0', async () => {
    const adapter = await openAdapter(freshDbPath('clear-empty'));
    try {
      strictEqual(await adapter.findings.countClearable(), 0);
      strictEqual(await adapter.findings.clear(), 0);
    } finally {
      await adapter.close();
    }
  });
});

describe('findings.suppressionsByPath (mirror-backed lens source)', () => {
  it('narrows by path, skips malformed annotations_json and entry shapes defensively', async () => {
    const adapter = await openAdapter(freshDbPath('supp-by-path'));
    try {
      await insertNode(adapter, { path: 'a.md', bodyHash: BODY_HASH });
      await insertNode(adapter, { path: 'b.md', bodyHash: BODY_HASH });
      await insertNode(adapter, { path: 'c.md', bodyHash: BODY_HASH });
      await adapter.scans.refreshAnnotations('a.md', {
        suppressions: [
          { extension: 'plug/x', type: 't', note: 'why' },
          // Defensive: entries without a string extension are skipped.
          { type: 'orphan' } as unknown as Record<string, unknown>,
        ],
      });
      // Malformed cell: parse failure yields no entries, never a throw.
      await adapter.db
        .updateTable('scan_nodes')
        .set({ annotationsJson: '{not-json' })
        .where('path', '=', 'b.md')
        .execute();

      const all = await adapter.findings.suppressionsByPath();
      deepStrictEqual([...all.keys()], ['a.md'], 'only the valid carrier appears');
      deepStrictEqual(all.get('a.md'), [{ extension: 'plug/x', type: 't', note: 'why' }]);

      // Path narrowing: an empty list short-circuits, a miss yields none.
      strictEqual((await adapter.findings.suppressionsByPath([])).size, 0);
      strictEqual((await adapter.findings.suppressionsByPath(['c.md'])).size, 0);
    } finally {
      await adapter.close();
    }
  });
});

/**
 * The KERNEL SAFETY LANE is scoped to the NODE, not to the reporting
 * extension (`spec/db-schema.md` §state_findings). A safety row states a
 * fact about the node's CONTENT, and every probabilistic report carries a
 * complete safety verdict on the body it read, so the newest report owns
 * the lane. Per-extension scope used to keep one copy of the same fact per
 * extension that ever ran (six finders over one trapped file recorded the
 * same injection six times, live-verified 2026-07-25).
 */
describe('writeFindingsForNode (kernel safety lane, node-scoped)', () => {
  const kernelRow = (type: string): IFindingsWriteIntent['rows'][number] => ({
    origin: 'kernel',
    type,
    severity: 'warn',
    message: `the model flagged ${type}`,
    detail: null,
    confidence: 1,
  });

  it('a second extension reporting the same fact REPLACES it, never duplicates', async () => {
    const adapter = await openAdapter(freshDbPath('kernel-dedupe'));
    try {
      await insertNode(adapter, { path: NODE_PATH, bodyHash: BODY_HASH });
      await writeFindingsForNode(
        adapter.db,
        NODE_PATH,
        intent([kernelRow('injection-detected')], 'core/ai-contradiction-analyzer'),
      );
      await writeFindingsForNode(
        adapter.db,
        NODE_PATH,
        intent([kernelRow('injection-detected')], 'core/ai-verbosity-analyzer'),
      );

      const rows = (await listFindings(adapter.db, { nodeId: NODE_PATH })).filter(
        (r) => r.origin === 'kernel',
      );
      strictEqual(rows.length, 1, 'one row per fact, not one per reporting extension');
      strictEqual(rows[0]!.type, 'injection-detected');
      strictEqual(
        rows[0]!.extensionId,
        'core/ai-verbosity-analyzer',
        'extension_id names the run that surfaced it LAST',
      );
    } finally {
      await adapter.close();
    }
  });

  it('a clean report from ANY extension clears the lane', async () => {
    const adapter = await openAdapter(freshDbPath('kernel-clean'));
    try {
      await insertNode(adapter, { path: NODE_PATH, bodyHash: BODY_HASH });
      await writeFindingsForNode(
        adapter.db,
        NODE_PATH,
        intent([kernelRow('injection-detected')], 'core/ai-security-analyzer'),
      );
      // A different extension reads the same body and reports clean.
      await writeFindingsForNode(adapter.db, NODE_PATH, intent([], 'core/ai-vagueness-analyzer'));

      const rows = (await listFindings(adapter.db, { nodeId: NODE_PATH })).filter(
        (r) => r.origin === 'kernel',
      );
      strictEqual(rows.length, 0, 'the newest reader of this body is the current verdict');
    } finally {
      await adapter.close();
    }
  });

  it('leaves the FINDER lane alone (it still supersedes per extension)', async () => {
    const adapter = await openAdapter(freshDbPath('kernel-lane-split'));
    try {
      await insertNode(adapter, { path: NODE_PATH, bodyHash: BODY_HASH });
      await writeFindingsForNode(
        adapter.db,
        NODE_PATH,
        intent(
          [
            {
              origin: 'extension',
              type: 'contradiction',
              severity: 'warn',
              message: 'A contradicts B',
              detail: null,
              confidence: 0.7,
            },
          ],
          'core/ai-contradiction-analyzer',
        ),
      );
      // Another extension runs and only trips the safety lane.
      await writeFindingsForNode(
        adapter.db,
        NODE_PATH,
        intent([kernelRow('content-suspicious')], 'core/ai-verbosity-analyzer'),
      );

      const rows = await listFindings(adapter.db, { nodeId: NODE_PATH });
      const finder = rows.filter((r) => r.origin === 'extension');
      strictEqual(finder.length, 1, "another extension's run never touches the finder lane");
      strictEqual(finder[0]!.type, 'contradiction');
      strictEqual(rows.filter((r) => r.origin === 'kernel').length, 1);
    } finally {
      await adapter.close();
    }
  });
});
