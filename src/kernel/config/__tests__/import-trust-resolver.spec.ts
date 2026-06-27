/**
 * Coverage for `kernel/config/plugin-resolver`, the two-axis model:
 *
 *   - `makeTrustResolver(trustMap, trustProjectEnabled)`, the import-trust
 *     gate (security). `trustMap` is keyed by BARE plugin id; a
 *     `trusted = true` row OR the `pluginTrust.projectEnabled` opt-in OR a
 *     locked host id grants trust. An empty map + no opt-in trusts nothing
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
  projectEnabled = false,
): (pluginId: string) => boolean {
  return makeTrustResolver(new Map(entries), projectEnabled);
}

function cfg(plugins: IEffectiveConfig['plugins']): Pick<IEffectiveConfig, 'plugins'> {
  return { plugins };
}

describe('makeTrustResolver', () => {
  it('trusts nothing when the map is empty and the opt-in is off (fresh clone)', () => {
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

  it('the pluginTrust.projectEnabled opt-in trusts every plugin', () => {
    const resolve = trust([], true);
    assert.equal(resolve('a'), true);
    assert.equal(resolve('b'), true);
  });

  it('always trusts a locked host id (defense-in-depth arm)', () => {
    assert.equal(trust([])('core/markdown'), true);
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

  it('locked ids are always enabled regardless of config', () => {
    assert.equal(
      resolvePluginEnabled('core/markdown', cfg({ core: { enabled: false } })),
      true,
    );
  });
});
