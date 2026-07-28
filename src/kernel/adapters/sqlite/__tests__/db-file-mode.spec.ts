/**
 * Audit S2: the project DB and its backups landed `0o644` (world
 * readable under the common `022` umask) while every other artifact the
 * tool writes, the settings files and `.sm` sidecars, is created
 * owner-only by `writeFileAtomicExclusive`. The DB carries scanned
 * content (rendered job contents embed node bodies), so the two are
 * brought in line: `DatabaseSync` and `copyFileSync` take no mode
 * argument, so the adapter and the backup writer chmod after the fact.
 *
 * POSIX-only: `chmod` is a no-op on Windows, and the helper is
 * best-effort by contract, so asserting a mode there would be asserting
 * the filesystem, not our code.
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { SqliteStorageAdapter } from '../index.js';
import { writeBackup } from '../migrations.js';

const skipOnWindows = platform() === 'win32';

let scratch: string;

before(() => {
  scratch = mkdtempSync(join(tmpdir(), 'sm-db-file-mode-'));
});

after(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** Permission bits only, dropping the file-type bits `statSync` folds in. */
function modeOf(path: string): number {
  return statSync(path).mode & 0o777;
}

describe('database file permissions', () => {
  it('creates the DB owner-only', { skip: skipOnWindows }, async () => {
    const dbPath = join(scratch, 'create', 'skill-map.db');
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      assert.equal(modeOf(dbPath), 0o600, `expected 0600, got ${modeOf(dbPath).toString(8)}`);
    } finally {
      await adapter.close();
    }
  });

  it('writes backups owner-only', { skip: skipOnWindows }, async () => {
    const dbPath = join(scratch, 'backup', 'skill-map.db');
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    await adapter.close();

    const dest = join(scratch, 'backup', 'backups', 'copy.db');
    const written = writeBackup(dbPath, dest);
    assert.equal(written, dest);
    assert.equal(modeOf(dest), 0o600, `expected 0600, got ${modeOf(dest).toString(8)}`);
  });

  it('a `:memory:` database is a no-op, not a crash', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: ':memory:', autoBackup: false });
    await adapter.init();
    await adapter.close();
    assert.equal(writeBackup(':memory:', join(scratch, 'never.db')), null);
  });
});
