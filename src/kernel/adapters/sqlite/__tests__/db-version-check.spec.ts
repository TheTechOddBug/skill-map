/**
 * Step "version-skew detection" tests, exercises the read-side guard
 * that fires when an `sm` binary opens a DB written by a different
 * skill-map version. The end-to-end path runs against a real on-disk
 * SQLite file (per `feedback_sqlite_in_memory_workaround`, `:memory:`
 * does not work with the adapter's two-`DatabaseSync` design).
 *
 * Five cases cover the classification matrix from
 * `core/sqlite/db-version-check.ts`:
 *
 *   - same version → ok (no warn, no throw),
 *   - same major.minor (different patch) → ok,
 *   - older same-major minor → warn-older (one-shot, open succeeds),
 *   - newer same-major minor → error-newer (refuses to open),
 *   - different major → error-major (refuses to open),
 *   - missing `scan_meta` row → no-meta (silent, no signal).
 *
 * The classifier itself is also exercised directly so future regressions
 * around the comparison rules surface without spinning up a DB.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { strictEqual, ok, rejects, deepStrictEqual } from 'node:assert';
import { describe, it, before, after, beforeEach } from 'node:test';

import { SqliteStorageAdapter } from '../index.js';
import type { Node, ScanResult } from '../../../types.js';
import { withSqlite } from '../../../../core/sqlite/with-sqlite.js';
import {
  classifyVersionSkew,
  DbVersionMismatchError,
  detectDbVersionSkew,
} from '../../../../core/sqlite/db-version-check.js';
import {
  resetDbVersionWarnCacheForTests,
} from '../../../../core/sqlite/db-version-runner.js';
import type { IPrinter } from '../../../../core/runtime/printer.js';

let tempRoot: string;

before(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'skill-map-version-check-'));
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

function makeScanResult(version: string): ScanResult {
  return {
    schemaVersion: 1,
    scannedAt: 1_700_000_000_000,
    roots: ['.'],
    providers: ['claude'],
    scannedBy: { name: 'skill-map', version, specVersion: '1.0.0' },
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
 * Persist a scan with the given recorded CLI version. Used to seed the
 * `scan_meta.scanned_by_version` column for the version-check cases.
 */
async function seedDbWithScannedVersion(
  dbPath: string,
  scannedByVersion: string,
): Promise<void> {
  const adapter = new SqliteStorageAdapter({ databasePath: dbPath });
  await adapter.init();
  try {
    await adapter.scans.persist(makeScanResult(scannedByVersion));
  } finally {
    await adapter.close();
  }
}

interface IPrinterSpy extends IPrinter {
  readonly warnings: string[];
  readonly infos: string[];
}

function makePrinterSpy(): IPrinterSpy {
  const warnings: string[] = [];
  const infos: string[] = [];
  return {
    data: (): void => {},
    info: (text: string): void => { infos.push(text); },
    warn: (text: string): void => { warnings.push(text); },
    error: (): void => {},
    warnings,
    infos,
  };
}

describe('classifyVersionSkew (pure)', () => {
  it('returns ok for identical versions', () => {
    deepStrictEqual(classifyVersionSkew('0.36.0', '0.36.0'), { kind: 'ok' });
  });

  it('returns ok for same major.minor, different patch', () => {
    deepStrictEqual(classifyVersionSkew('0.36.0', '0.36.7'), { kind: 'ok' });
    deepStrictEqual(classifyVersionSkew('0.36.7', '0.36.0'), { kind: 'ok' });
  });

  it('flags an older same-major minor as warn-older', () => {
    const o = classifyVersionSkew('0.28.0', '0.36.0');
    strictEqual(o.kind, 'warn-older');
  });

  it('flags a newer same-major minor as error-newer', () => {
    const o = classifyVersionSkew('0.40.0', '0.36.0');
    strictEqual(o.kind, 'error-newer');
  });

  it('flags a different major as error-major (either direction)', () => {
    const newer = classifyVersionSkew('1.0.0', '0.36.0');
    strictEqual(newer.kind, 'error-major');
    if (newer.kind === 'error-major') {
      strictEqual(newer.dbMajor, 1);
      strictEqual(newer.currentMajor, 0);
    }
    const older = classifyVersionSkew('0.36.0', '1.0.0');
    strictEqual(older.kind, 'error-major');
  });

  it('returns no-meta when either version is unparseable', () => {
    deepStrictEqual(classifyVersionSkew('not-a-version', '0.36.0'), { kind: 'no-meta' });
    deepStrictEqual(classifyVersionSkew('0.36.0', 'garbage'), { kind: 'no-meta' });
  });

  it('tolerates prerelease + build suffixes (compares triples only)', () => {
    // Pre-1.0 with a prerelease suffix on the DB-side string stays
    // same-minor; the runner treats the triple as authoritative.
    deepStrictEqual(classifyVersionSkew('0.36.0-rc.1', '0.36.0'), { kind: 'ok' });
    deepStrictEqual(classifyVersionSkew('0.36.0+sha.abc', '0.36.0'), { kind: 'ok' });
  });
});

describe('detectDbVersionSkew (DB-backed)', () => {
  it('returns no-meta when scan_meta is empty', async () => {
    const path = freshDbPath('no-meta');
    const adapter = new SqliteStorageAdapter({ databasePath: path });
    await adapter.init();
    try {
      const outcome = await detectDbVersionSkew(
        (adapter as unknown as { db: import('kysely').Kysely<import('../schema.js').IDatabase> }).db,
        '0.36.0',
      );
      strictEqual(outcome.kind, 'no-meta');
    } finally {
      await adapter.close();
    }
  });

  it('returns ok when scanned_by_version matches the current CLI', async () => {
    const path = freshDbPath('ok');
    await seedDbWithScannedVersion(path, '0.36.0');
    const adapter = new SqliteStorageAdapter({ databasePath: path });
    await adapter.init();
    try {
      const outcome = await detectDbVersionSkew(
        (adapter as unknown as { db: import('kysely').Kysely<import('../schema.js').IDatabase> }).db,
        '0.36.0',
      );
      strictEqual(outcome.kind, 'ok');
    } finally {
      await adapter.close();
    }
  });
});

describe('withSqlite + versionCheck (seam)', () => {
  it('skips silently when the DB has no scan_meta row', async () => {
    const path = freshDbPath('seam-no-meta');
    // Migrate but never persist a scan, scan_meta stays empty.
    const seed = new SqliteStorageAdapter({ databasePath: path });
    await seed.init();
    await seed.close();

    const printer = makePrinterSpy();
    let calls = 0;
    await withSqlite(
      {
        databasePath: path,
        versionCheck: {
          currentVersion: '0.36.0',
          printer,
        },
      },
      async () => {
        calls += 1;
      },
    );
    strictEqual(calls, 1, 'callback ran');
    strictEqual(printer.warnings.length, 0, 'no warning printed');
  });

  it('passes through when versions match exactly', async () => {
    const path = freshDbPath('seam-ok');
    await seedDbWithScannedVersion(path, '0.36.0');

    const printer = makePrinterSpy();
    await withSqlite(
      {
        databasePath: path,
        versionCheck: { currentVersion: '0.36.0', printer },
      },
      async () => {},
    );
    strictEqual(printer.warnings.length, 0);
  });

  it('prints a single warning for an older same-major DB and continues', async () => {
    const path = freshDbPath('seam-warn-older');
    await seedDbWithScannedVersion(path, '0.28.0');

    const printer = makePrinterSpy();
    const warnSeen = new Set<string>();
    let calls = 0;
    // Open twice with the same dbPath; the warning must surface once.
    for (let i = 0; i < 2; i += 1) {
      await withSqlite(
        {
          databasePath: path,
          versionCheck: {
            currentVersion: '0.36.0',
            printer,
            warnSeen,
          },
        },
        async () => {
          calls += 1;
        },
      );
    }
    strictEqual(calls, 2, 'callback ran on both opens');
    strictEqual(printer.warnings.length, 1, 'warning printed exactly once');
    ok(
      printer.warnings[0]!.includes('0.28.0'),
      'warning names the DB version',
    );
    ok(
      printer.warnings[0]!.includes('0.36.0'),
      'warning names the current CLI version',
    );
  });

  it('refuses to open when the DB was written by a newer minor (same major)', async () => {
    const path = freshDbPath('seam-error-newer');
    await seedDbWithScannedVersion(path, '0.40.0');

    const printer = makePrinterSpy();
    let callbackRan = false;
    await rejects(
      withSqlite(
        {
          databasePath: path,
          versionCheck: { currentVersion: '0.36.0', printer },
        },
        async () => {
          callbackRan = true;
        },
      ),
      (err: unknown) => {
        ok(err instanceof DbVersionMismatchError);
        strictEqual(err.kind, 'error-newer');
        ok(err.humanMessage.includes('0.40.0'));
        ok(err.humanMessage.includes('0.36.0'));
        return true;
      },
    );
    strictEqual(callbackRan, false, 'callback MUST NOT run on a version error');
  });

  it('refuses to open when the DB was written under a different major', async () => {
    const path = freshDbPath('seam-error-major');
    await seedDbWithScannedVersion(path, '1.2.0');

    const printer = makePrinterSpy();
    let callbackRan = false;
    await rejects(
      withSqlite(
        {
          databasePath: path,
          versionCheck: { currentVersion: '0.36.0', printer },
        },
        async () => {
          callbackRan = true;
        },
      ),
      (err: unknown) => {
        ok(err instanceof DbVersionMismatchError);
        strictEqual(err.kind, 'error-major');
        ok(err.humanMessage.includes('1.2.0'));
        ok(err.humanMessage.includes('different major series'));
        ok(
          err.humanMessage.includes('1.x'),
          'hint names the DB major',
        );
        return true;
      },
    );
    strictEqual(callbackRan, false);
  });

  it('warns once on a same-version DB with a drifted schema fingerprint', async () => {
    const path = freshDbPath('seam-warn-schema');
    await seedDbWithScannedVersion(path, '0.36.0');
    // Corrupt the persisted fingerprint so the version axis stays `ok`
    // but the schema axis trips (an inline migration change with no
    // version bump). Hand-edit the column via a raw handle.
    const raw = new DatabaseSync(path);
    try {
      raw.exec("UPDATE scan_meta SET schema_fingerprint = 'stale-fingerprint'");
    } finally {
      raw.close();
    }

    const printer = makePrinterSpy();
    const warnSeen = new Set<string>();
    let calls = 0;
    for (let i = 0; i < 2; i += 1) {
      await withSqlite(
        {
          databasePath: path,
          versionCheck: { currentVersion: '0.36.0', printer, warnSeen },
        },
        async () => {
          calls += 1;
        },
      );
    }
    strictEqual(calls, 2, 'read continues on schema drift (WARN, never refuse)');
    strictEqual(printer.warnings.length, 1, 'schema-drift warning printed exactly once');
    ok(
      printer.warnings[0]!.includes('schema change'),
      'warning names the schema-drift cause',
    );
    ok(
      printer.warnings[0]!.includes('sm scan'),
      'warning points at the rebuild remediation',
    );
  });

  it('warns on a pre-fingerprint DB (schema_fingerprint column absent)', async () => {
    const path = freshDbPath('seam-warn-schema-absent');
    await seedDbWithScannedVersion(path, '0.36.0');
    // Drop the fingerprint column entirely to model a DB written by a
    // CLI that predates the fingerprint feature.
    const raw = new DatabaseSync(path);
    try {
      raw.exec(`
        CREATE TABLE scan_meta_old AS SELECT * FROM scan_meta;
        DROP TABLE scan_meta;
        CREATE TABLE scan_meta (
          id INTEGER PRIMARY KEY,
          roots_json TEXT NOT NULL,
          scanned_at INTEGER NOT NULL,
          scanned_by_name TEXT NOT NULL,
          scanned_by_version TEXT NOT NULL,
          scanned_by_spec_version TEXT NOT NULL,
          providers_json TEXT NOT NULL,
          stats_files_walked INTEGER NOT NULL,
          stats_files_skipped INTEGER NOT NULL,
          stats_duration_ms INTEGER NOT NULL,
          scan_ceiling INTEGER NOT NULL,
          scan_truncated INTEGER NOT NULL DEFAULT 0,
          max_render_nodes INTEGER NOT NULL,
          files_oversized INTEGER NOT NULL DEFAULT 0,
          oversized_files_json TEXT
        );
        INSERT INTO scan_meta (
          id, roots_json, scanned_at, scanned_by_name, scanned_by_version,
          scanned_by_spec_version, providers_json, stats_files_walked,
          stats_files_skipped, stats_duration_ms, scan_ceiling,
          scan_truncated, max_render_nodes, files_oversized, oversized_files_json
        )
        SELECT
          id, roots_json, scanned_at, scanned_by_name, scanned_by_version,
          scanned_by_spec_version, providers_json, stats_files_walked,
          stats_files_skipped, stats_duration_ms, scan_ceiling,
          scan_truncated, max_render_nodes, files_oversized, oversized_files_json
        FROM scan_meta_old;
        DROP TABLE scan_meta_old;`);
    } finally {
      raw.close();
    }

    const printer = makePrinterSpy();
    let callbackRan = false;
    await withSqlite(
      {
        databasePath: path,
        autoMigrate: false,
        versionCheck: { currentVersion: '0.36.0', printer },
      },
      async () => {
        callbackRan = true;
      },
    );
    strictEqual(callbackRan, true, 'read continues (WARN) on a pre-fingerprint DB');
    strictEqual(printer.warnings.length, 1, 'schema-drift warning printed');
  });

  it('omits the check entirely when versionCheck is not provided', async () => {
    // Seed with a NEWER version, which would normally throw. With no
    // `versionCheck` opt, the seam is the historical no-op.
    const path = freshDbPath('seam-opt-out');
    await seedDbWithScannedVersion(path, '0.40.0');

    let callbackRan = false;
    await withSqlite(
      { databasePath: path },
      async () => {
        callbackRan = true;
      },
    );
    strictEqual(callbackRan, true, 'callback ran without the check');
  });
});

describe('defensive fall-through: loadScanResult wraps enum-parse failures', () => {
  it('rewrites Invalid LinkKind from `parseLinkKind` with the version-skew hint', async () => {
    const path = freshDbPath('defensive-link-kind');
    // Migrate the schema, then plant an invalid link row by hand.
    // We bypass `persistScanResult` and reach for the raw Kysely
    // builder so the CHECK constraint on `kind` is the only thing in
    // the way; SQLite's CHECK is enforced at INSERT, so we drop the
    // constraint via PRAGMA writable_schema = ON would be heavy. Use
    // a `kind` value the CHECK accepts but the parser rejects, none
    // exists, the CHECK enum matches the parser exactly. Instead,
    // we plant an invalid confidence (REAL column, no enum CHECK
    // beyond the range CHECK), and SQLite tolerates the out-of-band
    // value at INSERT time only because the parser's enum set is
    // narrower than the column's CHECK. The cleanest path is a
    // direct sqlite3 disabling of the CHECK row, easier: insert a
    // confidence outside [0..1] would trip the column CHECK too. Use
    // the kind column with an invalid `kind` via raw SQL that drops
    // the CHECK first, which a real corrupted DB would also have to
    // do, mirrors the actual reported failure mode.
    // Apply schema via the adapter, then close.
    const seed = new SqliteStorageAdapter({ databasePath: path });
    await seed.init();
    await seed.close();
    // Drop the CHECK by recreating the table without it, then
    // re-insert a bad row. This is the operator-equivalent of a DB
    // hand-edited by an out-of-band tool.
    const raw = new DatabaseSync(path);
    try {
      raw.exec(
        `CREATE TABLE scan_links_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_path TEXT NOT NULL,
          target_path TEXT NOT NULL,
          kind TEXT NOT NULL,
          confidence REAL NOT NULL,
          sources_json TEXT NOT NULL,
          original_trigger TEXT,
          normalized_trigger TEXT,
          location_line INTEGER,
          location_column INTEGER,
          location_offset INTEGER,
          occurrences_json TEXT,
          resolved_target TEXT,
          raw TEXT
        );
        INSERT INTO scan_links_new (source_path, target_path, kind, confidence, sources_json)
          VALUES ('a.md', 'b.md', 'totally-bogus-kind', 1.0, '[]');
        DROP TABLE scan_links;
        ALTER TABLE scan_links_new RENAME TO scan_links;`,
      );
    } finally {
      raw.close();
    }

    // Now open via the adapter and trigger `loadScanResult` directly.
    const adapter = new SqliteStorageAdapter({ databasePath: path, autoMigrate: false });
    await adapter.init();
    try {
      await rejects(
        adapter.scans.load(),
        (err: unknown) => {
          ok(err instanceof Error);
          ok(
            err.message.includes('Failed to read scan rows'),
            'wraps with the version-skew framing',
          );
          ok(
            err.message.includes('Invalid LinkKind'),
            'preserves the original parser message as the cause',
          );
          ok(
            err.message.includes('totally-bogus-kind'),
            'preserves the offending value',
          );
          return true;
        },
      );
    } finally {
      await adapter.close();
    }
  });
});
