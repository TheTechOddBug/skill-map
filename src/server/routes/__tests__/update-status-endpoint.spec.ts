/**
 * `GET /api/update-status` integration tests.
 *
 * Boots `createServer()` against a primed-DB tempdir, fires `fetch()`
 * against the endpoint, and asserts on the JSON payload. Two paths:
 *
 *   - DB present + cache row populated → full payload with
 *     `current` / `latest` / `isOutdated` / `checkedAt` / `shownAt`.
 *   - DB missing                       → null-shape payload (`latest`
 *     null, `isOutdated` false). Always 200, the endpoint is
 *     non-essential and degrades gracefully.
 *
 * This route reads only, never triggers a registry probe, so no
 * `globalThis.fetch` mocking is needed here.
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { SqliteStorageAdapter } from '../../../kernel/adapters/sqlite/index.js';
import {
  createServer,
  type IServerOptions,
  type IServerHandle,
} from '../../index.js';
import type { IUpdateStatusResponse } from '../update-status.js';
import { VERSION } from '../../../version.js';

interface ITestRoot {
  tmp: string;
  dbPath: string;
  missingDbPath: string;
}

let root: ITestRoot;

before(() => {
  const tmp = mkdtempSync(join(tmpdir(), 'skill-map-update-status-'));
  root = {
    tmp,
    dbPath: join(tmp, 'primed.db'),
    missingDbPath: join(tmp, 'never-created.db'),
  };
});

after(() => {
  rmSync(root.tmp, { recursive: true, force: true });
});

function defaultOptions(dbPath: string): IServerOptions {
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
  };
}

async function bootAndUse<T>(
  dbPath: string,
  fn: (handle: IServerHandle) => Promise<T>,
): Promise<T> {
  const handle = await createServer(defaultOptions(dbPath), {
    runtimeContext: { cwd: root.tmp},
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

describe('GET /api/update-status', () => {
  it('returns the populated cache payload', async () => {
    const adapter = new SqliteStorageAdapter({
      databasePath: root.dbPath,
      autoBackup: false,
    });
    await adapter.init();
    try {
      await adapter.preferences.saveUpdateCheckCache({
        latestVersion: '99.99.99',
        checkedAt: 1_700_000_000_000,
        shownAt: 1_700_000_500_000,
      });
    } finally {
      await adapter.close();
    }

    await bootAndUse(root.dbPath, async (handle) => {
      const res = await fetch(url(handle, '/api/update-status'));
      assert.equal(res.status, 200);
      const body = (await res.json()) as IUpdateStatusResponse;
      assert.equal(body.current, VERSION);
      assert.equal(body.latest, '99.99.99');
      assert.equal(body.isOutdated, true);
      assert.equal(body.checkedAt, 1_700_000_000_000);
      assert.equal(body.shownAt, 1_700_000_500_000);
    });
  });

  it('returns the null-shape payload when the DB is missing', async () => {
    await bootAndUse(root.missingDbPath, async (handle) => {
      const res = await fetch(url(handle, '/api/update-status'));
      assert.equal(res.status, 200);
      const body = (await res.json()) as IUpdateStatusResponse;
      assert.equal(body.current, VERSION);
      assert.equal(body.latest, null);
      assert.equal(body.isOutdated, false);
      assert.equal(body.checkedAt, null);
      assert.equal(body.shownAt, null);
    });
  });
});
