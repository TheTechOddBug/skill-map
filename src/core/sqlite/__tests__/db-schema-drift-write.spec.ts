/**
 * Write-side schema-drift guard, the DEFAULT behaviour of a `withSqlite`
 * open with NO `versionCheck` bag and NO `skipDriftCheck` opt-out. Fires
 * on the schema-fingerprint axis so a DB-mutating verb (job / config /
 * plugins-toggle / record) that opens a DB whose on-disk schema drifted
 * from the bundled migrations REFUSES with a `DbSchemaDriftError` advisory
 * instead of crashing later with `CHECK constraint failed` / `no such
 * column`. See `spec/db-schema.md` §Schema drift, the "Other mutating
 * opens refuse" mode.
 *
 * Real on-disk SQLite files only (per `feedback_sqlite_in_memory_workaround`,
 * `:memory:` does not work with the adapter's two-`DatabaseSync` design).
 *
 * Matrix:
 *   - drifted fingerprint + default write open → throws DbSchemaDriftError.
 *   - matching fingerprint (fresh persist) → no-op, the write proceeds.
 *   - never-scanned DB (no scan_meta row) → no-op (no signal).
 *   - drifted fingerprint + `skipDriftCheck` (scan / watch own drift) → no
 *     refuse, the write proceeds.
 *   - drifted fingerprint + `versionCheck` (a READ open) → WARN, never the
 *     write-side refuse; the read continues.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ok, rejects, strictEqual } from 'node:assert';
import { after, before, beforeEach, describe, it } from 'node:test';

import { SqliteStorageAdapter } from '../../../kernel/adapters/sqlite/index.js';
import type { Node, ScanResult } from '../../../kernel/types.js';
import { withSqlite } from '../with-sqlite.js';
import { DbSchemaDriftError } from '../db-version-check.js';
import { resetDbVersionWarnCacheForTests } from '../db-version-runner.js';
import type { IPrinter } from '../../runtime/printer.js';

let tempRoot: string;

before(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'skill-map-drift-write-'));
});

after(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

beforeEach(() => {
  resetDbVersionWarnCacheForTests();
});

function freshDbPath(name: string): string {
  return join(tempRoot, `${name}.db`);
}

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
    scannedBy: { name: 'skill-map', version: '0.36.0', specVersion: '1.0.0' },
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

/**
 * Persist a scan so `scan_meta.schema_fingerprint` is stamped with the
 * CURRENT bundled fingerprint (a matching, non-drifted DB).
 */
async function seedScannedDb(dbPath: string): Promise<void> {
  const adapter = new SqliteStorageAdapter({ databasePath: dbPath });
  await adapter.init();
  try {
    await adapter.scans.persist(makeScanResult());
  } finally {
    await adapter.close();
  }
}

/** Overwrite the stored fingerprint with a value that cannot match, i.e. drift. */
function tamperFingerprint(dbPath: string): void {
  const raw = new DatabaseSync(dbPath);
  try {
    raw.exec("UPDATE scan_meta SET schema_fingerprint = 'stale-fingerprint'");
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
    data: (): void => {},
    info: (): void => {},
    warn: (text: string): void => { warnings.push(text); },
    error: (): void => {},
    warnings,
  };
}

describe('withSqlite write-side drift guard (default open)', () => {
  it('refuses a mutating open against a drifted DB', async () => {
    const path = freshDbPath('write-drift');
    await seedScannedDb(path);
    tamperFingerprint(path);

    let callbackRan = false;
    await rejects(
      withSqlite({ databasePath: path }, async () => {
        callbackRan = true;
      }),
      (err: unknown) => {
        ok(err instanceof DbSchemaDriftError);
        strictEqual(err.kind, 'schema-drift');
        // Plain `.message` (BFF envelope) names the remediation.
        ok(err.message.includes('sm db reset --hard'));
        ok(err.message.includes('sm scan'));
        // §3.1b block (CLI stderr) carries the glyph + reason + hint.
        ok(err.humanMessage.includes('✕'));
        ok(err.humanMessage.includes('schema change'));
        ok(err.humanMessage.includes('sm db reset --hard'));
        return true;
      },
    );
    strictEqual(callbackRan, false, 'callback MUST NOT run when the DB drifted');
  });

  it('proceeds against a current-schema DB (matching fingerprint)', async () => {
    const path = freshDbPath('write-ok');
    await seedScannedDb(path);

    let callbackRan = false;
    await withSqlite({ databasePath: path }, async () => {
      callbackRan = true;
    });
    strictEqual(callbackRan, true, 'the write proceeds on a matching fingerprint');
  });

  it('proceeds against a never-scanned DB (no scan_meta row → no signal)', async () => {
    const path = freshDbPath('write-no-meta');
    // Migrate but never persist a scan: scan_meta stays empty.
    const seed = new SqliteStorageAdapter({ databasePath: path });
    await seed.init();
    await seed.close();

    let callbackRan = false;
    await withSqlite({ databasePath: path }, async () => {
      callbackRan = true;
    });
    strictEqual(callbackRan, true, 'no scan_meta row is not drift');
  });

  it('does NOT refuse when the open opts out via skipDriftCheck', async () => {
    const path = freshDbPath('write-optout');
    await seedScannedDb(path);
    tamperFingerprint(path);

    let callbackRan = false;
    // Mirrors `sm scan` / `sm watch`, which own drift and rebuild it
    // themselves before the open.
    await withSqlite({ databasePath: path, skipDriftCheck: true }, async () => {
      callbackRan = true;
    });
    strictEqual(callbackRan, true, 'skipDriftCheck bypasses the write-side refusal');
  });

  it('WARNs (never refuses) on a drifted DB when versionCheck is present (read open)', async () => {
    const path = freshDbPath('read-warn');
    await seedScannedDb(path);
    tamperFingerprint(path);

    const printer = makePrinterSpy();
    let callbackRan = false;
    await withSqlite(
      {
        databasePath: path,
        versionCheck: { currentVersion: '0.36.0', printer },
      },
      async () => {
        callbackRan = true;
      },
    );
    strictEqual(callbackRan, true, 'a read open continues on schema drift (WARN, never refuse)');
    strictEqual(printer.warnings.length, 1, 'schema-drift warning printed once');
    ok(printer.warnings[0]!.includes('schema change'));
  });
});
