/**
 * `serve.json` lifecycle helper tests (see `spec/provider-activity.md`
 * §serve.json and `spec/schemas/serve-info.schema.json`).
 *
 * The verb-side wiring (write on boot, remove in the shutdown finally)
 * is exercised manually / E2E; these tests pin the helper contract:
 * shape, atomic overwrite, best-effort failure semantics, idempotent
 * removal.
 */

import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { buildServeInfo, removeServeInfo, writeServeInfo } from '../serve-info.js';

let tmp: string;

before(() => {
  tmp = mkdtempSync(join(tmpdir(), 'skill-map-serve-info-'));
});

after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function makeInfo(port = 4242): ReturnType<typeof buildServeInfo> {
  return buildServeInfo({
    host: '127.0.0.1',
    port,
    pid: 12345,
    scopeRoot: '/home/user/project',
    smVersion: '0.67.1',
    token: 'c'.repeat(64),
    now: () => new Date('2026-06-30T12:00:00.000Z'),
  });
}

describe('buildServeInfo', () => {
  it('assembles the on-disk shape per serve-info.schema.json', () => {
    assert.deepEqual(makeInfo(), {
      schemaVersion: 1,
      host: '127.0.0.1',
      port: 4242,
      pid: 12345,
      scopeRoot: '/home/user/project',
      startedAt: '2026-06-30T12:00:00.000Z',
      smVersion: '0.67.1',
      token: 'c'.repeat(64),
    });
  });
});

describe('writeServeInfo / removeServeInfo', () => {
  it('writes, overwrites a stale copy, and removes', () => {
    const path = join(tmp, '.skill-map', 'serve.json');

    assert.equal(writeServeInfo(path, makeInfo(5000)), true);
    assert.equal(
      (JSON.parse(readFileSync(path, 'utf8')) as { port: number }).port,
      5000,
    );

    // A stale file from a hard-killed previous server is overwritten,
    // the new server is authoritative.
    assert.equal(writeServeInfo(path, makeInfo(6000)), true);
    assert.equal(
      (JSON.parse(readFileSync(path, 'utf8')) as { port: number }).port,
      6000,
    );

    removeServeInfo(path);
    assert.equal(existsSync(path), false);

    // Idempotent: removing again (or a never-written path) never throws.
    removeServeInfo(path);
  });

  it('returns false instead of throwing when the write cannot land', () => {
    // Parent "directory" is a FILE, so mkdir/rename inside it fails.
    const blocker = join(tmp, 'blocker');
    writeFileSync(blocker, 'not a directory');
    const path = join(blocker, 'nested', 'serve.json');
    assert.equal(writeServeInfo(path, makeInfo()), false);
  });
});
