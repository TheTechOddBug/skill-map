/**
 * Split plugin enable (config) from trust (DB), BFF surface:
 *
 *   - `GET /api/plugins` projects a `trusted` flag per drop-in plugin
 *     from the `config_plugins` trust store (omitted when false; built-ins
 *     omit it).
 *   - enable `PATCH /api/plugins/:pluginId/extensions/:extensionId` writes
 *     the per-extension `enabled` to the CONFIG layers (`settings.json`),
 *     NOT the DB.
 *   - `PATCH /api/plugins/:id/trust` writes the per-plugin DB trust row;
 *     built-ins are rejected 403.
 *   - `startsAsDisabled` is stamped only when a plugin was config-disabled
 *     at boot, NOT when it is merely untrusted.
 *
 * Each test boots a real `createServer()` against a file-path project DB
 * (never `:memory:`), `dbPath` pointing at the SAME default project DB the
 * boot import-trust gate resolves from `runtimeContext.cwd`, so a single
 * trust store backs both discovery and the read projection.
 */

import { grantTrust, loadTrust } from '../../../kernel/config/plugin-trust-store.js';
import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

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
import type { IPluginListItem } from '../plugins.js';

let root: string;
let counter = 0;

interface IScope {
  cwd: string;
  dbPath: string;
}

function freshScope(label: string): IScope {
  counter += 1;
  const cwd = join(root, `${label}-${counter}`);
  mkdirSync(join(cwd, '.skill-map'), { recursive: true });
  // The default project DB path, so the boot import-trust gate and the
  // read projection share one trust store.
  return { cwd, dbPath: join(cwd, '.skill-map', 'skill-map.db') };
}

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

function dropMockPlugin(scope: IScope, id: string): void {
  const pluginDir = join(scope.cwd, '.skill-map', 'plugins', id);
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(
    join(pluginDir, 'plugin.json'),
    JSON.stringify({
      version: '0.1.0',
      description: 'trust test plugin',
      specCompat: `^${installedSpecVersion()}`,
      catalogCompat: '*',
    }),
  );
  const extDir = join(pluginDir, 'extractors', `${id}-extractor`);
  mkdirSync(extDir, { recursive: true });
  writeFileSync(join(extDir, 'extension.json'), JSON.stringify({ version: '0.1.0', description: 'fixture extension' }));
  writeFileSync(
    join(extDir, 'index.js'),
    `export default {
       extract() {},
     };\n`,
  );
}

/** Grant trust the way the product does: a scope-lock record, no DB. */
function seedTrust(scope: IScope, pluginId: string): void {
  grantTrust(scope.cwd, pluginId);
}

function writeSettings(scope: IScope, content: Record<string, unknown>): void {
  writeFileSync(
    join(scope.cwd, '.skill-map', 'settings.json'),
    JSON.stringify(content),
  );
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
    noPlugins: false,
    open: false,
    devCors: false,
    noWatcher: true,
    mcpServer: false,
    settingsEnv: {},
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

before(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-map-plugins-trust-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('GET /api/plugins, trusted projection', () => {
  it('stamps trusted: true on a trusted drop-in; built-ins omit it', async () => {
    const scope = freshScope('get-trusted');
    await primeDb(scope.dbPath);
    dropMockPlugin(scope, 'mock-trusted');
    seedTrust(scope, 'mock-trusted');

    await bootAndUse(scope, {}, async (handle) => {
      const items = await getItems(handle);
      const mock = items.find((p) => p.id === 'mock-trusted');
      assert.ok(mock, 'drop-in present');
      assert.equal(mock.trusted, true);
      // A trusted + enabled plugin loaded its handlers, so no startsAsDisabled.
      assert.equal(mock.startsAsDisabled, undefined);
      // Built-ins are never trust-gated, so they omit the flag.
      const core = items.find((p) => p.id === 'core');
      assert.equal(core?.trusted, undefined);
    });
  });

  it('omits trusted on an untrusted drop-in and does NOT stamp startsAsDisabled', async () => {
    const scope = freshScope('get-untrusted');
    await primeDb(scope.dbPath);
    dropMockPlugin(scope, 'mock-untrusted');
    // No trust grant: discovered-but-unexecuted.

    await bootAndUse(scope, {}, async (handle) => {
      const items = await getItems(handle);
      const mock = items.find((p) => p.id === 'mock-untrusted');
      assert.ok(mock, 'drop-in present even when untrusted');
      assert.equal(mock.trusted, undefined);
      // Untrusted carries its own boot notice, not startsAsDisabled.
      assert.equal(mock.startsAsDisabled, undefined);
      // An untrusted plugin is never loaded regardless of the config-enable
      // axis, so its status reads 'disabled' (spec/architecture.md §Plugin
      // enable vs import trust), NOT the config-enable value. The
      // untrusted-ness surfaces as `status: 'disabled'` + the absent
      // `trusted` flag + the untrusted `reason` + no imported extensions
      // (the code never ran).
      assert.equal(mock.status, 'disabled');
      assert.equal(mock.extensions, undefined);
    });
  });

  it('stamps startsAsDisabled when a TRUSTED plugin is config-disabled at boot', async () => {
    const scope = freshScope('get-starts-disabled');
    await primeDb(scope.dbPath);
    dropMockPlugin(scope, 'mock-off');
    seedTrust(scope, 'mock-off');
    // Trusted but operationally disabled at boot. The loader's enable gate
    // runs at the PLUGIN level (bare id), so a plugin-level `enabled: false`
    // is what flips the boot status to disabled (disabledByConfig).
    writeSettings(scope, {
      plugins: { 'mock-off': { enabled: false } },
    });

    await bootAndUse(scope, {}, async (handle) => {
      const items = await getItems(handle);
      const mock = items.find((p) => p.id === 'mock-off');
      assert.ok(mock);
      assert.equal(mock.trusted, true);
      assert.equal(mock.startsAsDisabled, true);
    });
  });
});

describe('PATCH enable writes config, not the DB', () => {
  it('a per-extension enable PATCH lands in settings.json and leaves the trust store untouched', async () => {
    const scope = freshScope('patch-enable-config');
    await primeDb(scope.dbPath);

    await bootAndUse(scope, {}, async (handle) => {
      const res = await fetch(
        url(handle, '/api/plugins/core/extensions/external-url-counter'),
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ enabled: false }),
        },
      );
      assert.equal(res.status, 200);
    });

    // The toggle landed in the committed config layer, NOT the trust store.
    const settings = readSettingsFile(scope, 'settings') as {
      plugins?: { core?: { extensions?: { 'external-url-counter'?: { enabled?: boolean } } } };
    };
    assert.equal(
      settings.plugins?.core?.extensions?.['external-url-counter']?.enabled,
      false,
    );
    // No grant was written by an enable toggle: enable and trust stay
    // orthogonal axes.
    assert.equal(readTrusted(scope, 'core'), false);
  });
});

describe('PATCH /api/plugins/:id/trust', () => {
  it('grants then revokes a per-plugin trust row and projects the field', async () => {
    const scope = freshScope('patch-trust');
    await primeDb(scope.dbPath);
    dropMockPlugin(scope, 'mock-pt');

    await bootAndUse(scope, {}, async (handle) => {
      const granted = await fetch(url(handle, '/api/plugins/mock-pt/trust'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ trusted: true }),
      });
      assert.equal(granted.status, 200);
      const grantedBody = (await granted.json()) as { items: IPluginListItem[] };
      assert.equal(grantedBody.items.find((p) => p.id === 'mock-pt')?.trusted, true);
      assert.equal(readTrusted(scope, 'mock-pt'), true);

      const revoked = await fetch(url(handle, '/api/plugins/mock-pt/trust'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ trusted: false }),
      });
      assert.equal(revoked.status, 200);
      const revokedBody = (await revoked.json()) as { items: IPluginListItem[] };
      assert.equal(revokedBody.items.find((p) => p.id === 'mock-pt')?.trusted, undefined);
      assert.equal(readTrusted(scope, 'mock-pt'), false);
    });
  });

  it('rejects a qualified id (trust is per-plugin) with 400', async () => {
    const scope = freshScope('patch-trust-qualified');
    await primeDb(scope.dbPath);
    dropMockPlugin(scope, 'mock-ptq');

    await bootAndUse(scope, {}, async (handle) => {
      const res = await fetch(url(handle, '/api/plugins/mock-ptq%2Fext/trust'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ trusted: true }),
      });
      assert.equal(res.status, 400);
    });
  });

  it('rejects a built-in id with 403 (never trust-gated)', async () => {
    const scope = freshScope('patch-trust-builtin');
    await primeDb(scope.dbPath);

    await bootAndUse(scope, {}, async (handle) => {
      const res = await fetch(url(handle, '/api/plugins/core/trust'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ trusted: true }),
      });
      assert.equal(res.status, 403);
    });
  });

  it('rejects a non-boolean trusted body with 400', async () => {
    const scope = freshScope('patch-trust-badbody');
    await primeDb(scope.dbPath);
    dropMockPlugin(scope, 'mock-ptb');

    await bootAndUse(scope, {}, async (handle) => {
      const res = await fetch(url(handle, '/api/plugins/mock-ptb/trust'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ trusted: 'yes' }),
      });
      assert.equal(res.status, 400);
    });
  });

  it('grants trust with NO project DB at all (the grant is not a DB row)', async () => {
    // This used to assert a 500 `db-missing`: trust was a `config_plugins`
    // row, so without a DB the write had nowhere to land. The grant is now
    // a scope-lock record keyed to the checkout, so the DB is irrelevant
    // and the route succeeds. Note: no primeDb here, the file is absent.
    const scope = freshScope('patch-trust-no-db');
    dropMockPlugin(scope, 'mock-ptdm');

    await bootAndUse(scope, {}, async (handle) => {
      const res = await fetch(url(handle, '/api/plugins/mock-ptdm/trust'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ trusted: true }),
      });
      assert.equal(res.status, 200);
      assert.equal(readTrusted(scope, 'mock-ptdm'), true);
    });
  });

});

/** Read the per-plugin grant from the scope lock, verified against this checkout. */
function readTrusted(scope: IScope, pluginId: string): boolean {
  return loadTrust(scope.cwd).trusted.has(pluginId);
}
