/**
 * Whole-result fingerprint short-circuit (`persistScanResult`).
 *
 * Probe technique: after a persist, an out-of-band UPDATE plants a
 * marker on one `scan_nodes` row. A subsequent persist that takes the
 * full replace-all path wipes the marker; one that engages the skip
 * gate leaves it standing. This observes the skip directly instead of
 * relying on rowid accounting (rowids restart identically after a
 * delete-all + reinsert, so they cannot discriminate the two paths).
 *
 * Pinned here:
 *   - a fresh DB persists a non-null `result_fingerprint`.
 *   - a second identical persist SKIPS the replace-all while
 *     `scan_meta` still advances (`scanned_at`), stays single-row, and
 *     keeps the fingerprint.
 *   - a modified result takes the full path (probe wiped, fp changed).
 *   - an empty result wipes a populated DB (never "skips" the wipe).
 *   - the freshly-run tuple set participates in the fingerprint: an
 *     unchanged set skips, a changed set takes the full path.
 *   - non-empty `renameOps` forces the full path even when the
 *     fingerprint matches.
 *
 * Fixture path uses `mkdtempSync` (the SqliteStorageAdapter does not
 * work with `:memory:`).
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { SqliteStorageAdapter } from '../index.js';
import { persistScanResult } from '../scan-persistence.js';
import type { Link, Node, ScanResult } from '../../../types.js';

const HASH = 'b'.repeat(64);
const PROBE = '__persist-fingerprint-probe__';

let tmp: string;

before(() => {
  tmp = mkdtempSync(join(tmpdir(), 'skill-map-persist-fp-'));
});

after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function makeNode(i: number, bodyHash: string = HASH): Node {
  return {
    path: `skills/skill-${i}.md`,
    kind: 'skill',
    provider: 'claude',
    bodyHash,
    frontmatterHash: HASH,
    bytes: { frontmatter: 10, body: 100, total: 110 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
  };
}

/** Fresh deep-independent result per call (persist mutates `issues`). */
function makeResult(scannedAt: number, opts: { probeBodyHash?: string } = {}): ScanResult {
  const nodes = [makeNode(0, opts.probeBodyHash ?? HASH), makeNode(1), makeNode(2)];
  const links: Link[] = [
    {
      source: nodes[0]!.path,
      target: nodes[1]!.path,
      kind: 'references',
      confidence: 1,
      sources: ['markdown-link'],
    },
  ];
  return {
    schemaVersion: 1,
    scannedAt,
    roots: ['.'],
    providers: ['claude'],
    nodes,
    links,
    issues: [
      {
        analyzerId: 'core/reference-broken',
        severity: 'warn',
        nodeIds: [nodes[2]!.path],
        message: 'planted',
      },
    ],
    stats: {
      filesWalked: 3,
      filesSkipped: 0,
      nodesCount: 3,
      linksCount: 1,
      issuesCount: 1,
      // Deliberately varies per persist: duration must NOT participate
      // in the fingerprint (it is volatile by nature).
      durationMs: scannedAt % 97,
    },
  };
}

function emptyResult(scannedAt: number): ScanResult {
  return {
    schemaVersion: 1,
    scannedAt,
    roots: ['.'],
    providers: ['claude'],
    nodes: [],
    links: [],
    issues: [],
    stats: {
      filesWalked: 0,
      filesSkipped: 0,
      nodesCount: 0,
      linksCount: 0,
      issuesCount: 0,
      durationMs: 0,
    },
  };
}

async function openAdapter(name: string): Promise<SqliteStorageAdapter> {
  const adapter = new SqliteStorageAdapter({
    databasePath: join(tmp, `${name}.db`),
    autoBackup: false,
  });
  await adapter.init();
  return adapter;
}

async function plantProbe(adapter: SqliteStorageAdapter): Promise<void> {
  await adapter.db
    .updateTable('scan_nodes')
    .set({ title: PROBE })
    .where('path', '=', 'skills/skill-0.md')
    .execute();
}

async function probeSurvived(adapter: SqliteStorageAdapter): Promise<boolean> {
  const row = await adapter.db
    .selectFrom('scan_nodes')
    .select('title')
    .where('path', '=', 'skills/skill-0.md')
    .executeTakeFirst();
  return row?.title === PROBE;
}

async function readMeta(
  adapter: SqliteStorageAdapter,
): Promise<{ scannedAt: number; resultFingerprint: string | null; rowCount: number }> {
  const rows = await adapter.db
    .selectFrom('scan_meta')
    .select(['scannedAt', 'resultFingerprint'])
    .execute();
  assert.equal(rows.length, 1, 'scan_meta must stay single-row');
  return { scannedAt: rows[0]!.scannedAt, resultFingerprint: rows[0]!.resultFingerprint, rowCount: rows.length };
}

describe('persistScanResult, result-fingerprint short-circuit', () => {
  it('a fresh DB persists a non-null fingerprint', async () => {
    const adapter = await openAdapter('fresh');
    try {
      await persistScanResult(adapter.db, makeResult(1000));
      const meta = await readMeta(adapter);
      assert.ok(meta.resultFingerprint, 'result_fingerprint must be written on the full path');
      assert.equal(meta.resultFingerprint!.length, 64, 'sha256 hex');
    } finally {
      await adapter.close();
    }
  });

  it('a second identical persist skips the replace-all but advances scan_meta', async () => {
    const adapter = await openAdapter('skip');
    try {
      await persistScanResult(adapter.db, makeResult(1000));
      const first = await readMeta(adapter);
      await plantProbe(adapter);

      await persistScanResult(adapter.db, makeResult(2000));
      const second = await readMeta(adapter);

      assert.equal(await probeSurvived(adapter), true, 'identical persist must skip the node rewrite');
      assert.equal(second.scannedAt, 2000, 'scanned_at must still advance on a skip');
      assert.equal(second.resultFingerprint, first.resultFingerprint, 'fingerprint is stable across identical persists');
    } finally {
      await adapter.close();
    }
  });

  it('a modified result takes the full path and rewrites the zone', async () => {
    const adapter = await openAdapter('modified');
    try {
      await persistScanResult(adapter.db, makeResult(1000));
      const first = await readMeta(adapter);
      await plantProbe(adapter);

      await persistScanResult(adapter.db, makeResult(2000, { probeBodyHash: 'c'.repeat(64) }));
      const second = await readMeta(adapter);

      assert.equal(await probeSurvived(adapter), false, 'a changed result must rewrite scan_nodes');
      assert.notEqual(second.resultFingerprint, first.resultFingerprint, 'fingerprint must change with content');
    } finally {
      await adapter.close();
    }
  });

  it('an empty result wipes a populated DB', async () => {
    const adapter = await openAdapter('empty-wipe');
    try {
      await persistScanResult(adapter.db, makeResult(1000));
      await persistScanResult(adapter.db, emptyResult(2000));
      const nodes = await adapter.db.selectFrom('scan_nodes').select('path').execute();
      assert.equal(nodes.length, 0, 'empty result must wipe scan_nodes');
      const meta = await readMeta(adapter);
      assert.equal(meta.scannedAt, 2000);
    } finally {
      await adapter.close();
    }
  });

  it('an unchanged freshly-run tuple set skips; a changed set takes the full path', async () => {
    const adapter = await openAdapter('fresh-tuples');
    const tuples = new Set(['core\x00some-analyzer\x00skills/skill-0.md']);
    try {
      await persistScanResult(adapter.db, makeResult(1000), { freshlyRunTuples: tuples });
      await plantProbe(adapter);

      // Same tuples, same content: the tuple set hashes identically, skip.
      await persistScanResult(adapter.db, makeResult(2000), { freshlyRunTuples: new Set(tuples) });
      assert.equal(await probeSurvived(adapter), true, 'an unchanged tuple set must not disable the skip');

      // A different tuple set changes the fingerprint: full path.
      await persistScanResult(adapter.db, makeResult(3000), {
        freshlyRunTuples: new Set(['core\x00other-extension\x00skills/skill-1.md']),
      });
      assert.equal(await probeSurvived(adapter), false, 'a changed tuple set must take the full path');
    } finally {
      await adapter.close();
    }
  });

  it('non-empty renameOps forces the full path even on a fingerprint match', async () => {
    const adapter = await openAdapter('renames');
    try {
      await persistScanResult(adapter.db, makeResult(1000));
      await plantProbe(adapter);
      await persistScanResult(adapter.db, makeResult(2000), {
        renameOps: [
          { from: 'skills/ghost-old.md', to: 'skills/ghost-new.md', confidence: 1 },
        ],
      });
      assert.equal(await probeSurvived(adapter), false, 'rename ops must disable the skip');
    } finally {
      await adapter.close();
    }
  });
});
