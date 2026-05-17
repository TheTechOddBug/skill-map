/**
 * Coverage for `core/runtime/scan-roots:resolveScanRoots`, the
 * spec/cli-contract.md § Scan / Effective roots resolver.
 *
 * Behaviour pinned by these tests:
 *   - Positional roots win verbatim (preserved on `ScanResult.roots`).
 *   - No positional roots → `['.']` (cwd only).
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { resolveScanRoots } from '../scan-roots.js';

describe('resolveScanRoots, positional roots', () => {
  it('positional roots win verbatim (no normalisation)', () => {
    const r = resolveScanRoots({
      positionalRoots: ['./a', '/abs/b'],
    });
    assert.deepEqual(r, ['./a', '/abs/b']);
  });
});

describe('resolveScanRoots, default', () => {
  it('cwd alone when no positional roots', () => {
    const r = resolveScanRoots({ positionalRoots: [] });
    assert.deepEqual(r, ['.']);
  });
});
