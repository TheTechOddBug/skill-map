/**
 * Split plugin **enable** (operational, config layers) from **trust**
 * (security, `config_plugins` DB store). Four layers:
 *
 *   1. Trust-store helper round-trips (set/get/list/delete/loadTrustMap).
 *   2. resolvePluginEnabled precedence (per-extension > plugin-level >
 *      installed default), config-only, with the qualified-id walk.
 *   3. makeTrustResolver (bare-id trust map + locked arm + fail-closed
 *      empty map).
 *   4. PluginLoader honours BOTH gates in order: enabled-but-untrusted =>
 *      not loaded (`untrusted: true`); trust granted => loaded; an
 *      explicit config-disable reads `disabledByConfig`, never re-reads as
 *      untrusted (the bug this split fixes).
 */

import {
  grantTrust,
  loadTrust,
  revokeTrust,
} from '../../kernel/config/plugin-trust-store.js';
import { strict as assert } from 'node:assert';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { PluginLoader, installedSpecVersion } from '../../kernel/adapters/plugin-loader.js';
import { loadSchemaValidators } from '../../kernel/adapters/schema-validators.js';
import { SqliteStorageAdapter } from '../../kernel/adapters/sqlite/index.js';
import {
  installedDefaultEnabled,
  makeEnabledResolver,
  makeTrustResolver,
  resolvePluginEnabled,
} from '../../kernel/config/plugin-resolver.js';
import type { IEffectiveConfig } from '../../kernel/config/loader.js';

let root: string;
let counter = 0;

function freshDb(label: string): string {
  counter += 1;
  const dir = join(root, `${label}-${counter}`);
  mkdirSync(dir, { recursive: true });
  return join(dir, 'skill-map.db');
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-map-plugin-overrides-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

// -----------------------------------------------------------------------------
// Trust-store helpers
// -----------------------------------------------------------------------------


/** Project root with a real `.skill-map/`, the directory the grant anchors to. */
function freshScopeRoot(name: string): string {
  const root = freshDb(name).replace(/\/\.skill-map\/[^/]+$/, '');
  mkdirSync(join(root, '.skill-map'), { recursive: true });
  return root;
}

describe('scope-lock trust store', () => {
  it('grant + revoke round-trip, scoped to the checkout', () => {
    const root = freshScopeRoot('round-trip');
    assert.equal(loadTrust(root).trusted.has('foo'), false);
    assert.equal(grantTrust(root, 'foo').ok, true);
    assert.equal(loadTrust(root).trusted.has('foo'), true);
    revokeTrust(root, 'foo');
    assert.equal(loadTrust(root).trusted.has('foo'), false);
  });

  it('grants are independent per plugin', () => {
    // The property that makes the store safe: granting one plugin must
    // never validate another. A store-wide stamp failed exactly here.
    const root = freshScopeRoot('independent');
    grantTrust(root, 'a');
    grantTrust(root, 'c');
    const { trusted } = loadTrust(root);
    assert.deepEqual([...trusted].sort(), ['a', 'c']);
    assert.equal(trusted.has('b'), false);
  });

  it('revoke is idempotent, including for an id never granted', () => {
    const root = freshScopeRoot('delete');
    grantTrust(root, 'foo');
    revokeTrust(root, 'foo');
    revokeTrust(root, 'foo');
    revokeTrust(root, 'never-existed');
    assert.equal(loadTrust(root).trusted.size, 0);
  });

  it('a grant made in another checkout does NOT verify here', () => {
    // The clone-and-scan case: the record travels, the authority does not.
    const theirs = freshScopeRoot('theirs');
    const mine = freshScopeRoot('mine');
    grantTrust(theirs, 'evil');
    cpSync(join(theirs, '.skill-map', 'scope.lock.json'),
           join(mine, '.skill-map', 'scope.lock.json'));
    const { trusted, skipped } = loadTrust(mine);
    assert.equal(trusted.has('evil'), false);
    assert.deepEqual(skipped.map((s) => s.pluginId), ['evil']);
    assert.equal(skipped[0]?.reason, 'foreign-scope');
  });
});

// -----------------------------------------------------------------------------
// resolvePluginEnabled (config-only) precedence
// -----------------------------------------------------------------------------

function cfg(plugins: IEffectiveConfig['plugins']): Pick<IEffectiveConfig, 'plugins'> {
  return { plugins };
}

describe('resolvePluginEnabled, config-only precedence', () => {
  it('default = true when the config does not mention the id', () => {
    assert.equal(resolvePluginEnabled('foo', cfg({})), true);
  });

  it('plugin-level enabled overrides the default (bare id)', () => {
    assert.equal(resolvePluginEnabled('foo', cfg({ foo: { enabled: false } })), false);
    assert.equal(resolvePluginEnabled('foo', cfg({ foo: { enabled: true } })), true);
  });

  it('qualified id: per-extension enabled wins over plugin-level and default', () => {
    // Per-extension override present -> it wins.
    assert.equal(
      resolvePluginEnabled(
        'foo/ext',
        cfg({ foo: { enabled: true, extensions: { ext: { enabled: false } } } }),
      ),
      false,
    );
    // No per-extension override -> falls back to plugin-level.
    assert.equal(
      resolvePluginEnabled('foo/ext', cfg({ foo: { enabled: false } })),
      false,
    );
    // Neither -> installed default.
    assert.equal(resolvePluginEnabled('foo/ext', cfg({})), true);
  });

  it('makeEnabledResolver curries cfg into a (id) => boolean (no DB arg)', () => {
    const resolver = makeEnabledResolver(
      cfg({ foo: { enabled: false, extensions: { only: { enabled: true } } } }),
    );
    assert.equal(resolver('foo'), false); // plugin-level off
    assert.equal(resolver('foo/only'), true); // per-extension on
    assert.equal(resolver('foo/other'), false); // falls back to plugin-level off
    assert.equal(resolver('baz'), true); // default
  });

  it('installedDefault flips the no-override fall-back (experimental / deprecated ship off)', () => {
    assert.equal(resolvePluginEnabled('exp', cfg({}), false), false);
    assert.equal(resolvePluginEnabled('ord', cfg({}), true), true);
    // An explicit enable override still wins over a `false` default.
    assert.equal(
      resolvePluginEnabled('exp', cfg({ exp: { enabled: true } }), false),
      true,
    );
    // The curried resolver forwards the installed default verbatim.
    const resolver = makeEnabledResolver(cfg({}));
    assert.equal(resolver('exp', false), false);
    assert.equal(resolver('exp', true), true);
  });

  it('installedDefaultEnabled: experimental and deprecated ship disabled', () => {
    assert.equal(installedDefaultEnabled('experimental'), false);
    assert.equal(installedDefaultEnabled('deprecated'), false);
    assert.equal(installedDefaultEnabled('beta'), true);
    assert.equal(installedDefaultEnabled('stable'), true);
    assert.equal(installedDefaultEnabled(undefined), true);
  });

  it('installedDefaultEnabled: a declared defaultEnabled override wins over stability', () => {
    // The orthogonal opt-in axis (spec base.schema.json#/defaultEnabled,
    // 2026-07-21): a STABLE extension can ship off (the sidecar writers),
    // an experimental one could ship on, and `undefined` keeps deriving
    // from stability.
    assert.equal(installedDefaultEnabled('stable', false), false);
    assert.equal(installedDefaultEnabled(undefined, false), false);
    assert.equal(installedDefaultEnabled('experimental', true), true);
    assert.equal(installedDefaultEnabled('experimental', undefined), false);
    assert.equal(installedDefaultEnabled('stable', undefined), true);
  });
});

// -----------------------------------------------------------------------------
// makeTrustResolver (the import-trust gate)
// -----------------------------------------------------------------------------

describe('makeTrustResolver', () => {
  it('trusts nothing with an empty map (fresh clone, fail-closed)', () => {
    const trust = makeTrustResolver(new Map());
    assert.equal(trust('evil'), false);
    assert.equal(trust('anything'), false);
  });

  it('trusts a plugin whose bare id carries a trusted = true row', () => {
    const trust = makeTrustResolver(new Map([['my-plugin', true]]));
    assert.equal(trust('my-plugin'), true);
    assert.equal(trust('other'), false);
  });

  it('a trusted = false row does not grant trust', () => {
    const trust = makeTrustResolver(new Map([['my-plugin', false]]));
    assert.equal(trust('my-plugin'), false);
  });

  it('always trusts an id in the threaded locked set (defense-in-depth arm)', () => {
    // Manifest-derived set threaded by the caller; the kernel bakes no
    // ids in (kernel-agnosticism sweep 2026-07-23).
    const locked = new Set(['locked-plugin']);
    assert.equal(makeTrustResolver(new Map(), locked)('locked-plugin'), true);
    assert.equal(makeTrustResolver(new Map())('locked-plugin'), false);
  });
});

// -----------------------------------------------------------------------------
// PluginLoader respects BOTH gates (enable then trust)
// -----------------------------------------------------------------------------

function writeMockPlugin(rootDir: string, id: string): string {
  const dir = join(rootDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'plugin.json'),
    JSON.stringify({
      version: '0.1.0',
      description: 'test',
      specCompat: `^${installedSpecVersion()}`,
      catalogCompat: '*',
    }),
  );
  const extDir = join(dir, 'extractors', `${id}-extractor`);
  mkdirSync(extDir, { recursive: true });
  writeFileSync(
    join(extDir, 'index.js'),
    `export default {
       version: '0.1.0',
       description: 'mock',
     };`,
  );
  return dir;
}

describe('PluginLoader, enable + trust gates', () => {
  it('enabled but untrusted => not loaded, untrusted: true, reason points at trust', async () => {
    const dir = mkdtempSync(join(root, 'loader-untrusted-'));
    writeMockPlugin(dir, 'needs-trust');
    const loader = new PluginLoader({
      searchPaths: [dir],
      validators: loadSchemaValidators(),
      specVersion: installedSpecVersion(),
      resolveEnabled: () => true, // enabled in config
      resolveImportTrust: () => false, // but not trusted on this machine
    });
    const plugins = await loader.discoverAndLoadAll();
    assert.equal(plugins.length, 1);
    const p = plugins[0]!;
    assert.equal(p.status, 'disabled');
    assert.equal(p.untrusted, true);
    assert.equal(p.extensions, undefined);
    assert.match(p.reason ?? '', /trust/);
  });

  it('enabled and trusted => loaded (status enabled, extensions imported)', async () => {
    const dir = mkdtempSync(join(root, 'loader-trusted-'));
    writeMockPlugin(dir, 'all-good');
    const loader = new PluginLoader({
      searchPaths: [dir],
      validators: loadSchemaValidators(),
      specVersion: installedSpecVersion(),
      resolveEnabled: () => true,
      resolveImportTrust: () => true,
    });
    const plugins = await loader.discoverAndLoadAll();
    assert.equal(plugins.length, 1);
    const p = plugins[0]!;
    assert.equal(p.status, 'enabled');
    assert.equal(p.untrusted, undefined);
    assert.equal(p.extensions?.length, 1);
  });

  it('config-disabled reads disabledByConfig, NOT untrusted (the split bug fixed)', async () => {
    // The enable gate runs BEFORE the trust gate: a plugin the operator
    // turned off in config reports `disabledByConfig`, never re-reads as
    // untrusted even when no trust grant exists.
    const dir = mkdtempSync(join(root, 'loader-disabled-'));
    writeMockPlugin(dir, 'opt-out');
    const loader = new PluginLoader({
      searchPaths: [dir],
      validators: loadSchemaValidators(),
      specVersion: installedSpecVersion(),
      resolveEnabled: (id) => id !== 'opt-out', // disabled in config
      resolveImportTrust: () => false, // and would be untrusted too
    });
    const plugins = await loader.discoverAndLoadAll();
    assert.equal(plugins.length, 1);
    const p = plugins[0]!;
    assert.equal(p.status, 'disabled');
    assert.notEqual(p.untrusted, true); // NOT flagged untrusted
    assert.match(p.reason ?? '', /disabled by/);
  });

  it('omitting both gates treats every plugin as enabled + trusted (back-compat)', async () => {
    const dir = mkdtempSync(join(root, 'loader-default-'));
    writeMockPlugin(dir, 'default-on');
    const loader = new PluginLoader({
      searchPaths: [dir],
      validators: loadSchemaValidators(),
      specVersion: installedSpecVersion(),
    });
    const plugins = await loader.discoverAndLoadAll();
    assert.equal(plugins.length, 1);
    assert.equal(plugins[0]!.status, 'enabled');
  });
});
