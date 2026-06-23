/**
 * Regression: persisting a large scan must not exceed SQLite's bound
 * variable cap (`SQLITE_MAX_VARIABLE_NUMBER`). Before the scan cap was
 * split into `scan.maxScan` (corpus ceiling, default 50000) and
 * `scan.maxNodes` (render cap, default 256), the walk never produced
 * more than 256 nodes, so the replace-all `INSERT ... VALUES (...)`
 * always fit in one statement. With the corpus ceiling lifted, a single
 * multi-row insert of ~1800+ nodes binds more than 32766 variables and
 * SQLite aborts with "too many SQL variables". `replaceAllScanZone` now
 * chunks every batch write; this test plants enough nodes / links /
 * issues to force multiple chunks and asserts the round-trip survives.
 *
 * Fixture path uses `mkdtempSync` (the SqliteStorageAdapter does not work
 * with `:memory:`).
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { SqliteStorageAdapter } from '../index.js';
import { persistScanResult } from '../scan-persistence.js';
import type { Issue, Link, Node, ScanResult } from '../../../types.js';

const HASH = 'a'.repeat(64);
const NODE_COUNT = 1800;

let tmp: string;
let dbPath: string;

before(() => {
  tmp = mkdtempSync(join(tmpdir(), 'skill-map-large-persist-'));
  dbPath = join(tmp, 'large.db');
});

after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function makeNode(i: number): Node {
  return {
    path: `skills/skill-${String(i).padStart(5, '0')}.md`,
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

describe('persistScanResult, large corpus', () => {
  it('round-trips a corpus larger than the SQLite variable cap', async () => {
    const nodes: Node[] = Array.from({ length: NODE_COUNT }, (_unused, i) => makeNode(i));
    // A link from every node to its successor (both endpoints exist), so
    // the links insert also exceeds one chunk.
    const links: Link[] = nodes.slice(0, -1).map((n, i) => ({
      source: n.path,
      target: nodes[i + 1]!.path,
      kind: 'references',
      confidence: 1,
      sources: ['markdown-link'],
    }));
    const issues: Issue[] = nodes.map((n) => ({
      analyzerId: 'core/reference-broken',
      severity: 'warn',
      nodeIds: [n.path],
      message: 'planted',
    }));
    const result: ScanResult = {
      schemaVersion: 1,
      scannedAt: Date.now(),
      roots: ['.'],
      providers: ['claude'],
      nodes,
      links,
      issues,
      stats: {
        filesWalked: NODE_COUNT,
        filesSkipped: 0,
        nodesCount: NODE_COUNT,
        linksCount: links.length,
        issuesCount: issues.length,
        durationMs: 0,
      },
    };

    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      // The bug: this threw "too many SQL variables" before chunking.
      await persistScanResult(adapter.db, result);
      const loaded = await adapter.scans.load();
      assert.equal(loaded.stats.nodesCount, NODE_COUNT);
      assert.equal(loaded.stats.linksCount, links.length);
      assert.equal(loaded.stats.issuesCount, NODE_COUNT);
      // Spot-check the chunk boundaries did not drop or duplicate rows.
      assert.equal(loaded.nodes.length, NODE_COUNT);
      assert.equal(loaded.nodes[0]?.path, 'skills/skill-00000.md');
      assert.equal(loaded.nodes.at(-1)?.path, `skills/skill-${String(NODE_COUNT - 1).padStart(5, '0')}.md`);
    } finally {
      await adapter.close();
    }
  });
});
