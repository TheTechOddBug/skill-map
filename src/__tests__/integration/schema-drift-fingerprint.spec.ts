/**
 * Integration coverage for fingerprint-based schema-drift detection
 * across the full persist → detect → read loop on a REAL kernel schema
 * (file-based DB via `mkdtempSync`, per `feedback_sqlite_in_memory_workaround`).
 *
 * Proves:
 *   - a real `sm scan` persist writes `scan_meta.schema_fingerprint` =
 *     the current bundled fingerprint (so a fresh DB never self-drifts);
 *   - a DB with a STALE fingerprint at the SAME version is detected as
 *     schema drift and rebuilt by the write-side path (`maybeResetOnDrift`
 *     with `assumeYes`, the `--yes` / non-TTY policy);
 *   - a read open (`withSqlite` + `versionCheck`) against the drifted DB
 *     WARNS (does not refuse / crash) and the callback still runs;
 *   - a never-scanned DB (no `scan_meta` row) is silent on both sides.
 *
 * See `spec/db-schema.md` §Schema drift (pre-1.0).
 */

import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { SqliteStorageAdapter } from '../../kernel/adapters/sqlite/index.js';
import type { Node, ScanResult } from '../../kernel/types.js';
import { maybeResetOnDrift } from '../../core/sqlite/db-drift-reset.js';
import { schemaFingerprint } from '../../core/sqlite/schema-fingerprint.js';
import { withSqlite } from '../../core/sqlite/with-sqlite.js';
import type { IPrinter } from '../../core/runtime/printer.js';

const VERSION = '0.42.0';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sm-drift-fp-int-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeNode(path: string): Node {
  return {
    path,
    kind: 'note',
    provider: 'claude',
    bodyHash: '0'.repeat(64),
    frontmatterHash: '0'.repeat(64),
    bytes: { frontmatter: 0, body: 0, total: 0 },
    frontmatter: {},
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
  };
}

function makeScanResult(): ScanResult {
  return {
    schemaVersion: 1,
    scannedAt: 1_700_000_000_000,
    roots: ['.'],
    providers: ['claude'],
    scannedBy: { name: 'skill-map', version: VERSION, specVersion: '1.0.0' },
    nodes: [makeNode('a.md')],
    links: [],
    issues: [],
    stats: {
      filesWalked: 1,
      filesSkipped: 0,
      nodesCount: 1,
      linksCount: 0,
      issuesCount: 0,
      durationMs: 0,
    },
  };
}

/** Persist a real scan through the kernel adapter, returns the DB path. */
async function seedScannedDb(): Promise<string> {
  const path = join(dir, 'skill-map.db');
  const adapter = new SqliteStorageAdapter({ databasePath: path });
  await adapter.init();
  try {
    await adapter.scans.persist(makeScanResult());
  } finally {
    await adapter.close();
  }
  return path;
}

/** Overwrite the persisted fingerprint with a bogus value (drift). */
function corruptFingerprint(path: string): void {
  const raw = new DatabaseSync(path);
  try {
    raw.exec("UPDATE scan_meta SET schema_fingerprint = 'stale-fingerprint-xyz'");
  } finally {
    raw.close();
  }
}

interface IPrinterSpy extends IPrinter {
  readonly warnings: string[];
}

function makePrinterSpy(): IPrinterSpy {
  const warnings: string[] = [];
  return {
    data: () => {},
    info: () => {},
    warn: (t) => { warnings.push(t); },
    error: () => {},
    warnings,
  };
}

describe('schema-drift fingerprint (integration)', () => {
  it('persists the current bundled fingerprint on a real scan', async () => {
    const path = await seedScannedDb();
    const raw = new DatabaseSync(path, { readOnly: true });
    try {
      const row = raw
        .prepare('SELECT schema_fingerprint AS fp FROM scan_meta LIMIT 1')
        .get() as { fp: string };
      assert.equal(row.fp, schemaFingerprint(), 'persist writes the live fingerprint');
    } finally {
      raw.close();
    }
  });

  it('a freshly-scanned DB shows no drift (version + fingerprint match)', async () => {
    const path = await seedScannedDb();
    const outcome = await maybeResetOnDrift(path, { currentVersion: VERSION, assumeYes: true });
    assert.equal(outcome.kind, 'no-drift');
    assert.ok(existsSync(path), 'a compatible cache is never rebuilt');
  });

  it('write-side: a stale fingerprint at the same version rebuilds (reason schema)', async () => {
    const path = await seedScannedDb();
    corruptFingerprint(path);
    const outcome = await maybeResetOnDrift(path, { currentVersion: VERSION, assumeYes: true });
    assert.equal(outcome.kind, 'reset');
    assert.equal(outcome.kind === 'reset' && outcome.reason, 'schema');
    assert.ok(!existsSync(path), 'the drifted DB file is deleted for rebuild');
  });

  it('read-side: a stale fingerprint WARNS but does not crash, callback runs', async () => {
    const path = await seedScannedDb();
    corruptFingerprint(path);
    const printer = makePrinterSpy();
    let ran = false;
    await withSqlite(
      { databasePath: path, autoBackup: false, versionCheck: { currentVersion: VERSION, printer } },
      async () => { ran = true; },
    );
    assert.equal(ran, true, 'read continues on schema drift');
    assert.equal(printer.warnings.length, 1, 'one schema-drift advisory');
    assert.ok(printer.warnings[0]!.includes('sm scan'), 'advisory points at the rebuild');
    assert.ok(existsSync(path), 'a read never deletes the cache');
  });

  it('a never-scanned DB is silent on BOTH sides (no scan_meta row)', async () => {
    const path = join(dir, 'empty.db');
    const adapter = new SqliteStorageAdapter({ databasePath: path });
    await adapter.init(); // migrate, never persist
    await adapter.close();

    // Write side: no signal, no rebuild.
    const writeOutcome = await maybeResetOnDrift(path, { currentVersion: VERSION, assumeYes: true });
    assert.equal(writeOutcome.kind, 'no-drift');
    assert.ok(existsSync(path), 'a never-scanned DB is never rebuilt');

    // Read side: no advisory.
    const printer = makePrinterSpy();
    await withSqlite(
      { databasePath: path, autoBackup: false, versionCheck: { currentVersion: VERSION, printer } },
      async () => {},
    );
    assert.equal(printer.warnings.length, 0, 'no advisory on a never-scanned DB');
  });
});
