/**
 * Guard: `configureConnectionPragmas` sets `busy_timeout` (plus WAL /
 * foreign_keys / synchronous) on a connection so concurrent writers (a
 * second `sm serve`, a `sm scan` while the watcher is live, an
 * editor-triggered rescan) WAIT for a held write lock instead of failing
 * immediately with SQLITE_BUSY ("database is locked").
 *
 * Asserted on a raw `node:sqlite` connection because `busy_timeout` is
 * per-connection (NOT persisted in the file), and PRAGMA reads do not
 * round-trip through the Kysely dialect (it runs them via `exec`, yielding
 * no rows).
 */

import { describe, it, before, after } from 'node:test';
import { strictEqual } from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { configureConnectionPragmas } from '../storage-adapter.js';

let root: string;

before(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-map-busy-timeout-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

function readPragma<T>(db: DatabaseSync, name: string): T {
  return db.prepare(`PRAGMA ${name}`).get() as T;
}

describe('configureConnectionPragmas', () => {
  it('sets busy_timeout to 5000ms so contended writers wait, not fail', () => {
    const db = new DatabaseSync(join(root, 'bt.db'));
    try {
      configureConnectionPragmas(db, { wal: true });
      strictEqual(readPragma<{ timeout: number }>(db, 'busy_timeout').timeout, 5000);
    } finally {
      db.close();
    }
  });

  it('enables WAL, foreign_keys, and NORMAL synchronous', () => {
    const db = new DatabaseSync(join(root, 'others.db'));
    try {
      configureConnectionPragmas(db, { wal: true });
      strictEqual(readPragma<{ journal_mode: string }>(db, 'journal_mode').journal_mode, 'wal');
      strictEqual(readPragma<{ foreign_keys: number }>(db, 'foreign_keys').foreign_keys, 1);
      strictEqual(readPragma<{ synchronous: number }>(db, 'synchronous').synchronous, 1); // NORMAL
    } finally {
      db.close();
    }
  });

  it('skips WAL when wal:false but still sets busy_timeout', () => {
    const db = new DatabaseSync(join(root, 'nowal.db'));
    try {
      configureConnectionPragmas(db, { wal: false });
      strictEqual(readPragma<{ journal_mode: string }>(db, 'journal_mode').journal_mode, 'delete');
      strictEqual(readPragma<{ timeout: number }>(db, 'busy_timeout').timeout, 5000);
    } finally {
      db.close();
    }
  });
});
