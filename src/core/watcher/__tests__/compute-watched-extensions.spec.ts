/**
 * `computeWatchedExtensions` cold-start union, the real wiring that scopes
 * the live watcher's chokidar watch set. Asserted against the REAL built-in
 * registry (not synthetic providers) so a regression that dropped codex's
 * `.toml` or the appended `.sm` sidecar from the watch set is caught.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { computeWatchedExtensions } from '../runtime.js';
import type { IProvider } from '../../../kernel/extensions/index.js';

describe('computeWatchedExtensions', () => {
  it('over the real built-in registry, the union covers .md, .toml, and .sm', () => {
    const exts = computeWatchedExtensions(false, []);
    assert.ok(exts, 'gate is enabled (no built-in ships walk())');
    for (const e of ['.md', '.toml', '.sm']) {
      assert.ok(exts.includes(e), `union should include ${e}; got ${JSON.stringify(exts)}`);
    }
  });

  it('with no built-ins and no plugins, only the .sm sidecar remains', () => {
    assert.deepEqual(computeWatchedExtensions(true, []), ['.sm']);
  });

  it('folds a plugin provider read extension into the union (deduped with .sm)', () => {
    const exts = computeWatchedExtensions(true, [
      { read: { extensions: ['.mdx'], parser: 'frontmatter-yaml' } },
    ]);
    assert.deepEqual(exts?.sort(), ['.mdx', '.sm']);
  });

  it('disables the gate (returns undefined) when a provider ships a custom walk()', () => {
    // walk() wins over read and can discover arbitrary extensions, so the
    // gate cannot be scoped; the watcher must fall back to watching all.
    const walkProvider = { walk() {} } as unknown as Pick<IProvider, 'read' | 'walk'>;
    assert.equal(computeWatchedExtensions(true, [walkProvider]), undefined);
    assert.equal(computeWatchedExtensions(false, [walkProvider]), undefined);
  });
});
