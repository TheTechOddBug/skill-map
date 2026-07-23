/**
 * Pair toggle over the BFF PATCH routes
 * (spec/plugin-author-guide.md §Paired extensions (pair toggle)).
 *
 * Mirrors the CLI coverage in `plugins-cli.spec.ts` for the HTTP
 * surface:
 *   - the canonical per-extension route flips the companion in the same
 *     write and the returned envelope reflects it (the SPA replaces its
 *     state from the response, nothing extra needed);
 *   - both directions (disable finder -> fixer, enable fixer -> finder);
 *   - deterministic pairs participate (uniform cascade, user decision
 *     2026-07-22);
 *   - the bulk route applies companions with EXPLICIT-WINS semantics: an
 *     id the batch names is never overridden by a companion flip;
 *   - a companion disable cancels the companion's queued jobs (the
 *     disable cascade rides the enlarged key set).
 *
 * Each test boots a real `createServer()` against a file-path tempdir DB
 * (never `:memory:`), `cwd` pointing at an isolated project dir.
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { SqliteStorageAdapter } from '../../../kernel/adapters/sqlite/index.js';
import { persistScanResult } from '../../../kernel/adapters/sqlite/scan-persistence.js';
import type { ScanResult } from '../../../kernel/types.js';
import {
  createServer,
  type IServerOptions,
  type IServerHandle,
} from '../../index.js';
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

function options(scope: IScope): IServerOptions {
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
  };
}

async function bootAndUse<T>(
  scope: IScope,
  fn: (handle: IServerHandle) => Promise<T>,
): Promise<T> {
  const handle = await createServer(options(scope), {
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

function findExt(items: IPluginListItem[], pluginId: string, extId: string): IPluginExtensionItem {
  const plugin = items.find((p) => p.id === pluginId);
  assert.ok(plugin, `plugin "${pluginId}" present`);
  const ext = plugin.extensions?.find((e) => e.id === extId);
  assert.ok(ext, `extension "${pluginId}/${extId}" present`);
  return ext;
}

/** PATCH the canonical per-extension route; returns the envelope items. */
async function patchExt(
  handle: IServerHandle,
  pluginId: string,
  extId: string,
  enabled: boolean,
): Promise<IPluginListItem[]> {
  const res = await fetch(url(handle, `/api/plugins/${pluginId}/extensions/${extId}`), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { items: IPluginListItem[] };
  return body.items;
}

/** PATCH the bulk route; returns the envelope items. */
async function patchBulk(
  handle: IServerHandle,
  changes: Array<{ id: string; enabled: boolean }>,
): Promise<IPluginListItem[]> {
  const res = await fetch(url(handle, '/api/plugins'), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ changes }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { items: IPluginListItem[] };
  return body.items;
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-map-plugins-pair-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('PATCH /api/plugins/:pluginId/extensions/:extensionId, pair toggle', () => {
  it('disabling a finder flips its paired fixer in the same envelope', async () => {
    const scope = freshScope('ext-disable-finder');
    await primeDb(scope.dbPath);
    await bootAndUse(scope, async (handle) => {
      const items = await patchExt(handle, 'core', 'ai-verbosity-analyzer', false);
      assert.equal(findExt(items, 'core', 'ai-verbosity-analyzer').enabled, false);
      assert.equal(findExt(items, 'core', 'ai-verbosity-action').enabled, false);
    });
  });

  it('enabling a fixer flips its paired finder back on', async () => {
    const scope = freshScope('ext-enable-fixer');
    await primeDb(scope.dbPath);
    await bootAndUse(scope, async (handle) => {
      await patchExt(handle, 'core', 'ai-verbosity-analyzer', false); // both off
      const items = await patchExt(handle, 'core', 'ai-verbosity-action', true);
      assert.equal(findExt(items, 'core', 'ai-verbosity-analyzer').enabled, true);
      assert.equal(findExt(items, 'core', 'ai-verbosity-action').enabled, true);
    });
  });

  it('deterministic pairs participate: disabling name-mismatch pulls ai-name-action', async () => {
    const scope = freshScope('ext-deterministic');
    await primeDb(scope.dbPath);
    await bootAndUse(scope, async (handle) => {
      const items = await patchExt(handle, 'core', 'name-mismatch', false);
      assert.equal(findExt(items, 'core', 'name-mismatch').enabled, false);
      assert.equal(findExt(items, 'core', 'ai-name-action').enabled, false);
    });
  });

  it('a companion disable cancels the companion queued jobs', async () => {
    const scope = freshScope('ext-job-cancel');
    await primeDb(scope.dbPath);

    // Seed a queued job for the FIXER only into the served DB.
    const seed = new SqliteStorageAdapter({ databasePath: scope.dbPath, autoBackup: false });
    await seed.init();
    try {
      await seed.jobs.submit(
        {
          id: 'pair-bff-1',
          extensionId: 'core/ai-verbosity-action',
          extensionVersion: '1.0.0',
          extensionKind: 'action',
          nodeId: 'pair-bff-1.md',
          contentHash: 'h'.repeat(64),
          nonce: 'n'.repeat(32),
          priority: 0,
          status: 'queued',
          ttlSeconds: 3600,
          createdAt: Date.now(),
        },
        {
          contentHash: 'h'.repeat(64),
          content: 'RENDERED pair-bff-1',
          createdAt: Date.now(),
        },
      );
    } finally {
      await seed.close();
    }

    await bootAndUse(scope, async (handle) => {
      await patchExt(handle, 'core', 'ai-verbosity-analyzer', false);
    });

    const check = new SqliteStorageAdapter({ databasePath: scope.dbPath, autoBackup: false });
    await check.init();
    try {
      assert.equal((await check.jobs.get('pair-bff-1'))?.status, 'cancelled');
    } finally {
      await check.close();
    }
  });
});

describe('PATCH /api/plugins (bulk), pair toggle', () => {
  it('a bulk disable flips the companion fixer', async () => {
    const scope = freshScope('bulk-companion');
    await primeDb(scope.dbPath);
    await bootAndUse(scope, async (handle) => {
      const items = await patchBulk(handle, [
        { id: 'core/ai-verbosity-analyzer', enabled: false },
      ]);
      assert.equal(findExt(items, 'core', 'ai-verbosity-analyzer').enabled, false);
      assert.equal(findExt(items, 'core', 'ai-verbosity-action').enabled, false);
    });
  });

  it('explicit wins: a batch naming both halves applies exactly as stated', async () => {
    const scope = freshScope('bulk-explicit-wins');
    await primeDb(scope.dbPath);
    await bootAndUse(scope, async (handle) => {
      // Disable the finder but explicitly keep the fixer enabled: the
      // companion flip must NOT override the stated intent.
      const items = await patchBulk(handle, [
        { id: 'core/ai-verbosity-analyzer', enabled: false },
        { id: 'core/ai-verbosity-action', enabled: true },
      ]);
      assert.equal(findExt(items, 'core', 'ai-verbosity-analyzer').enabled, false);
      assert.equal(findExt(items, 'core', 'ai-verbosity-action').enabled, true);
    });
  });

  it('mixed batch: a same-batch enable keeps the fixer alive in the refcount', async () => {
    const scope = freshScope('bulk-mixed-overlay');
    await primeDb(scope.dbPath);
    await bootAndUse(scope, async (handle) => {
      // Start with both halves off, then in ONE batch: enable the
      // trigger analyzer, disable the verbosity analyzer. The verbosity
      // fixer falls (its only analyzer went down); the trigger pair
      // comes up via the enable direction.
      await patchBulk(handle, [{ id: 'core/ai-trigger-analyzer', enabled: false }]);
      const items = await patchBulk(handle, [
        { id: 'core/ai-trigger-analyzer', enabled: true },
        { id: 'core/ai-verbosity-analyzer', enabled: false },
      ]);
      assert.equal(findExt(items, 'core', 'ai-trigger-analyzer').enabled, true);
      assert.equal(findExt(items, 'core', 'ai-trigger-action').enabled, true);
      assert.equal(findExt(items, 'core', 'ai-verbosity-analyzer').enabled, false);
      assert.equal(findExt(items, 'core', 'ai-verbosity-action').enabled, false);
    });
  });
});
