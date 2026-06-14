/**
 * `GET /api/plugins`, runtime contribution-error embedding.
 *
 * The kernel persists per-scan view-contribution rejections into
 * `scan_contribution_errors`; the BFF surfaces them per plugin so the
 * SPA's plugin panel can render them without a second fetch. Each test
 * primes a real DB (file-path tempdir, never `:memory:`) with a scan
 * result + a contribution-error buffer, boots `createServer()`, and
 * asserts the embedded `runtimeContributionErrors` shape.
 *
 * Coverage:
 *   - errors are grouped by `pluginId` onto the matching list item;
 *   - the wire element drops `pluginId` + `emittedAt`, keeps the optional
 *     `contributionId` / `slot` only when present;
 *   - plugins with no rejections omit the field entirely (lean shape);
 *   - a clean scan (empty error buffer) embeds the field nowhere.
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import type { IContributionErrorRecord } from '../../../kernel/adapters/sqlite/contributions.js';
import { SqliteStorageAdapter } from '../../../kernel/adapters/sqlite/index.js';
import { persistScanResult } from '../../../kernel/adapters/sqlite/scan-persistence.js';
import type { Node, ScanResult } from '../../../kernel/types.js';
import {
  createServer,
  type IServerOptions,
  type IServerHandle,
} from '../../index.js';
import type { IPluginListItem } from '../plugins.js';

const HASH_BODY = 'a'.repeat(64);
const HASH_FRONTMATTER = 'b'.repeat(64);

interface ITestRoot {
  tmp: string;
  fixtureRoot: string;
  dbPath: string;
}

let root: ITestRoot;

before(() => {
  const tmp = mkdtempSync(join(tmpdir(), 'skill-map-plugins-errors-'));
  root = {
    tmp,
    fixtureRoot: join(tmp, 'fixture'),
    dbPath: join(tmp, 'primed.db'),
  };
});

after(() => {
  rmSync(root.tmp, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(root.dbPath, { force: true });
});

async function prime(errors: IContributionErrorRecord[]): Promise<void> {
  const result: ScanResult = {
    schemaVersion: 1,
    scannedAt: Date.now(),
    roots: [root.fixtureRoot],
    providers: ['claude'],
    nodes: [makeNode('skills/foo.md'), makeNode('agents/bar.md')],
    links: [],
    issues: [],
    stats: {
      filesWalked: 2,
      filesSkipped: 0,
      nodesCount: 2,
      linksCount: 0,
      issuesCount: 0,
      durationMs: 0,
    },
  };
  const adapter = new SqliteStorageAdapter({
    databasePath: root.dbPath,
    autoBackup: false,
  });
  await adapter.init();
  try {
    // `persistScanResult` REPLACE-ALLs `scan_contribution_errors` from
    // the inputs bag's `contributionErrors` field.
    await persistScanResult(adapter.db, result, { contributionErrors: errors });
  } finally {
    await adapter.close();
  }
}

function makeNode(path: string): Node {
  return {
    path,
    kind: 'skill',
    provider: 'claude',
    bodyHash: HASH_BODY,
    frontmatterHash: HASH_FRONTMATTER,
    bytes: { frontmatter: 0, body: 0, total: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
  };
}

function makeError(over: Partial<IContributionErrorRecord>): IContributionErrorRecord {
  return {
    pluginId: 'core',
    extensionId: 'annotations',
    nodePath: 'skills/foo.md',
    reason: 'undeclared-contribution-ref',
    message: 'contribution ref not declared',
    emittedAt: Date.now(),
    ...over,
  };
}

function defaultOptions(): IServerOptions {
  return {
    port: 0,
    host: '127.0.0.1',
    dbPath: root.dbPath,
    uiDist: null,
    noUi: false,
    noBuiltIns: false,
    noPlugins: true,
    open: false,
    devCors: false,
    noWatcher: true,
  };
}

async function bootAndUse<T>(fn: (handle: IServerHandle) => Promise<T>): Promise<T> {
  const handle = await createServer(defaultOptions(), {
    runtimeContext: { cwd: root.fixtureRoot },
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

async function fetchItems(handle: IServerHandle): Promise<IPluginListItem[]> {
  const res = await fetch(url(handle, '/api/plugins'));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { items: IPluginListItem[] };
  return body.items;
}

describe('GET /api/plugins, runtimeContributionErrors', () => {
  it('groups errors by pluginId onto the matching item', async () => {
    await prime([
      makeError({ pluginId: 'core', extensionId: 'annotations' }),
      makeError({
        pluginId: 'claude',
        extensionId: 'slash-command',
        nodePath: 'agents/bar.md',
        reason: 'payload failed slot schema',
        message: 'AJV: /label must be string',
        contributionId: 'cmd-card',
        slot: 'card.badges',
      }),
    ]);
    await bootAndUse(async (handle) => {
      const items = await fetchItems(handle);
      const core = items.find((p) => p.id === 'core');
      const claude = items.find((p) => p.id === 'claude');
      assert.ok(core);
      assert.ok(claude);
      assert.equal(core.runtimeContributionErrors?.length, 1);
      assert.equal(claude.runtimeContributionErrors?.length, 1);
    });
  });

  it('drops pluginId + emittedAt, keeps optional contributionId/slot only when present', async () => {
    await prime([
      makeError({
        pluginId: 'claude',
        extensionId: 'slash-command',
        reason: 'payload failed slot schema',
        message: 'AJV: /label must be string',
        contributionId: 'cmd-card',
        slot: 'card.badges',
      }),
      makeError({
        pluginId: 'core',
        extensionId: 'annotations',
        reason: 'undeclared-contribution-ref',
        message: 'contribution ref not declared',
      }),
    ]);
    await bootAndUse(async (handle) => {
      const items = await fetchItems(handle);
      const claudeErr = items.find((p) => p.id === 'claude')?.runtimeContributionErrors?.[0];
      const coreErr = items.find((p) => p.id === 'core')?.runtimeContributionErrors?.[0];
      assert.ok(claudeErr);
      assert.ok(coreErr);
      // Grouping key + timestamp are stripped from the wire element.
      assert.equal((claudeErr as unknown as Record<string, unknown>)['pluginId'], undefined);
      assert.equal((claudeErr as unknown as Record<string, unknown>)['emittedAt'], undefined);
      // Full AJV shape carries contributionId + slot.
      assert.equal(claudeErr.extensionId, 'slash-command');
      assert.equal(claudeErr.contributionId, 'cmd-card');
      assert.equal(claudeErr.slot, 'card.badges');
      // undeclared-ref shape omits both optionals.
      assert.equal(coreErr.contributionId, undefined);
      assert.equal(coreErr.slot, undefined);
      assert.equal(coreErr.reason, 'undeclared-contribution-ref');
    });
  });

  it('omits the field on plugins with no rejections', async () => {
    await prime([makeError({ pluginId: 'core' })]);
    await bootAndUse(async (handle) => {
      const items = await fetchItems(handle);
      const claude = items.find((p) => p.id === 'claude');
      assert.ok(claude);
      assert.equal(claude.runtimeContributionErrors, undefined);
    });
  });

  it('embeds the field nowhere when the scan was clean', async () => {
    await prime([]);
    await bootAndUse(async (handle) => {
      const items = await fetchItems(handle);
      for (const item of items) {
        assert.equal(item.runtimeContributionErrors, undefined);
      }
    });
  });
});
