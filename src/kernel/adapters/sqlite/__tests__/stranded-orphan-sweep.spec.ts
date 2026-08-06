/**
 * The stranded-orphan sweep in `persistScanResult`
 * (`appendStrandedOrphans`): after each scan it re-emits one `info`
 * `orphan` issue per `state_*` row whose `node_id` is no longer in the
 * live set, so a node deleted two scans ago stays actionable through
 * `sm orphans reconcile`.
 *
 * The regression under test: a NODELESS job's synthetic target
 * (`sm://<extension-id>`, `spec/job-lifecycle.md` §Submit · Nodeless
 * submit) is not a node that went missing, it never was one, so the sweep
 * must skip it. Without that, the liveness probe left an `orphan` issue in
 * every scan of every project, pointing at an id no reconcile can resolve.
 *
 * Real file-path SQLite (never `:memory:`, which yields an empty
 * Kysely-side schema).
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strictEqual, ok } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import { SqliteStorageAdapter } from '../index.js';
import { persistScanResult } from '../scan-persistence.js';
import type { Node, ScanResult } from '../../../types.js';
import type { IJobSubmitRow } from '../../../types/storage.js';

const HASH = 'a'.repeat(64);

let tmp: string;
let counter = 0;

before(() => {
  tmp = mkdtempSync(join(tmpdir(), 'skill-map-stranded-'));
});

after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function node(path: string): Node {
  return {
    path,
    kind: 'skill',
    provider: 'claude',
    bodyHash: HASH,
    frontmatterHash: HASH,
    bytes: { frontmatter: 0, body: 0, total: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
  };
}

function scan(nodes: Node[]): ScanResult {
  return {
    schemaVersion: 1,
    scannedAt: Date.now(),
    roots: ['.'],
    providers: ['claude'],
    nodes,
    links: [],
    issues: [],
    stats: {
      filesWalked: nodes.length,
      filesSkipped: 0,
      nodesCount: nodes.length,
      linksCount: 0,
      issuesCount: 0,
      durationMs: 0,
    },
  };
}

function job(nodeId: string, id: string): IJobSubmitRow {
  return {
    extensionId: 'core/ai-ping-action',
    extensionVersion: '1.0.0',
    extensionKind: 'action',
    nodeId,
    contentHash: 'h'.repeat(64),
    nonce: 'n'.repeat(32),
    priority: 0,
    status: 'queued',
    ttlSeconds: null,
    createdAt: Date.now(),
    autoFix: false,
    id,
  };
}

/** Persist one scan, then a second one, and return the second's issues. */
async function issuesAfterSecondScan(
  label: string,
  jobNodeId: string,
  liveNodes: Node[],
): Promise<ScanResult['issues']> {
  counter += 1;
  const adapter = new SqliteStorageAdapter({
    databasePath: join(tmp, `${label}-${counter}.db`),
    autoBackup: false,
  });
  await adapter.init();
  try {
    await persistScanResult(adapter.db, scan(liveNodes));
    await adapter.jobs.submit(job(jobNodeId, `d-${label}-${counter}`), {
      contentHash: 'h'.repeat(64),
      content: 'rendered',
      createdAt: Date.now(),
    });
    const second = scan(liveNodes);
    await persistScanResult(adapter.db, second);
    return second.issues;
  } finally {
    await adapter.close();
  }
}

describe('stranded-orphan sweep', () => {
  it('skips the synthetic target of a nodeless job', async () => {
    const issues = await issuesAfterSecondScan('nodeless', 'sm://core/ai-ping-action', [
      node('a.md'),
    ]);
    strictEqual(
      issues.filter((i) => i.analyzerId === 'orphan').length,
      0,
      'a synthetic id is infrastructure, not a node that went missing',
    );
  });

  /**
   * Negative control: the sweep still fires for a REAL path with stranded
   * state, so the skip above cannot silently disable the whole feature.
   */
  it('still reports a real path whose node is gone', async () => {
    const issues = await issuesAfterSecondScan('real', 'deleted.md', [node('a.md')]);
    const orphans = issues.filter((i) => i.analyzerId === 'orphan');
    strictEqual(orphans.length, 1);
    ok(orphans[0]?.message.includes('deleted.md'));
    strictEqual(orphans[0]?.severity, 'info');
  });
});
