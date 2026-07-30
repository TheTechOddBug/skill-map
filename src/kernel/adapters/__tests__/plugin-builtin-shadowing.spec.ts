/**
 * Audit L3: a drop-in plugin directory named after a BUILT-IN plugin
 * used to load normally.
 *
 * Built-ins share the flat `pluginId` namespace that keys several
 * kernel surfaces (most sharply `ctx.store`, see
 * `core/runtime/plugin-stores.ts`, which is a `Map<pluginId, store>`)
 * but they never appear in `IDiscoveredPlugin[]`, so `applyIdCollisions`
 * structurally cannot see them. A directory named `core` would
 * therefore own the `core` KV slot with no diagnostic at all: a
 * confused deputy waiting for the first built-in that adopts KV
 * storage.
 *
 * `applyBuiltInIdShadowing` closes it by blocking such a plugin with
 * the spec-frozen `id-collision` status (the same status two colliding
 * drop-ins get, and the only one the plugins-registry schema offers for
 * "this id is taken").
 *
 * Coverage:
 *   - a shadowing plugin loads with status `id-collision`, no
 *     extensions, and a reason naming the shadowing;
 *   - the block survives the full `discoverAndLoadAll` pipeline;
 *   - a normally-named neighbour in the same root is untouched;
 *   - `buildPluginStores` therefore hands it no `ctx.store` slot;
 *   - drift guard: `BUILT_IN_PLUGIN_IDS` matches the live `builtIns()`
 *     registry, so adding a built-in plugin without updating the frozen
 *     list fails here instead of silently reopening the lane.
 */

import { after, before, describe, it } from 'node:test';
import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PluginLoader, installedSpecVersion } from '../plugin-loader.js';
import { loadSchemaValidators } from '../schema-validators.js';
import {
  BUILT_IN_PLUGIN_IDS,
  applyBuiltInIdShadowing,
} from '../plugin-loader/id-utils.js';
import { builtIns } from '../../../plugins/built-ins.js';
import { buildPluginStores } from '../../../core/runtime/plugin-stores.js';
import type { IDiscoveredPlugin } from '../../ports/plugin-loader.js';
import type { StoragePort } from '../../ports/storage.js';

let tempRoot: string;

before(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'skill-map-shadow-'));
});

after(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

const MANIFEST = {
  version: '1.0.0',
  description: 'fixture',
  specCompat: '>=0.0.0',
  catalogCompat: '*',
  storage: { mode: 'kv' as const },
};

const EXTRACTOR_SRC = `
  export default {
    scope: 'body',
    extract() {},
  };
`;

/** Lay down a minimal loadable plugin under `<root>/<id>/`. */
function writePlugin(rootDir: string, id: string): void {
  const pluginDir = join(rootDir, id);
  const extDir = join(pluginDir, 'extractors', 'probe');
  mkdirSync(extDir, { recursive: true });
  writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify(MANIFEST));
  writeFileSync(join(extDir, 'index.mjs'), EXTRACTOR_SRC);
  writeFileSync(
    join(extDir, 'extension.json'),
    JSON.stringify({ version: '0.1.0', description: 'fixture extension' }),
  );
}

function rootWith(label: string, ids: readonly string[]): string {
  const rootDir = join(tempRoot, label);
  mkdirSync(rootDir, { recursive: true });
  for (const id of ids) writePlugin(rootDir, id);
  return rootDir;
}

function loaderFor(rootDir: string): PluginLoader {
  return new PluginLoader({
    searchPaths: [rootDir],
    validators: loadSchemaValidators(),
    specVersion: installedSpecVersion(),
  });
}

describe('built-in id shadowing', () => {
  it('blocks a drop-in directory named after a built-in, keeping a neighbour loadable', async () => {
    const rootDir = rootWith('shadow-core', ['core', 'honest-neighbour']);
    const plugins = await loaderFor(rootDir).discoverAndLoadAll();

    const shadow = plugins.find((p) => p.id === 'core');
    ok(shadow, 'the shadowing plugin is still reported, not dropped silently');
    strictEqual(shadow.status, 'id-collision');
    strictEqual(shadow.extensions, undefined, 'its extensions are stripped, they never run');
    ok(shadow.reason?.includes('shadows the built-in'), shadow.reason ?? '(no reason)');
    ok(shadow.manifest, 'the manifest is kept for diagnostics');

    const neighbour = plugins.find((p) => p.id === 'honest-neighbour');
    ok(neighbour);
    strictEqual(neighbour.status, 'enabled', 'an ordinary id is unaffected');
    ok((neighbour.extensions?.length ?? 0) > 0);
  });

  it('blocks EVERY reserved id, not just the one that motivated the guard', () => {
    const discovered: IDiscoveredPlugin[] = [...BUILT_IN_PLUGIN_IDS].map((id) => ({
      path: `/plugins/${id}`,
      id,
      status: 'enabled',
      manifest: MANIFEST,
      extensions: [],
    }));
    const guarded = applyBuiltInIdShadowing(discovered);
    deepStrictEqual(
      guarded.map((p) => p.status),
      guarded.map(() => 'id-collision'),
    );
  });

  it('leaves a plugin whose manifest never parsed alone (its id is untrusted)', () => {
    // Same posture as `applyIdCollisions`: without a manifest the id is
    // a path fall-back hint, and "rename your plugin" is bad guidance
    // for a plugin whose real problem is broken JSON.
    const discovered: IDiscoveredPlugin[] = [
      { path: '/plugins/core', id: 'core', status: 'invalid-manifest', reason: 'bad json' },
    ];
    const guarded = applyBuiltInIdShadowing(discovered);
    strictEqual(guarded[0]?.status, 'invalid-manifest');
  });

  it('returns the input array untouched when nothing shadows', () => {
    const discovered: IDiscoveredPlugin[] = [
      { path: '/plugins/mine', id: 'mine', status: 'enabled', manifest: MANIFEST },
    ];
    strictEqual(applyBuiltInIdShadowing(discovered), discovered, 'no allocation on the hot path');
  });

  it('denies the shadowing plugin a ctx.store slot', async () => {
    const rootDir = rootWith('shadow-store', ['core']);
    const plugins = await loaderFor(rootDir).discoverAndLoadAll();
    // The port is never touched: `buildPluginStores` skips non-enabled
    // plugins before it reaches persistence.
    const stores = buildPluginStores({
      discovered: plugins,
      port: {} as unknown as StoragePort,
    });
    strictEqual(stores.size, 0, 'a blocked plugin owns no KV namespace');
  });
});

describe('BUILT_IN_PLUGIN_IDS drift guard', () => {
  it('matches the plugin ids the generated built-ins registry actually stamps', () => {
    const live = new Set<string>();
    const registry = builtIns();
    for (const bucket of Object.values(registry)) {
      if (!Array.isArray(bucket)) continue;
      for (const ext of bucket as { pluginId?: string }[]) {
        if (ext.pluginId) live.add(ext.pluginId);
      }
    }
    ok(live.size > 0, 'sanity: the registry exposes extensions');
    deepStrictEqual(
      [...live].sort(),
      [...BUILT_IN_PLUGIN_IDS].sort(),
      'a built-in plugin was added or renamed without updating the frozen id set in ' +
        'kernel/adapters/plugin-loader/id-utils.ts, which would reopen the shadowing lane',
    );
  });
});
