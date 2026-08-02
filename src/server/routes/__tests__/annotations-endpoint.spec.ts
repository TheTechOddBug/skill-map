/**
 * Step 9.6.6 (BFF half), `GET /api/annotations/registered` integration tests.
 *
 * Exercises the route against the real composition root. Per Step 9.6
 * review-queue R14, `loadPluginRuntime` now honours the BFF's
 * `runtimeContext` override, so a tempdir cwd carrying synthetic
 * plugins under `<tempdir>/.skill-map/plugins/<id>/` is enough to
 * drive the populated catalog through `createServer()` end-to-end,
 * no `createApp()` bypass needed.
 *
 * Surfaces:
 *
 *   1. Empty catalog, boot with `noPlugins: true`. Confirms the
 *      composition root threads a fresh kernel through `IAppDeps.kernel`
 *      and the route returns the canonical envelope shape with
 *      `items: []`.
 *
 *   2. Populated catalog, boot with `noPlugins: false` against a
 *      tempdir cwd whose `.skill-map/plugins/` carries two synthetic
 *      plugins (one `namespaced` contribution, one `root + exclusive`).
 *      `runtimeContext: { cwd: <tempdir>, ... }` steers plugin
 *      discovery into the fixture; the planted contributions surface
 *      in the catalog with their full shape.
 *
 *   3. Mutation guard, handler returns a fresh items array each call,
 *      so a downstream mutation cannot pollute subsequent requests.
 *      Exercised against the populated boot.
 *
 *   4. Envelope schema validation, empty + populated responses
 *      validate against `spec/schemas/api/rest-envelope.schema.json`'s
 *      `'annotations.registered'` variant (R7 closed at 9.6.7).
 */

import { grantTrust } from '../../../kernel/config/plugin-trust-store.js';
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { Ajv2020 } from 'ajv/dist/2020.js';

import {
  createServer,
  type IServerOptions,
  type IServerHandle,
} from '../../index.js';
import { withSqlite } from '../../../core/sqlite/with-sqlite.js';
import { compileEnvelopeValidator } from './helpers/envelope-validator.js';

interface IRegisteredAnnotationKeyWire {
  pluginId: string;
  key: string;
  location: 'namespaced' | 'root';
  ownership: 'exclusive' | 'shared';
  schema: Record<string, unknown>;
}

interface IAnnotationsEnvelope {
  schemaVersion: string;
  kind: string;
  items: IRegisteredAnnotationKeyWire[];
  counts: { total: number };
}

let tmp: string;
let dbPath: string;
/**
 * Tempdir whose `.skill-map/plugins/` carries the two synthetic
 * contribution-bearing plugins. Used as `runtimeContext.cwd` for
 * every populated-catalog boot. Kept separate from `tmp` so the
 * empty-catalog boot can point at a clean tempdir without the
 * planted fixtures.
 */
let populatedRoot: string;

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'skill-map-annot-endpoint-'));
  dbPath = join(tmp, 'primed.db');

  // Plant two plugins under the populated tempdir. Each plugin's
  // single extractor advertises an `annotationContributions` map; the
  // loader (post-R14) walks `<populatedRoot>/.skill-map/plugins/`
  // because `runtimeContext.cwd` overrides the default `process.cwd()`
  // resolution.
  populatedRoot = mkdtempSync(join(tmpdir(), 'skill-map-annot-populated-'));
  const pluginsDir = join(populatedRoot, '.skill-map', 'plugins');
  mkdirSync(pluginsDir, { recursive: true });
  // Structure-as-truth: the annotation key IS the extension's folder
  // name. We plant the extensions under the desired key.
  plantContributionPlugin(pluginsDir, 'reviewer', 'lastReviewedAt', {
    schema: { type: 'string' },
  });
  plantContributionPlugin(pluginsDir, 'governance', 'governance', {
    schema: { type: 'object' },
    location: 'root',
    ownership: 'exclusive',
  });
  // Post-H1 import-trust gate: project-local plugins are discovered but
  // their code stays dormant until locally trusted. Grant trust (the
  // in-test equivalent of `sm plugins enable`) so the populated boot
  // actually imports both extensions and surfaces their contributions.
  // The gate reads `config_plugins` from the default project DB under
  // `runtimeContext.cwd` (`populatedRoot`), so the override lands there.
  await trustProjectPlugin(populatedRoot, 'reviewer');
  await trustProjectPlugin(populatedRoot, 'governance');
});

after(() => {
  rmSync(tmp, { recursive: true, force: true });
  rmSync(populatedRoot, { recursive: true, force: true });
});

interface IContributionShape {
  schema: Record<string, unknown>;
  ownership?: 'exclusive' | 'shared';
  location?: 'namespaced' | 'root';
}

/**
 * Drop a single-extractor plugin into `<pluginsDir>/<id>/` that declares
 * one `annotation` (singular). Structure-as-truth: the annotation key
 * equals the extension folder name (`extensionId`); the extractor is a
 * no-op (only the contribution registration during the loader's
 * per-extension validation pass matters).
 */
function plantContributionPlugin(
  pluginsDir: string,
  id: string,
  extensionId: string,
  annotation: IContributionShape,
): void {
  const dir = join(pluginsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'plugin.json'),
    JSON.stringify({
      version: '1.0.0',
      description: 'test',
      specCompat: '>=0.0.0',
      catalogCompat: '*',
    }),
  );
  const extDir = join(dir, 'extractors', extensionId);
  mkdirSync(extDir, { recursive: true });
  writeFileSync(join(extDir, 'extension.json'), JSON.stringify({ version: '0.1.0', description: 'fixture extension' }));
  writeFileSync(
    join(extDir, 'index.mjs'),
    `export default {
      scope: 'body',
      annotation: ${JSON.stringify(annotation)},
      extract() {},
    };`,
  );
}

/**
 * Grant local import-trust for a project-local plugin, the in-test
 * equivalent of `sm plugins enable <id>`: write a `config_plugins`
 * override into the project DB so the H1 import-trust gate (default-
 * disabled for cloned project-local plugins) imports the plugin's code
 * when the BFF boots. The gate reads the override from
 * `<cwd>/.skill-map/skill-map.db`, where `cwd` is the boot's
 * `runtimeContext.cwd`, so trust must land under that same root.
 */
async function trustProjectPlugin(cwd: string, pluginId: string): Promise<void> {
  const dbPath = join(cwd, '.skill-map', 'skill-map.db');
  grantTrust(cwd, pluginId);
}

function defaultOptions(overrides: Partial<IServerOptions> = {}): IServerOptions {
  return {
    port: 0,
    host: '127.0.0.1',
    dbPath,
    uiDist: null,
    noUi: false,
    noBuiltIns: false,
    noPlugins: true,
    open: false,
    devCors: false,
    noWatcher: true,
    mcpServer: false,
    settingsEnv: {},
    ...overrides,
  };
}

async function bootEmpty<T>(
  fn: (handle: IServerHandle) => Promise<T>,
): Promise<T> {
  const handle = await createServer(defaultOptions(), {
    runtimeContext: { cwd: tmp},
  });
  try {
    return await fn(handle);
  } finally {
    await handle.close();
  }
}

async function bootPopulated<T>(
  fn: (handle: IServerHandle) => Promise<T>,
): Promise<T> {
  const handle = await createServer(
    defaultOptions({ noPlugins: false }),
    // R14, `runtimeContext.cwd` is now honoured by `loadPluginRuntime`.
    // The loader walks `<populatedRoot>/.skill-map/plugins/` and
    // surfaces the two planted contributions through the catalog.
    { runtimeContext: { cwd: populatedRoot } },
  );
  try {
    return await fn(handle);
  } finally {
    await handle.close();
  }
}

function url(handle: IServerHandle, path: string): string {
  return `http://127.0.0.1:${handle.address.port}${path}`;
}

describe('GET /api/annotations/registered', () => {
  it('200: empty catalog → items: [], counts.total: 0 (real createServer boot)', async () => {
    await bootEmpty(async (handle) => {
      const res = await fetch(url(handle, '/api/annotations/registered'));
      assert.equal(res.status, 200);
      const env = (await res.json()) as IAnnotationsEnvelope;
      assert.equal(env.schemaVersion, '1');
      assert.equal(env.kind, 'annotations.registered');
      assert.deepEqual(env.items, []);
      assert.equal(env.counts.total, 0);
    });
  });

  it('200: populated catalog → both contributions surface with full shape', async () => {
    await bootPopulated(async (handle) => {
      const res = await fetch(url(handle, '/api/annotations/registered'));
      assert.equal(res.status, 200);
      const env = (await res.json()) as IAnnotationsEnvelope;
      assert.equal(env.schemaVersion, '1');
      assert.equal(env.kind, 'annotations.registered');
      assert.equal(env.items.length, 2);
      assert.equal(env.counts.total, 2);

      // Every entry carries the full IRegisteredAnnotationKey shape.
      for (const item of env.items) {
        assert.equal(typeof item.pluginId, 'string');
        assert.notEqual(item.pluginId, '');
        assert.equal(typeof item.key, 'string');
        assert.notEqual(item.key, '');
        assert.ok(['namespaced', 'root'].includes(item.location));
        assert.ok(['exclusive', 'shared'].includes(item.ownership));
        assert.equal(typeof item.schema, 'object');
        assert.notEqual(item.schema, null);
      }

      // Spot-check the two specific contributions we planted.
      const byKey = new Map(env.items.map((i) => [i.key, i]));
      const reviewer = byKey.get('lastReviewedAt');
      assert.ok(reviewer, 'reviewer namespaced contribution present');
      assert.equal(reviewer.pluginId, 'reviewer');
      assert.equal(reviewer.location, 'namespaced');
      assert.equal(reviewer.ownership, 'shared');
      assert.deepEqual(reviewer.schema, { type: 'string' });

      const governance = byKey.get('governance');
      assert.ok(governance, 'governance root contribution present');
      assert.equal(governance.pluginId, 'governance');
      assert.equal(governance.location, 'root');
      assert.equal(governance.ownership, 'exclusive');
      assert.deepEqual(governance.schema, { type: 'object' });
    });
  });

  it('200 envelope validates against rest-envelope.schema.json (R7 closed), empty + populated', async () => {
    // Cross-cutting check: both the empty and populated catalog responses
    // satisfy the canonical envelope schema's `'annotations.registered'`
    // variant (R7 closed at 9.6.7). Any drift in the route's wire shape
    // or in the schema's variant fails here.
    const validate = compileEnvelopeValidator();

    // Empty catalog via the real composition root.
    await bootEmpty(async (handle) => {
      const res = await fetch(url(handle, '/api/annotations/registered'));
      assert.equal(res.status, 200);
      const env = await res.json();
      const ok = validate(env);
      assert.equal(
        ok,
        true,
        `empty envelope must validate: ${JSON.stringify(validate.errors)}`,
      );
    });

    // Populated catalog also through the real boot (R14).
    await bootPopulated(async (handle) => {
      const res = await fetch(url(handle, '/api/annotations/registered'));
      assert.equal(res.status, 200);
      const env = await res.json();
      const ok = validate(env);
      assert.equal(
        ok,
        true,
        `populated envelope must validate: ${JSON.stringify(validate.errors)}`,
      );
    });
  });

  it('handler returns a fresh items array each call (no shared mutation)', async () => {
    await bootPopulated(async (handle) => {
      const first = (await (
        await fetch(url(handle, '/api/annotations/registered'))
      ).json()) as IAnnotationsEnvelope;
      assert.equal(first.items.length, 2);
      // Mutate the parsed response, the kernel's frozen view MUST be
      // immune to a downstream consumer pushing extra entries.
      first.items.push({
        pluginId: 'evil',
        key: 'injected',
        location: 'namespaced',
        ownership: 'shared',
        schema: {},
      });

      const second = (await (
        await fetch(url(handle, '/api/annotations/registered'))
      ).json()) as IAnnotationsEnvelope;
      assert.equal(second.items.length, 2, 'second call still sees the original 2 entries');
      assert.equal(second.counts.total, 2);
      const keys = second.items.map((i) => i.key).sort();
      assert.deepEqual(keys, ['governance', 'lastReviewedAt']);
    });
  });
});


