/**
 * Spec § A.12 acceptance, opt-in JSON Schema validation for plugin
 * custom storage writes. Five scenarios, mirroring the cases listed
 * in the implementation brief:
 *
 *   (a) Mode B with `schemas` declared, valid row → forwards to persist.
 *   (b) Mode B with `schemas` declared, invalid row → throws with the
 *       schema path AND the AJV error in the message.
 *   (c) Mode B without `schemas` (or table absent from the map) →
 *       permissive: forwards every shape to persist.
 *   (d) Mode A (kv) with `schema` declared: valid value → persists;
 *       invalid value → throws.
 *   (e) Plugin manifest with `storage.schemas` pointing at a missing
 *       file → loader returns `load-error` and the message names both
 *       the plugin id and the schema path.
 *
 * Tests are split between the runtime store wrapper (a–d, no plugin
 * loader needed) and the loader (e). The runtime wrapper takes the
 * compiled schema and a `persist` callback directly, so tests do not
 * need a real DB. Loader tests use the same `mkdtempSync` plugin
 * fixture pattern as `plugin-loader.test.ts`.
 */

import { describe, it, before, after } from 'node:test';
import { strictEqual, ok, match, deepStrictEqual, rejects } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  KV_SCHEMA_KEY,
  makeDedicatedStoreWrapper,
  makeKvStoreWrapper,
  makePluginStore,
} from '../plugin-store.js';
import {
  PluginLoader,
  installedSpecVersion,
} from '../plugin-loader.js';
import { loadSchemaValidators } from '../schema-validators.js';
import type { IKvStorePersist } from '../plugin-store.js';
import type {
  IDiscoveredPlugin,
  IPluginStorageSchema,
} from '../../types/plugin.js';

import { Ajv2020 } from 'ajv/dist/2020.js';

/**
 * Capture-only `IKvStorePersist` double. Only `set` matters to the
 * AJV-gate tests, so it records `[key, decodedValue]` pairs; the read
 * side stays a stub because nothing here calls it.
 */
function capturingKvPersist(sink: Array<[string, unknown]>): IKvStorePersist {
  return {
    get: () => null,
    set: (_nodeId, key, valueJson) => {
      sink.push([key, JSON.parse(valueJson)]);
    },
    delete: () => false,
    list: () => [],
  };
}

let tempRoot: string;

before(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'skill-map-a12-'));
});

after(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

function compile(schemaJson: object, schemaPath: string): IPluginStorageSchema {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const validate = ajv.compile(schemaJson) as IPluginStorageSchema['validate'];
  return { schemaPath, validate };
}

function makePluginsDir(name: string): string {
  const dir = join(tempRoot, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// The caller encodes the kind as the first key segment
// (`<kind>/<name>.<ext>`) so the source no longer declares `kind`
// (rejected at load, strict structure-as-truth); the file lands at
// `<kind>s/<name>/index.<ext>`. A key without a known-kind prefix is
// written verbatim.
function placeExtension(relPath: string): string {
  const match = /^(provider|extractor|analyzer|action|formatter|hook)\/(.+)\.(mjs|js|ts)$/u.exec(
    relPath,
  );
  if (!match) return relPath;
  const [, kind, name, ext] = match;
  return `${kind}s/${name}/index.${ext}`;
}

function writePlugin(
  rootDir: string,
  id: string,
  manifest: unknown,
  files: Record<string, string> = {},
): string {
  const pluginDir = join(rootDir, id);
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify(manifest));
  for (const [relPath, contents] of Object.entries(files)) {
    const placed = placeExtension(relPath);
    const target = join(pluginDir, placed);
    mkdirSync(join(target, '..'), { recursive: true });
    // Every extension of an on-disk plugin ships `extension.json`; the
    // loader reads it before deciding whether to import.
    if (placed !== relPath) {
      writeFileSync(
        join(target, '..', 'extension.json'),
        JSON.stringify({ version: '0.1.0', description: 'fixture extension' }),
      );
    }
    writeFileSync(target, contents);
  }
  return pluginDir;
}

function loaderFor(rootDir: string): PluginLoader {
  return new PluginLoader({
    searchPaths: [rootDir],
    validators: loadSchemaValidators(),
    specVersion: installedSpecVersion(),
  });
}

describe('A.12, plugin storage outputSchema (runtime wrapper)', () => {
  const itemsSchema = {
    type: 'object',
    required: ['name', 'count'],
    properties: {
      name: { type: 'string', minLength: 1 },
      count: { type: 'integer', minimum: 0 },
    },
    additionalProperties: false,
  };

  it('(a) Mode B with schema: valid row forwards to persist', async () => {
    const persisted: Array<[string, unknown]> = [];
    const wrapper = makeDedicatedStoreWrapper({
      pluginId: 'demo',
      schemas: { items: compile(itemsSchema, 'schemas/items.schema.json') },
      persist: (table, row) => {
        persisted.push([table, row]);
      },
    });

    await wrapper.write('items', { name: 'alpha', count: 3 });
    deepStrictEqual(persisted, [['items', { name: 'alpha', count: 3 }]]);
  });

  it('(b) Mode B with schema: invalid row throws naming schema path + AJV error', async () => {
    const persisted: Array<[string, unknown]> = [];
    const wrapper = makeDedicatedStoreWrapper({
      pluginId: 'demo',
      schemas: { items: compile(itemsSchema, 'schemas/items.schema.json') },
      persist: (table, row) => {
        persisted.push([table, row]);
      },
    });

    await rejects(
      () => wrapper.write('items', { name: 'beta' }), // missing required `count`
      (err: Error) => {
        match(err.message, /demo/);
        match(err.message, /items/);
        match(err.message, /schemas\/items\.schema\.json/);
        match(err.message, /count|required/);
        return true;
      },
    );
    strictEqual(persisted.length, 0, 'persist must NOT be called on validation failure');
  });

  it('(c) Mode B without schemas (or table absent): permissive, any shape forwards', async () => {
    const persisted: Array<[string, unknown]> = [];

    // No `schemas` map at all.
    const noMap = makeDedicatedStoreWrapper({
      pluginId: 'demo',
      schemas: undefined,
      persist: (table, row) => {
        persisted.push([table, row]);
      },
    });
    await noMap.write('whatever', { anything: 'goes' });
    await noMap.write('whatever', 42 as unknown);

    // Map present but the table is absent from it.
    const sparse = makeDedicatedStoreWrapper({
      pluginId: 'demo',
      schemas: { items: compile(itemsSchema, 'schemas/items.schema.json') },
      persist: (table, row) => {
        persisted.push([table, row]);
      },
    });
    // `history` is not in the schemas map → permissive.
    await sparse.write('history', { freeform: true, junk: [1, 2, 3] });
    // `items` IS in the schemas map → still validated; this row would
    // throw if invalid. We pass a valid row to keep the permissive
    // assertion pure.
    await sparse.write('items', { name: 'gamma', count: 1 });

    strictEqual(persisted.length, 4);
  });

  it('(d) Mode A with schema: valid value persists, invalid throws', async () => {
    const valueSchema = {
      type: 'object',
      required: ['enabled'],
      properties: { enabled: { type: 'boolean' } },
      additionalProperties: false,
    };

    const persisted: Array<[string, unknown]> = [];
    const wrapper = makeKvStoreWrapper({
      pluginId: 'demo',
      schema: compile(valueSchema, 'schemas/kv-value.schema.json'),
      persist: capturingKvPersist(persisted),
    });

    await wrapper.set('feature.x', { enabled: true });
    deepStrictEqual(persisted, [['feature.x', { enabled: true }]]);

    await rejects(
      () => wrapper.set('feature.x', { enabled: 'yes' } as unknown), // boolean expected
      (err: Error) => {
        match(err.message, /demo/);
        match(err.message, /feature\.x/);
        match(err.message, /kv-value\.schema\.json/);
        return true;
      },
    );
    strictEqual(persisted.length, 1, 'persist NOT called on validation failure');
  });

  it('makePluginStore picks the right wrapper from the discovered plugin', async () => {
    const valueSchema = compile(
      { type: 'object', required: ['n'], properties: { n: { type: 'integer' } } },
      'schemas/kv.json',
    );

    const kvPlugin: IDiscoveredPlugin = {
      path: '/plugins/kv',
      id: 'kvp',
      status: 'enabled',
      manifest: {
        version: '1.0.0',
        description: 'test',
        specCompat: '>=0.0.0',
        catalogCompat: '*',
        storage: { mode: 'kv', schema: 'schemas/kv.json' },
      },
      storageSchemas: { [KV_SCHEMA_KEY]: valueSchema },
    };

    const persisted: Array<[string, unknown]> = [];
    const wrapper = makePluginStore({
      plugin: kvPlugin,
      persistKv: capturingKvPersist(persisted),
    });
    ok(wrapper, 'wrapper present for kv plugin with persistKv');
    if (wrapper && 'set' in wrapper) {
      await wrapper.set('a', { n: 7 });
      deepStrictEqual(persisted, [['a', { n: 7 }]]);
    }
  });
});

describe('A.12, loader load-error on missing / bad schema files', () => {
  // Helper to write a minimal extension that satisfies the loader.
  const minimalExtractorSrc = `
    export default {
      scope: 'body',
      extract() {},
    };
  `;

  it('(e) storage.schemas points at a missing file → load-error', async () => {
    const root = makePluginsDir('a12-missing-schema');
    writePlugin(
      root,
      'has-bad-schema',
      {
        // id from folder
        version: '1.0.0',
        description: 'test',
        specCompat: '>=0.0.0',

        catalogCompat: '*',
        storage: {
          mode: 'dedicated',
          tables: ['items'],
          migrations: ['migrations/001_init.sql'],
          schemas: {
            items: 'schemas/missing.schema.json',
          },
        },
      },
      {
        'extractor/x.mjs': minimalExtractorSrc,
        'migrations/001_init.sql': 'CREATE TABLE plugin_has_bad_schema_items (id TEXT PRIMARY KEY);',
      },
    );

    const result = await loaderFor(root).discoverAndLoadAll();
    strictEqual(result.length, 1);
    strictEqual(result[0]?.status, 'load-error');
    match(result[0]!.reason!, /has-bad-schema/);
    match(result[0]!.reason!, /items/);
    match(result[0]!.reason!, /missing\.schema\.json/);
  });

  it('storage.schemas points at unparseable JSON → load-error', async () => {
    const root = makePluginsDir('a12-bad-json-schema');
    writePlugin(
      root,
      'bad-json-schema',
      {
        // id from folder
        version: '1.0.0',
        description: 'test',
        specCompat: '>=0.0.0',

        catalogCompat: '*',
        storage: {
          mode: 'dedicated',
          tables: ['items'],
          migrations: ['migrations/001_init.sql'],
          schemas: { items: 'schemas/items.schema.json' },
        },
      },
      {
        'extractor/x.mjs': minimalExtractorSrc,
        'migrations/001_init.sql': 'CREATE TABLE plugin_bad_json_schema_items (id TEXT PRIMARY KEY);',
        'schemas/items.schema.json': '{ this is not json }',
      },
    );

    const result = await loaderFor(root).discoverAndLoadAll();
    strictEqual(result[0]?.status, 'load-error');
    match(result[0]!.reason!, /bad-json-schema/);
    match(result[0]!.reason!, /items\.schema\.json/);
  });

  it('storage.schema (Mode A) green path attaches storageSchemas with the KV sentinel', async () => {
    const root = makePluginsDir('a12-kv-ok');
    writePlugin(
      root,
      'kv-validated',
      {
        // id from folder
        version: '1.0.0',
        description: 'test',
        specCompat: '>=0.0.0',

        catalogCompat: '*',
        storage: { mode: 'kv', schema: 'schemas/kv.json' },
      },
      {
        'extractor/x.mjs': minimalExtractorSrc,
        'schemas/kv.json': JSON.stringify({
          type: 'object',
          required: ['k'],
          properties: { k: { type: 'string' } },
          additionalProperties: false,
        }),
      },
    );

    const result = await loaderFor(root).discoverAndLoadAll();
    strictEqual(result[0]?.status, 'enabled');
    ok(result[0]?.storageSchemas, 'storageSchemas populated when schema declared');
    ok(result[0]!.storageSchemas![KV_SCHEMA_KEY], 'KV sentinel present');
    strictEqual(
      result[0]!.storageSchemas![KV_SCHEMA_KEY]!.schemaPath,
      'schemas/kv.json',
    );
  });

  it('storage without schema declarations stays permissive (storageSchemas absent)', async () => {
    const root = makePluginsDir('a12-permissive');
    writePlugin(
      root,
      'no-schema',
      {
        // id from folder
        version: '1.0.0',
        description: 'test',
        specCompat: '>=0.0.0',

        catalogCompat: '*',
        storage: { mode: 'kv' },
      },
      { 'extractor/x.mjs': minimalExtractorSrc },
    );

    const result = await loaderFor(root).discoverAndLoadAll();
    strictEqual(result[0]?.status, 'enabled');
    strictEqual(result[0]?.storageSchemas, undefined);
  });
});
