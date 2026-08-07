/**
 * Determinism contract for `canonicalResolvedSettings`, the canonical
 * form behind `scan_extractor_runs.settings_hash_at_run` (third leg of
 * the incremental cache key). Two properties matter and both are pinned
 * here: equivalent bags canonicalise identically regardless of key
 * order (a re-serialised settings.json must not invalidate the whole
 * cache), and "no settings at all" is stable across every absent shape
 * (an extension without settings never invalidates).
 */

import { describe, it } from 'node:test';
import { notStrictEqual, strictEqual } from 'node:assert/strict';

import { canonicalResolvedSettings } from '../node-build.js';

describe('canonicalResolvedSettings', () => {
  it('is key-order independent', () => {
    strictEqual(
      canonicalResolvedSettings({ alpha: 1, beta: ['x', 'y'], gamma: 'z' }),
      canonicalResolvedSettings({ gamma: 'z', alpha: 1, beta: ['x', 'y'] }),
    );
  });

  it('canonicalises every absent shape to the same form', () => {
    const empty = canonicalResolvedSettings({});
    strictEqual(canonicalResolvedSettings(null), empty);
    strictEqual(canonicalResolvedSettings(undefined), empty);
  });

  it('distinguishes different values', () => {
    notStrictEqual(
      canonicalResolvedSettings({ token: 'a' }),
      canonicalResolvedSettings({ token: 'b' }),
    );
    notStrictEqual(canonicalResolvedSettings({ token: 'a' }), canonicalResolvedSettings({}));
  });
});
