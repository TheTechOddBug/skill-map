/**
 * Coverage for `core/sqlite/schema-fingerprint`:
 *
 *   - `schemaFingerprint()` is STABLE across calls and CHANGES when the
 *     migration DDL mutates (the whole point: an inline `001_initial.sql`
 *     edit must move the fingerprint with no version bump).
 *   - `readStoredFingerprint()` is DEFENSIVE: a missing file / `:memory:`
 *     / a `scan_meta` table without the `schema_fingerprint` column / a
 *     migrated-but-never-scanned DB are each classified without throwing.
 *   - `classifyFingerprint()` maps those reads to ok / no-meta / drift.
 *
 * File-based DBs via `mkdtempSync` (per `feedback_sqlite_in_memory_workaround`).
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, it } from 'node:test';

import type { IMigrationFile } from '../../../kernel/adapters/sqlite/migrations.js';
import {
  classifyFingerprint,
  readStoredFingerprint,
  resetSchemaFingerprintMemoForTests,
  schemaFingerprint,
} from '../schema-fingerprint.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sm-fp-'));
  resetSchemaFingerprintMemoForTests();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Write a `.sql` file in `dir` and return the `IMigrationFile` descriptor. */
function migrationFile(version: number, description: string, sql: string): IMigrationFile {
  const filePath = join(dir, `${String(version).padStart(3, '0')}_${description}.sql`);
  writeFileSync(filePath, sql, 'utf8');
  return { version, description, filePath };
}

describe('schemaFingerprint', () => {
  it('is stable across calls for the bundled migrations', () => {
    const a = schemaFingerprint();
    const b = schemaFingerprint();
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{64}$/, 'hex sha256');
  });

  it('changes when the migration DDL mutates', () => {
    const before = [migrationFile(1, 'initial', 'CREATE TABLE a (x TEXT);')];
    const fpBefore = schemaFingerprint(before);
    // Mutate the SAME logical file (inline column add, greenfield posture).
    const after = [migrationFile(1, 'initial', 'CREATE TABLE a (x TEXT, y TEXT);')];
    const fpAfter = schemaFingerprint(after);
    assert.notEqual(fpBefore, fpAfter, 'an inline DDL edit moves the fingerprint');
  });

  it('is stable for identical DDL regardless of injection', () => {
    const files = [migrationFile(1, 'initial', 'CREATE TABLE a (x TEXT);')];
    assert.equal(schemaFingerprint(files), schemaFingerprint(files));
  });

  it('differs when a new migration file is added', () => {
    const one = [migrationFile(1, 'initial', 'CREATE TABLE a (x TEXT);')];
    const fpOne = schemaFingerprint(one);
    const two = [
      migrationFile(1, 'initial', 'CREATE TABLE a (x TEXT);'),
      migrationFile(2, 'add_b', 'CREATE TABLE b (y TEXT);'),
    ];
    assert.notEqual(fpOne, schemaFingerprint(two));
  });
});

describe('readStoredFingerprint (defensive)', () => {
  it('returns no-meta for :memory:', () => {
    assert.deepEqual(readStoredFingerprint(':memory:'), { kind: 'no-meta' });
  });

  it('returns no-meta for a missing file', () => {
    assert.deepEqual(readStoredFingerprint(join(dir, 'nope.db')), { kind: 'no-meta' });
  });

  it('returns no-meta when the scan_meta table is absent (no throw)', () => {
    const p = join(dir, 'other.db');
    const db = new DatabaseSync(p);
    db.exec('CREATE TABLE other (x TEXT)');
    db.close();
    assert.deepEqual(readStoredFingerprint(p), { kind: 'no-meta' });
  });

  it('returns no-meta for a migrated-but-never-scanned DB (column present, no row)', () => {
    const p = join(dir, 'empty.db');
    const db = new DatabaseSync(p);
    db.exec(
      'CREATE TABLE scan_meta (scanned_by_version TEXT NOT NULL, schema_fingerprint TEXT)',
    );
    db.close();
    assert.deepEqual(readStoredFingerprint(p), { kind: 'no-meta' });
  });

  it('returns absent when scan_meta has a row but the column is missing (pre-fingerprint DB)', () => {
    const p = join(dir, 'pre-fp.db');
    const db = new DatabaseSync(p);
    db.exec('CREATE TABLE scan_meta (scanned_by_version TEXT NOT NULL)');
    db.prepare('INSERT INTO scan_meta (scanned_by_version) VALUES (?)').run('0.42.0');
    db.close();
    assert.deepEqual(readStoredFingerprint(p), { kind: 'absent' });
  });

  it('returns absent when the column exists but the value is NULL', () => {
    const p = join(dir, 'null-fp.db');
    const db = new DatabaseSync(p);
    db.exec(
      'CREATE TABLE scan_meta (scanned_by_version TEXT NOT NULL, schema_fingerprint TEXT)',
    );
    db.prepare('INSERT INTO scan_meta (scanned_by_version) VALUES (?)').run('0.42.0');
    db.close();
    assert.deepEqual(readStoredFingerprint(p), { kind: 'absent' });
  });

  it('returns the stored value when present', () => {
    const p = join(dir, 'value-fp.db');
    const db = new DatabaseSync(p);
    db.exec(
      'CREATE TABLE scan_meta (scanned_by_version TEXT NOT NULL, schema_fingerprint TEXT)',
    );
    db.prepare(
      'INSERT INTO scan_meta (scanned_by_version, schema_fingerprint) VALUES (?, ?)',
    ).run('0.42.0', 'abc123');
    db.close();
    assert.deepEqual(readStoredFingerprint(p), { kind: 'value', fingerprint: 'abc123' });
  });
});

describe('classifyFingerprint', () => {
  it('is no-meta for a never-scanned DB (silent, NOT drift)', () => {
    const p = join(dir, 'empty.db');
    const db = new DatabaseSync(p);
    db.exec(
      'CREATE TABLE scan_meta (scanned_by_version TEXT NOT NULL, schema_fingerprint TEXT)',
    );
    db.close();
    assert.equal(classifyFingerprint(p).kind, 'no-meta');
  });

  it('is drift when the column is absent on a populated row', () => {
    const p = join(dir, 'pre-fp.db');
    const db = new DatabaseSync(p);
    db.exec('CREATE TABLE scan_meta (scanned_by_version TEXT NOT NULL)');
    db.prepare('INSERT INTO scan_meta (scanned_by_version) VALUES (?)').run('0.42.0');
    db.close();
    assert.equal(classifyFingerprint(p).kind, 'drift');
  });

  it('is drift when the stored fingerprint differs from the bundled one', () => {
    const p = join(dir, 'mismatch.db');
    const db = new DatabaseSync(p);
    db.exec(
      'CREATE TABLE scan_meta (scanned_by_version TEXT NOT NULL, schema_fingerprint TEXT)',
    );
    db.prepare(
      'INSERT INTO scan_meta (scanned_by_version, schema_fingerprint) VALUES (?, ?)',
    ).run('0.42.0', 'not-the-real-fingerprint');
    db.close();
    assert.equal(classifyFingerprint(p).kind, 'drift');
  });

  it('is ok when the stored fingerprint equals the bundled one', () => {
    const p = join(dir, 'match.db');
    const db = new DatabaseSync(p);
    db.exec(
      'CREATE TABLE scan_meta (scanned_by_version TEXT NOT NULL, schema_fingerprint TEXT)',
    );
    db.prepare(
      'INSERT INTO scan_meta (scanned_by_version, schema_fingerprint) VALUES (?, ?)',
    ).run('0.42.0', schemaFingerprint());
    db.close();
    assert.equal(classifyFingerprint(p).kind, 'ok');
  });
});
