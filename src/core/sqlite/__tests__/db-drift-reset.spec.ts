/**
 * Coverage for `core/sqlite/db-drift-reset:maybeResetOnDrift`, the
 * pre-1.0 schema-drift rebuild. See `spec/db-schema.md` §Schema drift
 * (pre-1.0).
 *
 * Behaviour pinned by these tests:
 *   - Missing file / absent `scan_meta` → `no-drift` (no signal).
 *   - Same `major.minor` (patch ignored) → `no-drift`, file kept.
 *   - Older / newer minor and different major → drift.
 *   - `assumeYes` and a non-TTY stdin auto-rebuild (delete the file).
 *   - A TTY stdin answering `y` rebuilds; answering `n` aborts and
 *     keeps the file.
 */

import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Readable, Writable } from 'node:stream';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { maybeResetOnDrift } from '../db-drift-reset.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sm-drift-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Create a DB file carrying `scan_meta.scanned_by_version = version`. */
function makeDbWithVersion(version: string): string {
  const p = join(dir, 'skill-map.db');
  const db = new DatabaseSync(p);
  db.exec('CREATE TABLE scan_meta (scanned_by_version TEXT NOT NULL)');
  db.prepare('INSERT INTO scan_meta (scanned_by_version) VALUES (?)').run(version);
  db.close();
  return p;
}

/** A readable that looks like a TTY and yields one answer line. */
function ttyStdin(answer: string): NodeJS.ReadableStream {
  const r = Readable.from([`${answer}\n`]) as Readable & { isTTY?: boolean };
  r.isTTY = true;
  return r;
}

function sinkStderr(): NodeJS.WritableStream {
  return new Writable({
    write(_chunk, _enc, cb) {
      cb();
    },
  });
}

describe('maybeResetOnDrift', () => {
  it('returns no-drift for a missing DB file', async () => {
    const outcome = await maybeResetOnDrift(join(dir, 'nope.db'), {
      currentVersion: '0.42.0',
      assumeYes: true,
    });
    assert.equal(outcome.kind, 'no-drift');
  });

  it('returns no-drift when scan_meta is absent (no signal)', async () => {
    const p = join(dir, 'skill-map.db');
    const db = new DatabaseSync(p);
    db.exec('CREATE TABLE other (x TEXT)');
    db.close();
    const outcome = await maybeResetOnDrift(p, { currentVersion: '0.42.0', assumeYes: true });
    assert.equal(outcome.kind, 'no-drift');
    assert.ok(existsSync(p), 'file is kept when there is no signal');
  });

  it('treats same major.minor as compatible (patch ignored)', async () => {
    const p = makeDbWithVersion('0.42.1');
    const outcome = await maybeResetOnDrift(p, { currentVersion: '0.42.9', assumeYes: true });
    assert.equal(outcome.kind, 'no-drift');
    assert.ok(existsSync(p), 'compatible cache is kept');
  });

  it('rebuilds on an older minor (assumeYes)', async () => {
    const p = makeDbWithVersion('0.41.0');
    const outcome = await maybeResetOnDrift(p, { currentVersion: '0.42.0', assumeYes: true });
    assert.equal(outcome.kind, 'reset');
    assert.ok(!existsSync(p), 'drifted cache is deleted');
  });

  it('rebuilds on a newer minor (assumeYes)', async () => {
    const p = makeDbWithVersion('0.43.0');
    const outcome = await maybeResetOnDrift(p, { currentVersion: '0.42.0', assumeYes: true });
    assert.equal(outcome.kind, 'reset');
    assert.ok(!existsSync(p));
  });

  it('rebuilds on a different major (assumeYes)', async () => {
    const p = makeDbWithVersion('1.0.0');
    const outcome = await maybeResetOnDrift(p, { currentVersion: '0.42.0', assumeYes: true });
    assert.equal(outcome.kind, 'reset');
    assert.ok(!existsSync(p));
  });

  it('auto-rebuilds without a TTY stdin (no prompt)', async () => {
    const p = makeDbWithVersion('0.41.0');
    const outcome = await maybeResetOnDrift(p, {
      currentVersion: '0.42.0',
      assumeYes: false,
      stderr: sinkStderr(),
    });
    assert.equal(outcome.kind, 'reset');
    assert.ok(!existsSync(p));
  });

  it('rebuilds when the operator confirms at the prompt', async () => {
    const p = makeDbWithVersion('0.41.0');
    const outcome = await maybeResetOnDrift(p, {
      currentVersion: '0.42.0',
      assumeYes: false,
      stdin: ttyStdin('y'),
      stderr: sinkStderr(),
    });
    assert.equal(outcome.kind, 'reset');
    assert.ok(!existsSync(p));
  });

  it('aborts and keeps the file when the operator declines', async () => {
    const p = makeDbWithVersion('0.41.0');
    const outcome = await maybeResetOnDrift(p, {
      currentVersion: '0.42.0',
      assumeYes: false,
      stdin: ttyStdin('n'),
      stderr: sinkStderr(),
    });
    assert.equal(outcome.kind, 'aborted');
    assert.ok(existsSync(p), 'declining never deletes anything');
  });
});
