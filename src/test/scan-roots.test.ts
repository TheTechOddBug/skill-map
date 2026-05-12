/**
 * Coverage for `core/runtime/scan-roots:resolveScanRoots`, the
 * spec/cli-contract.md § Scan / Effective roots resolver.
 *
 * Behaviour pinned by these tests:
 *   - Positional roots win verbatim (preserved on `ScanResult.roots`).
 *   - No positional roots → cwd + `scan.extraFolders` (resolved
 *     against cwd / ~).
 *   - Dedup across cwd + extras.
 */

import { strict as assert } from 'node:assert';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

import { resolveScanRoots } from '../core/runtime/scan-roots.js';

describe('resolveScanRoots, positional roots', () => {
  it('positional roots win verbatim (no normalisation)', () => {
    const r = resolveScanRoots({
      positionalRoots: ['./a', '/abs/b'],
      cwd: '/proj',
      homedir: '/home/u',
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
      homedir: '/home/u',
      extraFolders: [],
    });
    assert.deepEqual(r.roots, ['.']);
    assert.deepEqual(r.fromExtra, []);
  });

  it('cwd + extraFolders (~ + relative + absolute)', () => {
    const r = resolveScanRoots({
      positionalRoots: [],
      cwd: '/proj',
      homedir: '/home/u',
      extraFolders: ['~/notes', './sub', '/abs/path'],
    });
    assert.deepEqual(r.roots, [
      '.',
      resolve('/home/u/notes'),
      resolve('/proj/sub'),
      resolve('/abs/path'),
    ]);
    assert.deepEqual(r.fromExtra, [
      resolve('/home/u/notes'),
      resolve('/proj/sub'),
      resolve('/abs/path'),
    ]);
  });

  it('dedupes duplicate entries in extraFolders', () => {
    const r = resolveScanRoots({
      positionalRoots: [],
      cwd: '/proj',
      homedir: '/home/u',
      extraFolders: ['~/.claude', '~/.claude'],
    });
    assert.deepEqual(r.roots, ['.', resolve('/home/u/.claude')]);
  });
});
