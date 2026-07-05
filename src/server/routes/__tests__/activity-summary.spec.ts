/**
 * `GET /api/activity/summary` integration tests (execution stats, see
 * `spec/provider-activity.md` §Execution stats). Boots a real
 * `createServer()` against a primed-DB tempdir (the
 * activity-endpoint.spec pattern) and drives the accumulator through
 * the real ingest route, then reads the snapshot back.
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

const HASH_BODY = 'a'.repeat(64);
const HASH_FRONTMATTER = 'b'.repeat(64);
const TOKEN_HEADER = 'x-skill-map-token';
const SESSION_OWNER = 'main:6cfe5636-2e56-4271-91a6-87fc3d4355be';

const SKILL_PRETOOLUSE_PAYLOAD = {
  session_id: '6cfe5636-2e56-4271-91a6-87fc3d4355be',
  cwd: '/home/user/project',
  permission_mode: 'default',
  hook_event_name: 'PreToolUse',
  tool_name: 'Skill',
  tool_input: { skill: 'deploy' },
  tool_use_id: 'toolu_015y8G9WHeDyRfLabuUTSoeL',
};

interface ITestRoot {
  tmp: string;
  fixtureRoot: string;
  dbPath: string;
}

let root: ITestRoot;

before(() => {
  const tmp = mkdtempSync(join(tmpdir(), 'skill-map-activity-summary-'));
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
      makeNode('.claude/agents/demo-orchestrator.md', 'agent'),
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

interface ISummaryEnvelope {
  since: number;
  nodes: Record<
    string,
    { count: number; lastStartAt: number; lastOwner?: string; distinctOwners: number }
  >;
  pairs: Record<string, { count: number; lastStartAt: number }>;
}

async function getSummary(handle: IServerHandle): Promise<ISummaryEnvelope> {
  const res = await fetch(url(handle, '/api/activity/summary'));
  assert.equal(res.status, 200);
  return (await res.json()) as ISummaryEnvelope;
}

describe('GET /api/activity/summary', () => {
  it('starts empty with a boot-time `since` stamp', async () => {
    await bootAndUse(async (handle) => {
      const summary = await getSummary(handle);
      assert.ok(summary.since > 0);
      assert.ok(summary.since <= Date.now());
      assert.deepEqual(summary.nodes, {});
      assert.deepEqual(summary.pairs, {});
    });
  });

  it('a spawn populates the pairs map over the route (route -> stats seam)', async () => {
    await bootAndUse(async (handle) => {
      await postActivity(handle, {
        session_id: '6cfe5636-2e56-4271-91a6-87fc3d4355be',
        hook_event_name: 'PreToolUse',
        tool_name: 'Agent',
        tool_input: { prompt: 'run', subagent_type: 'demo-worker' },
        tool_use_id: 'toolu_01PairSummary000000001',
      });
      const summary = await getSummary(handle);
      const key = 'main:6cfe5636-2e56-4271-91a6-87fc3d4355be>>.claude/agents/demo-worker.md';
      assert.equal(summary.pairs[key]?.count, 1);
      assert.ok(summary.pairs[key]!.lastStartAt > 0);
    });
  });

  it('accumulates counted starts across posts', async () => {
    await bootAndUse(async (handle) => {
      await postActivity(handle, SKILL_PRETOOLUSE_PAYLOAD);
      await postActivity(handle, SKILL_PRETOOLUSE_PAYLOAD);
      const summary = await getSummary(handle);
      const entry = summary.nodes['.claude/skills/deploy/SKILL.md'];
      assert.equal(entry?.count, 2);
      assert.equal(entry?.lastOwner, SESSION_OWNER);
      assert.equal(entry?.distinctOwners, 1);
      assert.ok(entry!.lastStartAt >= summary.since);
    });
  });

  it('keepAlive custody claims never reach the summary', async () => {
    await bootAndUse(async (handle) => {
      // Agent-parent spawn: emits a keepAlive custody claim on the
      // orchestrator node, which must not count as an execution.
      const res = await postActivity(handle, {
        session_id: '6cfe5636-2e56-4271-91a6-87fc3d4355be',
        hook_event_name: 'PreToolUse',
        agent_id: 'a4e825faeafee3619',
        agent_type: 'demo-orchestrator',
        tool_name: 'Agent',
        tool_input: { prompt: 'continue the chain', subagent_type: 'demo-worker' },
        tool_use_id: 'toolu_01MEQBSdHNo3B9pMjY8s7ZQK',
      });
      assert.equal(res.status, 202);
      const summary = await getSummary(handle);
      assert.deepEqual(summary.nodes, {});
    });
  });
});
