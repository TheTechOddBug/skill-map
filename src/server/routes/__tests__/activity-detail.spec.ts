/**
 * `GET /api/activity/node/:pathB64` + `GET /api/activity/spawns/:spawnId`
 * integration tests (see `spec/provider-activity.md` §Execution stats +
 * §Conversation capture). Boots a real `createServer()` against a
 * primed-DB tempdir (the activity-endpoint.spec pattern); spawn
 * records are driven through the real ingest route and the capture
 * gate through the real `POST /api/activity/capture` consent flow.
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
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
import { encodeNodePath } from '../../path-codec.js';

const HASH_BODY = 'a'.repeat(64);
const HASH_FRONTMATTER = 'b'.repeat(64);
const TOKEN_HEADER = 'x-skill-map-token';
const ORCHESTRATOR = '.claude/agents/demo-orchestrator.md';
const SPAWN_ID = 'toolu_01MEQBSdHNo3B9pMjY8s7ZQK';

/** Agent-parent spawn PreToolUse: custody claim + spawn relation with prompt. */
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
}

let root: ITestRoot;

before(() => {
  const tmp = mkdtempSync(join(tmpdir(), 'skill-map-activity-detail-'));
  root = {
    tmp,
    fixtureRoot: join(tmp, 'fixture'),
    dbPath: join(tmp, 'primed.db'),
  };
});

after(() => {
  rmSync(root.tmp, { recursive: true, force: true });
});

beforeEach(async () => {
  rmSync(root.dbPath, { force: true });
  // Reset the capture gate between tests: the POST persists it to the
  // project-local layer, and the next boot would inherit it otherwise.
  rmSync(join(root.fixtureRoot, '.skill-map', 'settings.local.json'), { force: true });
  await primeFixture();
});

async function primeFixture(): Promise<void> {
  const result: ScanResult = {
    schemaVersion: 1,
    scannedAt: Date.now(),
    roots: [root.fixtureRoot],
    providers: ['claude'],
    nodes: [
      makeNode('.claude/skills/deploy/SKILL.md', 'skill'),
      makeNode(ORCHESTRATOR, 'agent'),
      makeNode('.claude/agents/demo-worker.md', 'agent'),
    ],
    links: [],
    issues: [],
    stats: {
      filesWalked: 3,
      filesSkipped: 0,
      nodesCount: 3,
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

async function postActivity(handle: IServerHandle, event: unknown): Promise<Response> {
  return fetch(url(handle, '/api/activity'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [TOKEN_HEADER]: handle.activityToken,
    },
    body: JSON.stringify({ provider: 'claude', event }),
  });
}

async function enableCapture(handle: IServerHandle): Promise<void> {
  const res = await fetch(url(handle, '/api/activity/capture'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: true, confirm: true }),
  });
  assert.equal(res.status, 200);
}

interface INodeDetailEnvelope {
  stats: { count: number; lastStartAt: number; lastOwner?: string; distinctOwners: number };
  recent: { at: number; owner?: string }[];
  spawns: Record<string, unknown>[];
  captureEnabled: boolean;
}

async function getNodeDetail(handle: IServerHandle, path: string): Promise<Response> {
  return fetch(url(handle, `/api/activity/node/${encodeNodePath(path)}`));
}

describe('GET /api/activity/node/:pathB64', () => {
  it('404 for a path that is not a scanned node (and for malformed pathB64)', async () => {
    await bootAndUse(async (handle) => {
      const missing = await getNodeDetail(handle, 'not/scanned.md');
      assert.equal(missing.status, 404);
      const malformed = await fetch(url(handle, '/api/activity/node/%2e%2e'));
      assert.equal(malformed.status, 404);
    });
  });

  it('zeroed stats (not 404) for a scanned node with no recorded activity', async () => {
    await bootAndUse(async (handle) => {
      const res = await getNodeDetail(handle, '.claude/skills/deploy/SKILL.md');
      assert.equal(res.status, 200);
      const detail = (await res.json()) as INodeDetailEnvelope;
      assert.deepEqual(detail, {
        stats: { count: 0, lastStartAt: 0, distinctOwners: 0 },
        recent: [],
        spawns: [],
        captureEnabled: false,
      });
    });
  });

  it('gate OFF: spawn posts leave no conversation records', async () => {
    await bootAndUse(async (handle) => {
      await postActivity(handle, AGENT_SPAWN_PAYLOAD);
      const res = await getNodeDetail(handle, ORCHESTRATOR);
      const detail = (await res.json()) as INodeDetailEnvelope;
      assert.equal(detail.captureEnabled, false);
      assert.deepEqual(detail.spawns, []);
      const spawnRes = await fetch(url(handle, `/api/activity/spawns/${SPAWN_ID}`));
      assert.equal(spawnRes.status, 404);
    });
  });

  it('gate ON: spawns carry content on the node detail and stats track counted starts', async () => {
    await bootAndUse(async (handle) => {
      await enableCapture(handle);
      await postActivity(handle, AGENT_SPAWN_PAYLOAD);
      // A counted (non-custody) start on the same node.
      await postActivity(handle, {
        session_id: '6cfe5636-2e56-4271-91a6-87fc3d4355be',
        hook_event_name: 'SubagentStart',
        agent_id: 'a4e825faeafee3619',
        agent_type: 'demo-orchestrator',
      });
      const res = await getNodeDetail(handle, ORCHESTRATOR);
      const detail = (await res.json()) as INodeDetailEnvelope;
      assert.equal(detail.captureEnabled, true);
      assert.equal(detail.stats.count, 1);
      assert.equal(detail.recent.length, 1);
      assert.equal(detail.spawns.length, 1);
      assert.equal(detail.spawns[0]?.['spawnId'], SPAWN_ID);
      assert.equal(detail.spawns[0]?.['prompt'], 'continue the chain');
      assert.equal(detail.spawns[0]?.['status'], 'running');
    });
  });
});

describe('GET /api/activity/spawns/:spawnId', () => {
  it('404 for an unknown spawn id', async () => {
    await bootAndUse(async (handle) => {
      const res = await fetch(url(handle, '/api/activity/spawns/toolu_unknown'));
      assert.equal(res.status, 404);
      const envelope = (await res.json()) as { error: { code: string } };
      assert.equal(envelope.error.code, 'not-found');
    });
  });

  it('gate ON: serves the record with content and captureEnabled', async () => {
    await bootAndUse(async (handle) => {
      await enableCapture(handle);
      await postActivity(handle, AGENT_SPAWN_PAYLOAD);
      const res = await fetch(url(handle, `/api/activity/spawns/${SPAWN_ID}`));
      assert.equal(res.status, 200);
      const envelope = (await res.json()) as {
        spawn: Record<string, unknown>;
        captureEnabled: boolean;
      };
      assert.equal(envelope.captureEnabled, true);
      assert.equal(envelope.spawn['spawnId'], SPAWN_ID);
      assert.equal(envelope.spawn['parentOwner'], 'a4e825faeafee3619');
      assert.equal(envelope.spawn['parentNodePath'], ORCHESTRATOR);
      assert.equal(envelope.spawn['childName'], 'demo-worker');
      assert.equal(envelope.spawn['prompt'], 'continue the chain');
    });
  });

  it('an async child terminal stop attaches its report as the record response (route -> store seam)', async () => {
    await bootAndUse(async (handle) => {
      await enableCapture(handle);
      // Spawn start, then the async handoff that pins the child owner.
      await postActivity(handle, AGENT_SPAWN_PAYLOAD);
      await postActivity(handle, {
        ...AGENT_SPAWN_PAYLOAD,
        hook_event_name: 'PostToolUse',
        tool_response: { isAsync: true, status: 'async_launched', agentId: 'kid-77' },
      });
      // The child's terminal SubagentStop carries the final message
      // (live-verified 2026-07-05); the route must hand it to the
      // store, which attaches it by childOwner match.
      await postActivity(handle, {
        session_id: '6cfe5636-2e56-4271-91a6-87fc3d4355be',
        hook_event_name: 'SubagentStop',
        agent_id: 'kid-77',
        agent_type: 'demo-worker',
        last_assistant_message: 'final report of the async child',
      });
      const res = await fetch(url(handle, `/api/activity/spawns/${SPAWN_ID}`));
      assert.equal(res.status, 200);
      const envelope = (await res.json()) as { spawn: Record<string, unknown> };
      assert.equal(envelope.spawn['response'], 'final report of the async child');
      assert.equal(envelope.spawn['status'], 'completed');
    });
  });

  it('gate OFF: a terminal stop report revives nothing', async () => {
    await bootAndUse(async (handle) => {
      await postActivity(handle, AGENT_SPAWN_PAYLOAD);
      await postActivity(handle, {
        session_id: '6cfe5636-2e56-4271-91a6-87fc3d4355be',
        hook_event_name: 'SubagentStop',
        agent_id: 'kid-77',
        agent_type: 'demo-worker',
        last_assistant_message: 'report nobody consented to keep',
      });
      const res = await fetch(url(handle, `/api/activity/spawns/${SPAWN_ID}`));
      assert.equal(res.status, 404);
    });
  });
});
