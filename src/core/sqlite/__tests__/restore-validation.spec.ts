/**
 * Coverage for `core/sqlite/restore-validation:validateRestorableDb`, the
 * header + schema-version gate `sm db restore` runs before previewing or
 * swapping a backup (spec § Database, `--dry-run` validates "existence,
 * header, schema version").
 *
 * Behaviour pinned by these tests:
 *   - A non-SQLite file (missing the magic header) → `not-sqlite`.
 *   - A zero-length file (a valid empty DB) → ok.
 *   - A valid DB with no `scan_meta` row → ok (no version signal).
 *   - A valid DB written by a NEWER minor → `version-newer`.
 *   - A valid DB written by a DIFFERENT major → `version-major`.
 *   - A valid DB written by an OLDER minor → ok (a warn, not a refusal).
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { validateRestorableDb } from '../restore-validation.js';

const CURRENT = '1.4.0';

let dir: string;
let counter = 0;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sm-restore-val-'));
  counter = 0;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Create a valid SQLite DB; with a `scan_meta` row when `version` is set. */
function makeDb(version?: string): string {
  counter += 1;
  const p = join(dir, `src-${counter}.db`);
  const db = new DatabaseSync(p);
  db.exec('CREATE TABLE noop (x)');
  if (version !== undefined) {
    db.exec('CREATE TABLE scan_meta (scanned_by_version TEXT NOT NULL)');
    db.prepare('INSERT INTO scan_meta (scanned_by_version) VALUES (?)').run(version);
  }
  db.close();
  return p;
}

describe('validateRestorableDb', () => {
  it('rejects a non-SQLite file with reason not-sqlite', async () => {
    const p = join(dir, 'not-a-db.txt');
    writeFileSync(p, 'plain text, definitely not a database');
    assert.deepEqual(await validateRestorableDb(p, CURRENT), {
      ok: false,
      reason: 'not-sqlite',
    });
  });

  it('accepts a zero-length file (a valid empty SQLite DB)', async () => {
    const p = join(dir, 'empty.db');
    writeFileSync(p, '');
    assert.deepEqual(await validateRestorableDb(p, CURRENT), { ok: true });
  });

  it('accepts a valid DB with no scan_meta row (no version signal)', async () => {
    assert.deepEqual(await validateRestorableDb(makeDb(), CURRENT), { ok: true });
  });

  it('accepts a DB written by the same version', async () => {
    assert.deepEqual(await validateRestorableDb(makeDb(CURRENT), CURRENT), { ok: true });
  });

  it('accepts a DB written by an OLDER minor (a warn, not a refusal)', async () => {
    assert.deepEqual(await validateRestorableDb(makeDb('1.2.0'), CURRENT), { ok: true });
  });

  it('refuses a DB written by a NEWER minor with reason version-newer', async () => {
    assert.deepEqual(await validateRestorableDb(makeDb('1.5.0'), CURRENT), {
      ok: false,
      reason: 'version-newer',
      dbVersion: '1.5.0',
      currentVersion: CURRENT,
    });
  });

  it('refuses a DB written by a DIFFERENT major with reason version-major', async () => {
    assert.deepEqual(await validateRestorableDb(makeDb('2.0.0'), CURRENT), {
      ok: false,
      reason: 'version-major',
      dbVersion: '2.0.0',
      currentVersion: CURRENT,
    });
  });
});
