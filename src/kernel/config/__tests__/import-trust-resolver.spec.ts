/**
 * Coverage for `kernel/config/plugin-resolver:makeImportTrustResolver`,
 * the import-trust gate behind the H1 fix (project-local disk plugins
 * default DISABLED, only the local `config_plugins` map grants trust).
 *
 * Behaviour pinned here:
 *   - An empty override map trusts nothing (a fresh clone).
 *   - A bare `<id>: true` override trusts the plugin.
 *   - A `<id>/<ext>: true` override trusts the plugin (any enabled
 *     extension implies the code may run).
 *   - A `false` override never grants trust.
 *   - Prefix matching is boundary-safe: `foobar/x` does not trust `foo`.
 *   - Locked host ids are always trusted (defense-in-depth arm).
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { makeImportTrustResolver } from '../plugin-resolver.js';

function trust(entries: Array<[string, boolean]>): (pluginId: string) => boolean {
  return makeImportTrustResolver(new Map(entries));
}

describe('makeImportTrustResolver', () => {
  it('trusts nothing when the override map is empty (fresh clone)', () => {
    const resolve = trust([]);
    assert.equal(resolve('evil'), false);
    assert.equal(resolve('anything'), false);
  });

  it('trusts a plugin enabled by its bare id', () => {
    const resolve = trust([['my-plugin', true]]);
    assert.equal(resolve('my-plugin'), true);
    assert.equal(resolve('other'), false);
  });

  it('trusts a plugin when any of its extensions is enabled', () => {
    const resolve = trust([['my-plugin/analyzer', true]]);
    assert.equal(resolve('my-plugin'), true);
  });

  it('does not trust on a false override (bare or qualified)', () => {
    assert.equal(trust([['my-plugin', false]])('my-plugin'), false);
    assert.equal(trust([['my-plugin/analyzer', false]])('my-plugin'), false);
  });

  it('is boundary-safe: a sibling-prefixed id does not leak trust', () => {
    // `foobar/x` must NOT trust `foo` (startsWith('foo/') is false).
    const resolve = trust([['foobar/x', true]]);
    assert.equal(resolve('foo'), false);
    assert.equal(resolve('foobar'), true);
  });

  it('always trusts a locked host id (defense-in-depth arm)', () => {
    // Locked built-ins never reach the disk loader, but the arm keeps
    // the gate total even against a stale / empty override map.
    assert.equal(trust([])('core/markdown'), true);
  });
});
