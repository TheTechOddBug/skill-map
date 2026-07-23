/**
 * Coverage for `kernel/config/plugin-resolver`, the two-axis model:
 *
 *   - `makeTrustResolver(trustMap)`, the import-trust gate (security).
 *     `trustMap` is keyed by BARE plugin id; a `trusted = true` row OR a
 *     an id in the caller-threaded locked set grants trust. An empty map trusts nothing
 *     (fail-closed, a fresh clone).
 *   - `resolvePluginEnabled(id, cfg, installedDefault)`, the operational
 *     enable axis (config-only). Bare ids read the plugin-level toggle;
 *     qualified `<plugin>/<ext>` ids walk per-extension > plugin-level >
 *     installed default.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  makeTrustResolver,
  resolvePluginEnabled,
} from '../plugin-resolver.js';
import type { IEffectiveConfig } from '../loader.js';

function trust(
  entries: Array<[string, boolean]>,
): (pluginId: string) => boolean {
  return makeTrustResolver(new Map(entries));
}

function cfg(plugins: IEffectiveConfig['plugins']): Pick<IEffectiveConfig, 'plugins'> {
  return { plugins };
}

describe('makeTrustResolver', () => {
  it('trusts nothing when the map is empty (fresh clone)', () => {
    const resolve = trust([]);
    assert.equal(resolve('evil'), false);
    assert.equal(resolve('anything'), false);
  });

  it('trusts a plugin whose BARE id carries a trusted = true row', () => {
    const resolve = trust([['my-plugin', true]]);
    assert.equal(resolve('my-plugin'), true);
    assert.equal(resolve('other'), false);
  });

  it('does not trust on a trusted = false row', () => {
    assert.equal(trust([['my-plugin', false]])('my-plugin'), false);
  });

  it('keys are BARE plugin ids: a qualified entry does not match the bare lookup', () => {
    // Trust is per-plugin; the loader calls the gate with a bare id, so a
    // qualified key in the map never lines up (it should never be stored).
    const resolve = trust([['my-plugin/analyzer', true]]);
    assert.equal(resolve('my-plugin'), false);
  });

  it('always trusts an id in the threaded locked set (defense-in-depth arm)', () => {
    // The lock set is manifest-derived and THREADED by the caller
    // (kernel-agnosticism sweep 2026-07-23: the kernel bakes no ids in).
    const locked = new Set(['locked-plugin/ext']);
    assert.equal(makeTrustResolver(new Map(), locked)('locked-plugin/ext'), true);
    // Without the set (default), nothing is implicitly trusted.
    assert.equal(trust([])('locked-plugin/ext'), false);
  });
});

describe('resolvePluginEnabled, config-only enable axis', () => {
  it('bare id: default true, plugin-level override wins', () => {
    assert.equal(resolvePluginEnabled('foo', cfg({})), true);
    assert.equal(resolvePluginEnabled('foo', cfg({ foo: { enabled: false } })), false);
  });

  it('qualified id walk: per-extension > plugin-level > installed default', () => {
    // per-extension override present
    assert.equal(
      resolvePluginEnabled(
        'foo/ext',
        cfg({ foo: { enabled: true, extensions: { ext: { enabled: false } } } }),
      ),
      false,
    );
    // no per-extension, fall back to plugin-level
    assert.equal(resolvePluginEnabled('foo/ext', cfg({ foo: { enabled: false } })), false);
    // neither, installed default
    assert.equal(resolvePluginEnabled('foo/ext', cfg({})), true);
    assert.equal(resolvePluginEnabled('foo/ext', cfg({}), false), false);
  });

  it('locked ids are always enabled regardless of config (threaded set)', () => {
    const locked = new Set(['foo/ext']);
    assert.equal(
      resolvePluginEnabled('foo/ext', cfg({ foo: { enabled: false } }), true, locked),
      true,
    );
    // Without the threaded set the same config disables it.
    assert.equal(resolvePluginEnabled('foo/ext', cfg({ foo: { enabled: false } })), false);
  });
});
