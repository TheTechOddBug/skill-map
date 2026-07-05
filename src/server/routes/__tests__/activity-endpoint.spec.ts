/**
 * `POST /api/activity` integration tests (live node activity, see
 * `spec/provider-activity.md` §Ingest).
 *
 * Each test boots a real `createServer()` (built-ins ON, so the real
 * `claude` provider and its activity adapter are registered) against a
 * primed-DB tempdir and fires `fetch()` at the endpoint. The happy path
 * sends a REAL captured Claude hook payload and asserts it resolves to
 * the primed skill node and reaches a live `/ws` client as a
 * `node.activity` envelope.
 *
 * Coverage:
 *   - 403 `token-mismatch`: missing token, wrong token (before body work).
 *   - 400 `bad-query`: malformed body shapes.
 *   - 202 `resolved: 0`: unknown provider, disclaimed event.
 *   - 202 `resolved: 1` + WS broadcast: real Skill payload vs primed node
 *     (sessionized owner, server-side stats on the frame).
 *   - spawn relations: agent-parent custody (keepAlive `node.activity` +
 *     `agent.spawn` frame) and main-parent relation-only spawns
 *     (`resolved: 0, spawns: 1`, no `parentNodePath` on the frame).
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import WebSocket from 'ws';

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

/** Real captured payload: model-invoked skill, main context (probe run 2026-06-29). */
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
  const tmp = mkdtempSync(join(tmpdir(), 'skill-map-activity-endpoint-'));
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
      makeSkillNode('.claude/skills/deploy/SKILL.md'),
      { ...makeSkillNode('notes/todo.md'), kind: 'markdown', provider: 'markdown' },
      { ...makeSkillNode('.claude/agents/demo-orchestrator.md'), kind: 'agent' },
      { ...makeSkillNode('.claude/agents/demo-worker.md'), kind: 'agent' },
    ],
    links: [],
    issues: [],
    stats: {
      filesWalked: 1,
      filesSkipped: 0,
      nodesCount: 1,
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

function makeSkillNode(path: string): Node {
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

async function postActivity(
  handle: IServerHandle,
  body: unknown,
  token?: string,
): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== undefined) headers[TOKEN_HEADER] = token;
  return fetch(url(handle, '/api/activity'), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

/**
 * Open a `/ws` client, run `fn`, and resolve with the first `expected`
 * frames received (parsed envelopes, arrival order preserved).
 */
async function withWsFrames(
  handle: IServerHandle,
  expected: number,
  fn: () => Promise<void>,
): Promise<Record<string, unknown>[]> {
  const ws = new WebSocket(`ws://127.0.0.1:${handle.address.port}/ws`);
  const frames: Record<string, unknown>[] = [];
  const received = new Promise<Record<string, unknown>[]>((resolve, reject) => {
    ws.on('message', (frame) => {
      frames.push(JSON.parse(String(frame)) as Record<string, unknown>);
      if (frames.length === expected) resolve(frames);
    });
    ws.on('error', reject);
  });
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', reject);
  });
  try {
    await fn();
    return await received;
  } finally {
    ws.close();
  }
}

describe('POST /api/activity, token gate', () => {
  it('403 token-mismatch when the header is missing', async () => {
    await bootAndUse(async (handle) => {
      const res = await postActivity(handle, { provider: 'claude', event: {} });
      assert.equal(res.status, 403);
      const envelope = (await res.json()) as { ok: boolean; error: { code: string } };
      assert.equal(envelope.ok, false);
      assert.equal(envelope.error.code, 'token-mismatch');
    });
  });

  it('403 token-mismatch on a wrong token', async () => {
    await bootAndUse(async (handle) => {
      const res = await postActivity(
        handle,
        { provider: 'claude', event: {} },
        'f'.repeat(handle.activityToken.length),
      );
      assert.equal(res.status, 403);
      const envelope = (await res.json()) as { error: { code: string } };
      assert.equal(envelope.error.code, 'token-mismatch');
    });
  });
});

describe('POST /api/activity, body validation', () => {
  it('400 on a body missing `provider` / `event`', async () => {
    await bootAndUse(async (handle) => {
      for (const bad of [{}, { provider: 'claude' }, { event: {} }, { provider: '', event: {} }]) {
        const res = await postActivity(handle, bad, handle.activityToken);
        assert.equal(res.status, 400);
      }
    });
  });
});

describe('POST /api/activity, ingest', () => {
  it('202 resolved: 0 for an unknown provider (fire-and-forget contract)', async () => {
    await bootAndUse(async (handle) => {
      const res = await postActivity(
        handle,
        { provider: 'not-a-provider', event: SKILL_PRETOOLUSE_PAYLOAD },
        handle.activityToken,
      );
      assert.equal(res.status, 202);
      const body = (await res.json()) as { ok: boolean; resolved: number; spawns: number };
      assert.deepEqual(body, { ok: true, resolved: 0, spawns: 0 });
    });
  });

  it('202 resolved: 0 for a disclaimed event (plain tool call)', async () => {
    await bootAndUse(async (handle) => {
      const res = await postActivity(
        handle,
        {
          provider: 'claude',
          event: { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } },
        },
        handle.activityToken,
      );
      assert.equal(res.status, 202);
      const body = (await res.json()) as { resolved: number };
      assert.equal(body.resolved, 0);
    });
  });

  it('202 resolved: 1 for an in-scope markdown Read (path-based resolution)', async () => {
    await bootAndUse(async (handle) => {
      const res = await postActivity(
        handle,
        {
          provider: 'claude',
          event: {
            cwd: root.fixtureRoot,
            hook_event_name: 'PreToolUse',
            tool_name: 'Read',
            tool_input: { file_path: `${root.fixtureRoot}/notes/todo.md` },
          },
        },
        handle.activityToken,
      );
      assert.equal(res.status, 202);
      const body = (await res.json()) as { resolved: number };
      assert.equal(body.resolved, 1);
    });
  });

  it('202 resolved: 0 for a non-markdown Read (mapEvent early filter)', async () => {
    await bootAndUse(async (handle) => {
      const res = await postActivity(
        handle,
        {
          provider: 'claude',
          event: {
            cwd: root.fixtureRoot,
            hook_event_name: 'PreToolUse',
            tool_name: 'Read',
            tool_input: { file_path: `${root.fixtureRoot}/src/index.ts` },
          },
        },
        handle.activityToken,
      );
      assert.equal(res.status, 202);
      const body = (await res.json()) as { resolved: number };
      assert.equal(body.resolved, 0);
    });
  });

  it('202 resolved: 1 and a stats-enriched `node.activity` broadcast for a real Skill payload', async () => {
    await bootAndUse(async (handle) => {
      const [event] = await withWsFrames(handle, 1, async () => {
        const res = await postActivity(
          handle,
          { provider: 'claude', event: SKILL_PRETOOLUSE_PAYLOAD },
          handle.activityToken,
        );
        assert.equal(res.status, 202);
        const body = (await res.json()) as { resolved: number; spawns: number };
        assert.equal(body.resolved, 1);
        assert.equal(body.spawns, 0);
      });

      assert.equal(event!['type'], 'node.activity');
      const data = event!['data'] as {
        nodePath: string;
        phase: string;
        owner: string;
        stats: { count: number; lastStartAt: number; lastOwner?: string; distinctOwners: number };
      };
      assert.equal(data.nodePath, '.claude/skills/deploy/SKILL.md');
      assert.equal(data.phase, 'start');
      // Sessionized main owner (the payload carries session_id).
      assert.equal(data.owner, 'main:6cfe5636-2e56-4271-91a6-87fc3d4355be');
      assert.equal(data.stats.count, 1);
      assert.equal(data.stats.lastOwner, 'main:6cfe5636-2e56-4271-91a6-87fc3d4355be');
      assert.equal(data.stats.distinctOwners, 1);
      assert.ok(data.stats.lastStartAt > 0);
    });
  });

  it('a second identical Skill post counts again (stats.count: 2 on the frame)', async () => {
    await bootAndUse(async (handle) => {
      await postActivity(
        handle,
        { provider: 'claude', event: SKILL_PRETOOLUSE_PAYLOAD },
        handle.activityToken,
      );
      const [event] = await withWsFrames(handle, 1, async () => {
        await postActivity(
          handle,
          { provider: 'claude', event: SKILL_PRETOOLUSE_PAYLOAD },
          handle.activityToken,
        );
      });
      const data = event!['data'] as { stats: { count: number; distinctOwners: number } };
      assert.equal(data.stats.count, 2);
      assert.equal(data.stats.distinctOwners, 1);
    });
  });

  it('an AGENT-parent spawn yields keepAlive custody plus an `agent.spawn` frame', async () => {
    await bootAndUse(async (handle) => {
      const frames = await withWsFrames(handle, 2, async () => {
        const res = await postActivity(
          handle,
          {
            provider: 'claude',
            event: {
              session_id: '6cfe5636-2e56-4271-91a6-87fc3d4355be',
              hook_event_name: 'PreToolUse',
              agent_id: 'a4e825faeafee3619',
              agent_type: 'demo-orchestrator',
              tool_name: 'Agent',
              tool_input: { prompt: 'continue the chain', subagent_type: 'demo-worker' },
              tool_use_id: 'toolu_01MEQBSdHNo3B9pMjY8s7ZQK',
            },
          },
          handle.activityToken,
        );
        const body = (await res.json()) as { resolved: number; spawns: number };
        assert.equal(body.resolved, 1);
        assert.equal(body.spawns, 1);
      });

      assert.equal(frames[0]!['type'], 'node.activity');
      // Custody claim: keepAlive, so NOT counted (no stats attached).
      assert.deepEqual(frames[0]!['data'], {
        nodePath: '.claude/agents/demo-orchestrator.md',
        phase: 'start',
        owner: 'spawn:toolu_01MEQBSdHNo3B9pMjY8s7ZQK',
        sticky: true,
        keepAlive: true,
      });

      assert.equal(frames[1]!['type'], 'agent.spawn');
      // Metadata only: the prompt from tool_input must never ride the WS.
      assert.deepEqual(frames[1]!['data'], {
        spawnId: 'toolu_01MEQBSdHNo3B9pMjY8s7ZQK',
        phase: 'start',
        parentOwner: 'a4e825faeafee3619',
        parentNodePath: '.claude/agents/demo-orchestrator.md',
        childKind: 'agent',
        childName: 'demo-worker',
        childNodePath: '.claude/agents/demo-worker.md',
      });
    });
  });

  it('a MAIN spawn answers resolved: 0, spawns: 1 with a session-parent frame', async () => {
    await bootAndUse(async (handle) => {
      const frames = await withWsFrames(handle, 1, async () => {
        const res = await postActivity(
          handle,
          {
            provider: 'claude',
            event: {
              session_id: '6cfe5636-2e56-4271-91a6-87fc3d4355be',
              hook_event_name: 'PreToolUse',
              tool_name: 'Agent',
              tool_input: { prompt: 'run the demo worker', subagent_type: 'demo-worker' },
              tool_use_id: 'toolu_01Hs3r6xww87USRS7FjNrYyv',
            },
          },
          handle.activityToken,
        );
        const body = (await res.json()) as { ok: boolean; resolved: number; spawns: number };
        assert.deepEqual(body, { ok: true, resolved: 0, spawns: 1 });
      });

      assert.equal(frames[0]!['type'], 'agent.spawn');
      // ABSENT parentNodePath is the session-parent discriminator; the
      // owner key itself stays opaque.
      assert.deepEqual(frames[0]!['data'], {
        spawnId: 'toolu_01Hs3r6xww87USRS7FjNrYyv',
        phase: 'start',
        parentOwner: 'main:6cfe5636-2e56-4271-91a6-87fc3d4355be',
        childKind: 'agent',
        childName: 'demo-worker',
        childNodePath: '.claude/agents/demo-worker.md',
      });
    });
  });
});
