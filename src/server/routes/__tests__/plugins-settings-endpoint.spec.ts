/**
 * `GET /api/plugins` settings projection + `PATCH /api/plugins` settings
 * writes (per-extension plugin settings over HTTP).
 *
 * Read side:
 *   - an extension that declares settings embeds `settings[]` (manifest
 *     order, each = declaration + `id`) and `settingValues` (resolved
 *     effective values), using the built-in `core/external-url-counter`
 *     `ignored-domains` (string-list) setting;
 *   - a `secret`-typed setting's real value NEVER appears in
 *     `settingValues`; its id surfaces in `secretSettingsSet` only when a
 *     value is stored. Exercised via a drop-in fixture plugin that
 *     declares a `secret` setting (no built-in declares one).
 *
 * Write side (bulk PATCH):
 *   - a `string-list` value round-trips: written to `settings.json` and
 *     re-read through the next GET's `settingValues`;
 *   - an invalid value (wrong type) rejects the WHOLE batch (400) and
 *     writes nothing;
 *   - a `secret` value lands in `settings.local.json`, never
 *     `settings.json`, and is not echoed in `settingValues`.
 *
 * Each test boots a real `createServer()` against a file-path tempdir DB
 * (never `:memory:`), with `cwd` pointing at a project dir so plugin
 * discovery + config layering resolve against it.
 */

import { grantTrust } from '../../../kernel/config/plugin-trust-store.js';
import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import { installedSpecVersion } from '../../../kernel/adapters/plugin-loader.js';
import { SqliteStorageAdapter } from '../../../kernel/adapters/sqlite/index.js';
import { persistScanResult } from '../../../kernel/adapters/sqlite/scan-persistence.js';
import type { ScanResult } from '../../../kernel/types.js';
import {
  createServer,
  type IServerOptions,
  type IServerHandle,
} from '../../index.js';
import { withSqlite } from '../../../core/sqlite/with-sqlite.js';
import type { IPluginExtensionItem, IPluginListItem } from '../plugins.js';

let root: string;
let counter = 0;

interface IScope {
  cwd: string;
  dbPath: string;
}

/** Fresh isolated project dir + primed DB path per test. */
function freshScope(label: string): IScope {
  counter += 1;
  const cwd = join(root, `${label}-${counter}`);
  mkdirSync(join(cwd, '.skill-map'), { recursive: true });
  return { cwd, dbPath: join(cwd, '.skill-map', 'primed.db') };
}

/** Prime an empty-but-valid scan DB so mutation paths find a DB file. */
async function primeDb(dbPath: string): Promise<void> {
  const result: ScanResult = {
    schemaVersion: 1,
    scannedAt: Date.now(),
    roots: ['.'],
    providers: ['core'],
    nodes: [],
    links: [],
    issues: [],
    stats: {
      filesWalked: 0,
      filesSkipped: 0,
      nodesCount: 0,
      linksCount: 0,
      issuesCount: 0,
      durationMs: 0,
    },
  };
  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  try {
    await persistScanResult(adapter.db, result);
  } finally {
    await adapter.close();
  }
}

/**
 * Drop a user plugin with one extractor declaring a `secret`-typed
 * setting (plus a normal string for breadth). Mirrors the CLI's
 * `plugins-config-cli` fixture.
 */
function dropSecretPlugin(scope: IScope, pluginId: string, extId: string): void {
  const pluginDir = join(scope.cwd, '.skill-map', 'plugins', pluginId);
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(
    join(pluginDir, 'plugin.json'),
    JSON.stringify({
      version: '0.1.0',
      description: 'secret-bearing test plugin',
      specCompat: `^${installedSpecVersion()}`,
      catalogCompat: '*',
    }),
  );
  const extDir = join(pluginDir, 'extractors', extId);
  mkdirSync(extDir, { recursive: true });
  writeFileSync(join(extDir, 'extension.json'), JSON.stringify({ version: '0.1.0', description: 'fixture extension' }));
  writeFileSync(
    join(extDir, 'index.js'),
    `export default {
       settings: {
         'api-token': { type: 'secret', label: 'API token', envVar: 'VAULT_API_TOKEN' },
         'base-url': { type: 'single-string', label: 'Base URL', default: 'https://api.example.com' },
       },
       extract() {},
     };\n`,
  );
}

/**
 * Grant local import-trust the way the product does: a scope-lock record
 * keyed to `runtimeContext.cwd`, which is the scope the import gate
 * consults (NOT the BFF's primed `dbPath`).
 */
function trustProjectPlugin(scope: IScope, pluginId: string): void {
  grantTrust(scope.cwd, pluginId);
}

function readSettingsFile(scope: IScope, kind: 'settings' | 'settings.local'): Record<string, unknown> {
  const path = join(scope.cwd, '.skill-map', `${kind}.json`);
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

function options(scope: IScope, over: Partial<IServerOptions> = {}): IServerOptions {
  return {
    port: 0,
    host: '127.0.0.1',
    dbPath: scope.dbPath,
    uiDist: null,
    noUi: false,
    noBuiltIns: false,
    noPlugins: true,
    open: false,
    devCors: false,
    noWatcher: true,
    mcpServer: false,
    ...over,
  };
}

async function bootAndUse<T>(
  scope: IScope,
  over: Partial<IServerOptions>,
  fn: (handle: IServerHandle) => Promise<T>,
): Promise<T> {
  const handle = await createServer(options(scope, over), {
    runtimeContext: { cwd: scope.cwd },
  });
  try {
    return await fn(handle);
  } finally {
    await handle.close();
  }
}

function url(handle: IServerHandle, path: string): string {
  return `http://127.0.0.1:${handle.address.port}${path}`;
}

async function getItems(handle: IServerHandle): Promise<IPluginListItem[]> {
  const res = await fetch(url(handle, '/api/plugins'));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { items: IPluginListItem[] };
  return body.items;
}

function findExt(items: IPluginListItem[], pluginId: string, extId: string): IPluginExtensionItem {
  const plugin = items.find((p) => p.id === pluginId);
  assert.ok(plugin, `plugin "${pluginId}" present`);
  const ext = plugin.extensions?.find((e) => e.id === extId);
  assert.ok(ext, `extension "${pluginId}/${extId}" present`);
  return ext;
}

async function patch(handle: IServerHandle, body: unknown): Promise<Response> {
  return fetch(url(handle, '/api/plugins'), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-map-plugins-settings-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('GET /api/plugins, settings projection', () => {
  it('embeds declarations + resolved values for an extension with settings', async () => {
    const scope = freshScope('get-declared');
    await primeDb(scope.dbPath);
    await bootAndUse(scope, {}, async (handle) => {
      const items = await getItems(handle);
      const ext = findExt(items, 'core', 'external-url-counter');
      // Declarations carry the manifest shape + the settingId as `id`.
      assert.ok(ext.settings, 'settings[] present');
      const decl = ext.settings.find((s) => s.id === 'ignored-domains');
      assert.ok(decl, 'ignored-domains declared');
      assert.equal(decl.type, 'string-list');
      assert.equal(decl.label, 'Ignored domains');
      // Resolved effective value defaults to [] (the manifest default).
      assert.ok(ext.settingValues, 'settingValues present');
      assert.deepEqual(ext.settingValues['ignored-domains'], []);
      // No secret here, so no secretSettingsSet.
      assert.equal(ext.secretSettingsSet, undefined);
    });
  });

  it('omits settings fields for an extension that declares none', async () => {
    const scope = freshScope('get-none');
    await primeDb(scope.dbPath);
    await bootAndUse(scope, {}, async (handle) => {
      const items = await getItems(handle);
      // `core/markdown-link` declares no settings.
      const ext = findExt(items, 'core', 'markdown-link');
      assert.equal(ext.settings, undefined);
      assert.equal(ext.settingValues, undefined);
      assert.equal(ext.secretSettingsSet, undefined);
    });
  });

  it('never emits a secret value in settingValues; lists it in secretSettingsSet when set', async () => {
    const scope = freshScope('get-secret');
    await primeDb(scope.dbPath);
    dropSecretPlugin(scope, 'vault', 'fetcher');
    // Post-H1 gate: trust the dropped plugin so its `fetcher` extension loads.
    trustProjectPlugin(scope, 'vault');
    // Pre-seed a stored secret value in the local file.
    writeFileSync(
      join(scope.cwd, '.skill-map', 'settings.local.json'),
      JSON.stringify({
        plugins: { vault: { extensions: { fetcher: { settings: { 'api-token': 'sk-super-secret' } } } } },
      }),
    );
    await bootAndUse(scope, { noPlugins: false }, async (handle) => {
      const items = await getItems(handle);
      const ext = findExt(items, 'vault', 'fetcher');
      // The secret declaration is still surfaced (the UI renders the control).
      assert.ok(ext.settings?.some((s) => s.id === 'api-token' && s.type === 'secret'));
      // The real value is NOT on the wire anywhere.
      assert.equal(ext.settingValues?.['api-token'], undefined);
      const wire = JSON.stringify(ext);
      assert.doesNotMatch(wire, /sk-super-secret/);
      // The stored-ness is signalled via secretSettingsSet.
      assert.deepEqual(ext.secretSettingsSet, ['api-token']);
      // The non-secret sibling resolves normally.
      assert.equal(ext.settingValues?.['base-url'], 'https://api.example.com');
    });
  });

  it('omits secretSettingsSet when no secret value is stored', async () => {
    const scope = freshScope('get-secret-empty');
    await primeDb(scope.dbPath);
    dropSecretPlugin(scope, 'vault', 'fetcher');
    // Post-H1 gate: trust the dropped plugin so its `fetcher` extension loads.
    trustProjectPlugin(scope, 'vault');
    await bootAndUse(scope, { noPlugins: false }, async (handle) => {
      const items = await getItems(handle);
      const ext = findExt(items, 'vault', 'fetcher');
      assert.equal(ext.secretSettingsSet, undefined);
      assert.equal(ext.settingValues?.['api-token'], undefined);
    });
  });
});

describe('PATCH /api/plugins, settings writes', () => {
  it('writes a string-list value to settings.json and round-trips through GET', async () => {
    const scope = freshScope('patch-roundtrip');
    await primeDb(scope.dbPath);
    await bootAndUse(scope, {}, async (handle) => {
      const res = await patch(handle, {
        changes: [
          { id: 'core/external-url-counter', settings: { 'ignored-domains': ['example.com', 'foo.io'] } },
        ],
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { items: IPluginListItem[] };
      // Response carries the updated value.
      const ext = findExt(body.items, 'core', 'external-url-counter');
      assert.deepEqual(ext.settingValues?.['ignored-domains'], ['example.com', 'foo.io']);
    });
    // Landed in the committed file, not the local file.
    const committed = readSettingsFile(scope, 'settings') as {
      plugins?: { core?: { extensions?: { 'external-url-counter'?: { settings?: Record<string, unknown> } } } };
    };
    assert.deepEqual(
      committed.plugins?.core?.extensions?.['external-url-counter']?.settings?.['ignored-domains'],
      ['example.com', 'foo.io'],
    );
    assert.deepEqual(readSettingsFile(scope, 'settings.local'), {});

    // A fresh boot re-reads the persisted value through GET.
    await bootAndUse(scope, {}, async (handle) => {
      const items = await getItems(handle);
      const ext = findExt(items, 'core', 'external-url-counter');
      assert.deepEqual(ext.settingValues?.['ignored-domains'], ['example.com', 'foo.io']);
    });
  });

  it('writes a match-list value on the reference-broken analyzer and round-trips', async () => {
    // First settings-declaring built-in ANALYZER; the entries mix the
    // three match kinds so the whole shape round-trips through the
    // resolver-backed validation.
    const scope = freshScope('patch-match-list');
    await primeDb(scope.dbPath);
    const entries = [
      { type: 'literal', value: 'docs/x/spec.md' },
      { type: 'regex', value: '^docs/x/' },
      { type: 'glob', value: 'drafts/**' },
    ];
    await bootAndUse(scope, {}, async (handle) => {
      const res = await patch(handle, {
        changes: [{ id: 'core/reference-broken', settings: { 'ignored-references': entries } }],
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { items: IPluginListItem[] };
      const ext = findExt(body.items, 'core', 'reference-broken');
      assert.deepEqual(ext.settingValues?.['ignored-references'], entries);
    });
    const committed = readSettingsFile(scope, 'settings') as {
      plugins?: { core?: { extensions?: { 'reference-broken'?: { settings?: Record<string, unknown> } } } };
    };
    assert.deepEqual(committed.plugins?.core?.extensions?.['reference-broken']?.settings?.['ignored-references'], entries);
    assert.deepEqual(readSettingsFile(scope, 'settings.local'), {});
  });

  it('rejects a match-list batch carrying an uncompilable regex entry', async () => {
    const scope = freshScope('patch-match-list-bad');
    await primeDb(scope.dbPath);
    await bootAndUse(scope, {}, async (handle) => {
      const res = await patch(handle, {
        changes: [
          { id: 'core/reference-broken', settings: { 'ignored-references': [{ type: 'regex', value: '[unclosed' }] } },
        ],
      });
      assert.equal(res.status, 400);
      const body = (await res.json()) as { ok: boolean; error: { code: string; details: { id: string } } };
      assert.equal(body.ok, false);
      assert.equal(body.error.details.id, 'core/reference-broken');
    });
    assert.deepEqual(readSettingsFile(scope, 'settings'), {});
  });

  it('rejects the whole batch on an invalid value and writes nothing', async () => {
    const scope = freshScope('patch-invalid');
    await primeDb(scope.dbPath);
    await bootAndUse(scope, {}, async (handle) => {
      const res = await patch(handle, {
        changes: [
          // Valid toggle on one plugin...
          { id: 'claude', enabled: false },
          // ...but an invalid settings value on another (string, not string[]).
          { id: 'core/external-url-counter', settings: { 'ignored-domains': 'not-an-array' } },
        ],
      });
      assert.equal(res.status, 400);
      const body = (await res.json()) as { ok: boolean; error: { code: string; details: { id: string } } };
      assert.equal(body.ok, false);
      assert.equal(body.error.code, 'bad-query');
      assert.equal(body.error.details.id, 'core/external-url-counter');
    });
    // All-or-nothing: nothing was written (no settings file, and the
    // toggle on `claude` did not land either).
    assert.deepEqual(readSettingsFile(scope, 'settings'), {});
    await bootAndUse(scope, {}, async (handle) => {
      const items = await getItems(handle);
      const claude = items.find((p) => p.id === 'claude');
      // claude still enabled (the rejected batch never persisted the toggle).
      assert.equal(claude?.status, 'enabled');
    });
  });

  it('rejects an unknown settingId for the extension', async () => {
    const scope = freshScope('patch-unknown-setting');
    await primeDb(scope.dbPath);
    await bootAndUse(scope, {}, async (handle) => {
      const res = await patch(handle, {
        changes: [{ id: 'core/external-url-counter', settings: { nope: ['x'] } }],
      });
      assert.equal(res.status, 400);
      const body = (await res.json()) as { error: { details: { id: string } } };
      assert.equal(body.error.details.id, 'core/external-url-counter');
    });
    assert.deepEqual(readSettingsFile(scope, 'settings'), {});
  });

  it('rejects settings on a bare plugin id (wrong granularity)', async () => {
    const scope = freshScope('patch-bare-settings');
    await primeDb(scope.dbPath);
    await bootAndUse(scope, {}, async (handle) => {
      const res = await patch(handle, {
        changes: [{ id: 'core', settings: { 'ignored-domains': [] } }],
      });
      assert.equal(res.status, 400);
      const body = (await res.json()) as { error: { code: string; details: { id: string } } };
      assert.equal(body.error.code, 'bad-query');
      assert.equal(body.error.details.id, 'core');
    });
  });

  it('writes a secret value to settings.local.json, never settings.json, and never echoes it', async () => {
    const scope = freshScope('patch-secret');
    await primeDb(scope.dbPath);
    dropSecretPlugin(scope, 'vault', 'fetcher');
    // Post-H1 gate: trust the dropped plugin so its `fetcher` extension loads.
    trustProjectPlugin(scope, 'vault');
    await bootAndUse(scope, { noPlugins: false }, async (handle) => {
      const res = await patch(handle, {
        changes: [{ id: 'vault/fetcher', settings: { 'api-token': 'sk-from-http' } }],
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { items: IPluginListItem[] };
      const ext = findExt(body.items, 'vault', 'fetcher');
      // The response never carries the secret value, only its stored-ness.
      assert.equal(ext.settingValues?.['api-token'], undefined);
      assert.deepEqual(ext.secretSettingsSet, ['api-token']);
      assert.doesNotMatch(JSON.stringify(body), /sk-from-http/);
    });
    // Secret landed in the gitignored local file...
    const local = readSettingsFile(scope, 'settings.local') as {
      plugins?: { vault?: { extensions?: { fetcher?: { settings?: Record<string, unknown> } } } };
    };
    assert.equal(local.plugins?.vault?.extensions?.fetcher?.settings?.['api-token'], 'sk-from-http');
    // ...and NEVER in the committed file.
    assert.deepEqual(readSettingsFile(scope, 'settings'), {});
  });

  it('writes a non-secret sibling to settings.json on the same secret-bearing extension', async () => {
    const scope = freshScope('patch-secret-sibling');
    await primeDb(scope.dbPath);
    dropSecretPlugin(scope, 'vault', 'fetcher');
    // Post-H1 gate: trust the dropped plugin so its `fetcher` extension loads.
    trustProjectPlugin(scope, 'vault');
    await bootAndUse(scope, { noPlugins: false }, async (handle) => {
      const res = await patch(handle, {
        changes: [{ id: 'vault/fetcher', settings: { 'base-url': 'https://api.test.dev' } }],
      });
      assert.equal(res.status, 200);
    });
    const committed = readSettingsFile(scope, 'settings') as {
      plugins?: { vault?: { extensions?: { fetcher?: { settings?: Record<string, unknown> } } } };
    };
    assert.equal(
      committed.plugins?.vault?.extensions?.fetcher?.settings?.['base-url'],
      'https://api.test.dev',
    );
    assert.deepEqual(readSettingsFile(scope, 'settings.local'), {});
  });

  it('applies an enabled toggle and a settings patch in one change', async () => {
    const scope = freshScope('patch-both');
    await primeDb(scope.dbPath);
    await bootAndUse(scope, {}, async (handle) => {
      const res = await patch(handle, {
        changes: [
          {
            id: 'core/external-url-counter',
            enabled: false,
            settings: { 'ignored-domains': ['a.com'] },
          },
        ],
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { items: IPluginListItem[] };
      const ext = findExt(body.items, 'core', 'external-url-counter');
      assert.equal(ext.enabled, false);
      assert.deepEqual(ext.settingValues?.['ignored-domains'], ['a.com']);
    });
  });
});

describe('PATCH /api/plugins, project-local-only key routing', () => {
  it('writes the github base-URL override to settings.local.json (was a 500)', async () => {
    const scope = freshScope('patch-local-only');
    await primeDb(scope.dbPath);
    await bootAndUse(scope, {}, async (handle) => {
      const res = await patch(handle, {
        changes: [
          { id: 'github/enrichment', settings: { apiBaseUrl: 'https://ghe.corp.test/api/v3' } },
        ],
      });
      assert.equal(res.status, 200);
    });
    const local = readSettingsFile(scope, 'settings.local') as {
      plugins?: { github?: { extensions?: { enrichment?: { settings?: Record<string, unknown> } } } };
    };
    assert.equal(
      local.plugins?.github?.extensions?.enrichment?.settings?.['apiBaseUrl'],
      'https://ghe.corp.test/api/v3',
    );
    // A PROJECT_LOCAL_ONLY key must never reach the committed file.
    assert.deepEqual(readSettingsFile(scope, 'settings'), {});
  });
});

describe('GET /api/plugins, secret envVar projection', () => {
  it('counts an env-provided secret in secretSettingsSet without any stored value', async () => {
    const scope = freshScope('env-secret');
    await primeDb(scope.dbPath);
    dropSecretPlugin(scope, 'vault', 'fetcher');
    trustProjectPlugin(scope, 'vault');
    process.env['VAULT_API_TOKEN'] = 'sk-from-env';
    try {
      await bootAndUse(scope, { noPlugins: false }, async (handle) => {
        const items = await getItems(handle);
        const ext = findExt(items, 'vault', 'fetcher');
        assert.deepEqual(ext.secretSettingsSet, ['api-token']);
        assert.equal(ext.settingValues?.['api-token'], undefined);
      });
    } finally {
      delete process.env['VAULT_API_TOKEN'];
    }
    // Nothing was ever written to disk for it.
    assert.deepEqual(readSettingsFile(scope, 'settings.local'), {});
  });
});
