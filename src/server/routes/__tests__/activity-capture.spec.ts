/**
 * `GET/POST /api/activity/capture` integration tests (conversation
 * capture gate, see `spec/provider-activity.md` §Conversation
 * capture). Boots a real `createServer()` against a primed-DB tempdir
 * (the activity-endpoint.spec pattern). The POST persists to
 * `<cwd>/.skill-map/settings.local.json`, so the file is reset between
 * tests and its contents are asserted directly on the happy path.
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import { SqliteStorageAdapter } from '../../../kernel/adapters/sqlite/index.js';
import { persistScanResult } from '../../../kernel/adapters/sqlite/scan-persistence.js';
import type { Node, ScanResult } from '../../../kernel/types.js';
import {
  createServer,
  type IServerOptions,
  type IServerHandle,
} from '../../index.js';

const HASH_BODY = 'a'.repeat(64);
const HASH_FRONTMATTER = 'b'.repeat(64);
const TOKEN_HEADER = 'x-skill-map-token';
const SPAWN_ID = 'toolu_01MEQBSdHNo3B9pMjY8s7ZQK';

const AGENT_SPAWN_PAYLOAD = {
  session_id: '6cfe5636-2e56-4271-91a6-87fc3d4355be',
  hook_event_name: 'PreToolUse',
  agent_id: 'a4e825faeafee3619',
  agent_type: 'demo-orchestrator',
  tool_name: 'Agent',
  tool_input: { prompt: 'continue the chain', subagent_type: 'demo-worker' },
  tool_use_id: SPAWN_ID,
};

interface ITestRoot {
  tmp: string;
  fixtureRoot: string;
  dbPath: string;
  localSettingsPath: string;
}

let root: ITestRoot;

before(() => {
  const tmp = mkdtempSync(join(tmpdir(), 'skill-map-activity-capture-'));
  const fixtureRoot = join(tmp, 'fixture');
  root = {
    tmp,
    fixtureRoot,
    dbPath: join(tmp, 'primed.db'),
    localSettingsPath: join(fixtureRoot, '.skill-map', 'settings.local.json'),
  };
});

after(() => {
  rmSync(root.tmp, { recursive: true, force: true });
});

beforeEach(async () => {
  rmSync(root.dbPath, { force: true });
  rmSync(root.localSettingsPath, { force: true });
  await primeFixture();
});

async function primeFixture(): Promise<void> {
  const result: ScanResult = {
    schemaVersion: 1,
    scannedAt: Date.now(),
    roots: [root.fixtureRoot],
    providers: ['claude'],
    nodes: [
      makeNode('.claude/agents/demo-orchestrator.md', 'agent'),
      makeNode('.claude/agents/demo-worker.md', 'agent'),
    ],
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
    await persistScanResult(adapter.db, result);
  } finally {
    await adapter.close();
  }
}

function makeNode(path: string, kind: string): Node {
  return {
    path,
    kind,
    provider: 'claude',
    bodyHash: HASH_BODY,
    frontmatterHash: HASH_FRONTMATTER,
    bytes: { frontmatter: 0, body: 0, total: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
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
    mcpServer: false,
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

async function getCapture(handle: IServerHandle): Promise<{ enabled: boolean }> {
  const res = await fetch(url(handle, '/api/activity/capture'));
  assert.equal(res.status, 200);
  return (await res.json()) as { enabled: boolean };
}

async function postCapture(handle: IServerHandle, body: unknown): Promise<Response> {
  return fetch(url(handle, '/api/activity/capture'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function postSpawnEvent(handle: IServerHandle): Promise<void> {
  const res = await fetch(url(handle, '/api/activity'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [TOKEN_HEADER]: handle.activityToken,
    },
    body: JSON.stringify({ provider: 'claude', event: AGENT_SPAWN_PAYLOAD }),
  });
  assert.equal(res.status, 202);
}

describe('GET/POST /api/activity/capture', () => {
  it('defaults to disabled', async () => {
    await bootAndUse(async (handle) => {
      assert.deepEqual(await getCapture(handle), { enabled: false });
    });
  });

  it('412 confirm-required without `confirm: true`, nothing changes', async () => {
    await bootAndUse(async (handle) => {
      const res = await postCapture(handle, { enabled: true });
      assert.equal(res.status, 412);
      const envelope = (await res.json()) as { ok: boolean; error: { code: string } };
      assert.equal(envelope.ok, false);
      assert.equal(envelope.error.code, 'confirm-required');
      assert.deepEqual(await getCapture(handle), { enabled: false });
    });
  });

  it('400 on malformed bodies', async () => {
    await bootAndUse(async (handle) => {
      for (const bad of [{}, { enabled: 'yes' }, { enabled: true, confirm: 'sure' }]) {
        const res = await postCapture(handle, bad);
        assert.equal(res.status, 400, JSON.stringify(bad));
      }
    });
  });

  it('enables with confirm, reflects on GET, and persists to the project-local layer', async () => {
    await bootAndUse(async (handle) => {
      const res = await postCapture(handle, { enabled: true, confirm: true });
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { enabled: true });
      assert.deepEqual(await getCapture(handle), { enabled: true });
      const persisted = JSON.parse(readFileSync(root.localSettingsPath, 'utf8')) as {
        activity?: { captureConversations?: boolean };
      };
      assert.equal(persisted.activity?.captureConversations, true);
    });
    // A fresh boot initialises the store from the persisted gate.
    await bootAndUse(async (handle) => {
      assert.deepEqual(await getCapture(handle), { enabled: true });
    });
  });

  it('turning the gate OFF clears the conversation store immediately', async () => {
    await bootAndUse(async (handle) => {
      await postCapture(handle, { enabled: true, confirm: true });
      await postSpawnEvent(handle);
      const before = await fetch(url(handle, `/api/activity/spawns/${SPAWN_ID}`));
      assert.equal(before.status, 200);

      const off = await postCapture(handle, { enabled: false, confirm: true });
      assert.equal(off.status, 200);
      assert.deepEqual(await getCapture(handle), { enabled: false });
      const after = await fetch(url(handle, `/api/activity/spawns/${SPAWN_ID}`));
      assert.equal(after.status, 404);
    });
  });
});
