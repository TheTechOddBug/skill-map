/**
 * `GET /api/activity/node/:pathB64` + `GET /api/activity/spawns/:spawnId`
 * integration tests (see `spec/provider-activity.md` §Execution stats +
 * §Conversation capture). Boots a real `createServer()` against a
 * primed-DB tempdir (the activity-endpoint.spec pattern); spawn
 * records are driven through the real ingest route and the capture
 * gate through the real `POST /api/activity/capture` consent flow.
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import { SqliteStorageAdapter } from '../../../kernel/adapters/sqlite/index.js';
import { persistScanResult } from '../../../kernel/adapters/sqlite/scan-persistence.js';
import type { ExecutionRecord, Node, ScanResult } from '../../../kernel/types.js';
import {
  createServer,
  type IServerOptions,
  type IServerHandle,
} from '../../index.js';
import { encodeNodePath } from '../../path-codec.js';
import { RUNS_LIMIT } from '../activity-detail.js';

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

const RUN_BASE_MS = 1_700_000_000_000;

/**
 * One seedable `state_executions` row targeting `ORCHESTRATOR` by
 * default. `startedAt` grows with `n` so newest-first ordering is
 * deterministic. `reportPath` is populated on purpose: the endpoint
 * must never let it (or any report content) reach the wire.
 */
function makeExecution(n: number, overrides: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
    id: `e-run-${String(n).padStart(3, '0')}`,
    kind: 'action',
    extensionId: 'core/skill-summarizer',
    extensionVersion: '1.0.0',
    nodeIds: [ORCHESTRATOR],
    status: 'completed',
    startedAt: RUN_BASE_MS + n * 1000,
    finishedAt: RUN_BASE_MS + n * 1000 + 500,
    durationMs: 500,
    model: 'test-model',
    reportPath: '{"secret":"never-on-the-wire"}',
    ...overrides,
  };
}

async function seedExecutions(execs: ExecutionRecord[]): Promise<void> {
  const adapter = new SqliteStorageAdapter({
    databasePath: root.dbPath,
    autoBackup: false,
  });
  await adapter.init();
  try {
    for (const exec of execs) await adapter.history.insertExecution(exec);
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
    settingsEnv: {},
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
  runs: Record<string, unknown>[];
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
        runs: [],
      });
    });
  });

  it('runs: seeded state_executions rows, newest-first, capped at RUNS_LIMIT, lean projection', async () => {
    // 22 orchestrator rows (well over the cap; the newest one failed) plus
    // one row on a DIFFERENT node that must not bleed into the list.
    const seeded = Array.from({ length: 21 }, (_, i) => makeExecution(i + 1));
    seeded.push(
      makeExecution(22, {
        status: 'failed',
        failureReason: 'timeout',
        model: null,
        durationMs: null,
      }),
      makeExecution(99, { nodeIds: ['.claude/skills/deploy/SKILL.md'] }),
    );
    await seedExecutions(seeded);
    await bootAndUse(async (handle) => {
      const res = await getNodeDetail(handle, ORCHESTRATOR);
      assert.equal(res.status, 200);
      const detail = (await res.json()) as INodeDetailEnvelope;
      assert.equal(detail.runs.length, RUNS_LIMIT);
      // Newest first: 22 (failed) at the top; the oldest rows past the cap fall off.
      assert.deepEqual(detail.runs[0], {
        executionId: 'e-run-022',
        extensionId: 'core/skill-summarizer',
        status: 'failed',
        model: null,
        durationMs: null,
        finishedAt: RUN_BASE_MS + 22 * 1000 + 500,
        failureReason: 'timeout',
      });
      assert.deepEqual(detail.runs[1], {
        executionId: 'e-run-021',
        extensionId: 'core/skill-summarizer',
        status: 'completed',
        model: 'test-model',
        durationMs: 500,
        finishedAt: RUN_BASE_MS + 21 * 1000 + 500,
        failureReason: null,
      });
      // Newest first from the 22 seeded rows: the oldest kept is
      // e-run-<22 - RUNS_LIMIT + 1> at the last kept index; older rows fall off.
      assert.equal(
        detail.runs[RUNS_LIMIT - 1]?.['executionId'],
        `e-run-${String(22 - RUNS_LIMIT + 1).padStart(3, '0')}`,
      );
      // Lean wire: exactly the spec key set, nothing from the report /
      // job linkage / token family leaks onto any entry.
      for (const entry of detail.runs) {
        assert.deepEqual(Object.keys(entry).sort(), [
          'durationMs',
          'executionId',
          'extensionId',
          'failureReason',
          'finishedAt',
          'model',
          'status',
        ]);
      }
      // The other node sees only its own run.
      const other = await getNodeDetail(handle, '.claude/skills/deploy/SKILL.md');
      const otherDetail = (await other.json()) as INodeDetailEnvelope;
      assert.deepEqual(
        otherDetail.runs.map((r) => r['executionId']),
        ['e-run-099'],
      );
    });
  });

  it('missing DB: degrades to runs: [] with the runtime half still answering', async () => {
    await bootAndUse(async (handle) => {
      rmSync(root.dbPath, { force: true });
      rmSync(`${root.dbPath}-wal`, { force: true });
      rmSync(`${root.dbPath}-shm`, { force: true });
      const res = await getNodeDetail(handle, ORCHESTRATOR);
      assert.equal(res.status, 200);
      const detail = (await res.json()) as INodeDetailEnvelope;
      assert.deepEqual(detail, {
        stats: { count: 0, lastStartAt: 0, distinctOwners: 0 },
        recent: [],
        spawns: [],
        captureEnabled: false,
        runs: [],
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

  it('a sync completion with totals lands as record execution AND node aggregates (route -> stats seam)', async () => {
    await bootAndUse(async (handle) => {
      await enableCapture(handle);
      await postActivity(handle, AGENT_SPAWN_PAYLOAD);
      await postActivity(handle, {
        ...AGENT_SPAWN_PAYLOAD,
        hook_event_name: 'PostToolUse',
        tool_response: {
          status: 'completed',
          content: [{ type: 'text', text: 'done' }],
          totalDurationMs: 27219,
          totalTokens: 4132,
          totalToolUseCount: 6,
        },
      });
      const spawnRes = await fetch(url(handle, `/api/activity/spawns/${SPAWN_ID}`));
      const spawnEnvelope = (await spawnRes.json()) as { spawn: Record<string, unknown> };
      assert.deepEqual(spawnEnvelope.spawn['execution'], {
        durationMs: 27219,
        tokens: 4132,
        toolUses: 6,
      });
      // The child node's aggregates fold the same summary.
      const detail = await getNodeDetail(handle, '.claude/agents/demo-worker.md');
      const body = (await detail.json()) as {
        stats: { toolUses?: number; tokens?: number; summarizedRuns?: number };
      };
      assert.equal(body.stats.toolUses, 6);
      assert.equal(body.stats.tokens, 4132);
      assert.equal(body.stats.summarizedRuns, 1);
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

describe('DELETE /api/activity/node/:pathB64', () => {
  function deleteNodeActivity(handle: IServerHandle, path: string): Promise<Response> {
    return fetch(url(handle, `/api/activity/node/${encodeNodePath(path)}`), {
      method: 'DELETE',
    });
  }

  /** A counted (non-custody) start lighting the orchestrator's runtime stats. */
  const COUNTED_START_PAYLOAD = {
    session_id: '6cfe5636-2e56-4271-91a6-87fc3d4355be',
    hook_event_name: 'SubagentStart',
    agent_id: 'a4e825faeafee3619',
    agent_type: 'demo-orchestrator',
  };

  it('404 for a path that is not a scanned node (and for malformed pathB64)', async () => {
    await bootAndUse(async (handle) => {
      const missing = await deleteNodeActivity(handle, 'not/scanned.md');
      assert.equal(missing.status, 404);
      const malformed = await fetch(url(handle, '/api/activity/node/%2e%2e'), {
        method: 'DELETE',
      });
      assert.equal(malformed.status, 404);
    });
  });

  it('clears runs + runtime stats + spawns for the node only, answers 204, logs activity.clear', async () => {
    await seedExecutions([
      makeExecution(1),
      makeExecution(2),
      makeExecution(99, { nodeIds: ['.claude/skills/deploy/SKILL.md'] }),
    ]);
    // The operations log is silent without a `.skill-map/` dir; create it
    // so the `activity.clear` line is observable.
    mkdirSync(join(root.fixtureRoot, '.skill-map'), { recursive: true });
    await bootAndUse(async (handle) => {
      await enableCapture(handle);
      await postActivity(handle, AGENT_SPAWN_PAYLOAD);
      await postActivity(handle, COUNTED_START_PAYLOAD);

      const res = await deleteNodeActivity(handle, ORCHESTRATOR);
      assert.equal(res.status, 204);

      // The node is fully quiet afterwards; the capture gate itself is
      // untouched by a clear.
      const after = (await (await getNodeDetail(handle, ORCHESTRATOR)).json()) as INodeDetailEnvelope;
      assert.deepEqual(after, {
        stats: { count: 0, lastStartAt: 0, distinctOwners: 0 },
        recent: [],
        spawns: [],
        captureEnabled: true,
        runs: [],
      });
      // The dropped spawn record is gone by id too, not just from the list.
      assert.equal(
        (await fetch(url(handle, `/api/activity/spawns/${SPAWN_ID}`))).status,
        404,
      );
      // The OTHER node's history is untouched.
      const other = (await (
        await getNodeDetail(handle, '.claude/skills/deploy/SKILL.md')
      ).json()) as INodeDetailEnvelope;
      assert.deepEqual(
        other.runs.map((r) => r['executionId']),
        ['e-run-099'],
      );
      // One operations-log line with the counts it had in hand.
      const log = readFileSync(
        join(root.fixtureRoot, '.skill-map', 'operations.log'),
        'utf8',
      );
      assert.match(log, /"op":"activity\.clear"/);
      assert.match(log, /"detail":"runs=2 spawns=1"/);
    });
  });

  it('missing DB: clears the runtime half and still answers 204', async () => {
    await bootAndUse(async (handle) => {
      await postActivity(handle, COUNTED_START_PAYLOAD);
      rmSync(root.dbPath, { force: true });
      rmSync(`${root.dbPath}-wal`, { force: true });
      rmSync(`${root.dbPath}-shm`, { force: true });
      const res = await deleteNodeActivity(handle, ORCHESTRATOR);
      assert.equal(res.status, 204);
      const detail = (await (await getNodeDetail(handle, ORCHESTRATOR)).json()) as INodeDetailEnvelope;
      assert.deepEqual(detail.stats, { count: 0, lastStartAt: 0, distinctOwners: 0 });
      assert.deepEqual(detail.recent, []);
    });
  });
});
