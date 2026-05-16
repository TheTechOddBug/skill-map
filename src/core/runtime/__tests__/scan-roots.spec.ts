/**
 * Coverage for `core/runtime/scan-roots:resolveScanRoots`, the
 * spec/cli-contract.md § Scan / Effective roots resolver.
 *
 * Behaviour pinned by these tests:
 *   - Positional roots win verbatim (preserved on `ScanResult.roots`).
 *   - No positional roots → cwd + `scan.extraFolders` (resolved
 *     against cwd / ~).
 *   - Dedup across cwd + extras.
 *
 * `~/...` expansion goes through `os.homedir()` directly (per the
 * no-`$HOME`-reads cleanup). Tests redirect via `process.env.HOME`
 * to keep assertions stable across hosts.
 */

import { strict as assert } from 'node:assert';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { resolveScanRoots } from '../scan-roots.js';

const FAKE_HOME = '/home/u';
let originalHome: string | undefined;

before(() => {
  originalHome = process.env['HOME'];
  process.env['HOME'] = FAKE_HOME;
});

after(() => {
  if (originalHome === undefined) delete process.env['HOME'];
  else process.env['HOME'] = originalHome;
});

describe('resolveScanRoots, positional roots', () => {
  it('positional roots win verbatim (no normalisation)', () => {
    const r = resolveScanRoots({
      positionalRoots: ['./a', '/abs/b'],
      cwd: '/proj',
      extraFolders: ['~/extra'],
    });
    assert.deepEqual(r.roots, ['./a', '/abs/b']);
    assert.deepEqual(r.fromExtra, []);
  });
});

describe('resolveScanRoots, derived from cfg', () => {
  it('cwd alone when no extras', () => {
    const r = resolveScanRoots({
      positionalRoots: [],
      cwd: '/proj',
      extraFolders: [],
    });
    assert.deepEqual(r.roots, ['.']);
    assert.deepEqual(r.fromExtra, []);
  });

  it('cwd + extraFolders (~ + relative + absolute)', () => {
    const r = resolveScanRoots({
      positionalRoots: [],
      cwd: '/proj',
      extraFolders: ['~/notes', './sub', '/abs/path'],
    });
    assert.deepEqual(r.roots, [
      '.',
      resolve(FAKE_HOME, 'notes'),
      resolve('/proj/sub'),
      resolve('/abs/path'),
    ]);
    assert.deepEqual(r.fromExtra, [
      resolve(FAKE_HOME, 'notes'),
      resolve('/proj/sub'),
      resolve('/abs/path'),
    ]);
  });

  it('dedupes duplicate entries in extraFolders', () => {
    const r = resolveScanRoots({
      positionalRoots: [],
      cwd: '/proj',
      extraFolders: ['~/.claude', '~/.claude'],
    });
    assert.deepEqual(r.roots, ['.', resolve(FAKE_HOME, '.claude')]);
  });
});
