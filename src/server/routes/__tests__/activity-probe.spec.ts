/**
 * Wiring self-test surface (see `spec/provider-activity.md` §Wiring
 * self-test): the `POST /api/activity` short-circuit plus the
 * `GET /api/activity/probe` readback.
 *
 * Each test boots a real `createServer()` against a primed-DB tempdir,
 * the same harness `activity-endpoint.spec.ts` uses, so the probe is
 * exercised against the real token gate and the real ingest pipeline.
 *
 * Coverage:
 *   - probe ingest: 202 `{ probe: true }`, readback flips to `seen`.
 *   - INERTNESS (the load-bearing property): a probe leaves the
 *     execution stats empty, so it can never light a node or count as
 *     an execution.
 *   - the token gate still applies to a probe (403 without it).
 *   - unknown nonce reads `seen: false`; missing nonce → 400.
 *   - a real provider payload still resolves normally afterwards, so
 *     the short-circuit did not swallow ordinary events.
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import { SqliteStorageAdapter } from '../../../kernel/adapters/sqlite/index.js';
import { persistScanResult } from '../../../kernel/adapters/sqlite/scan-persistence.js';
import type { Node, ScanResult } from '../../../kernel/types.js';
import { PROBE_MARKER } from '../../../core/activity/probe.js';
import { createServer, type IServerHandle, type IServerOptions } from '../../index.js';

const HASH_BODY = 'a'.repeat(64);
const HASH_FRONTMATTER = 'b'.repeat(64);
const TOKEN_HEADER = 'x-skill-map-token';

/** Real captured payload: model-invoked skill, main context. */
const SKILL_PRETOOLUSE_PAYLOAD = {
  session_id: '6cfe5636-2e56-4271-91a6-87fc3d4355be',
  cwd: '/home/user/project',
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
  const tmp = mkdtempSync(join(tmpdir(), 'skill-map-activity-probe-'));
  root = { tmp, fixtureRoot: join(tmp, 'fixture'), dbPath: join(tmp, 'primed.db') };
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
    nodes: [makeSkillNode('.claude/skills/deploy/SKILL.md')],
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
  const adapter = new SqliteStorageAdapter({ databasePath: root.dbPath, autoBackup: false });
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

async function readProbe(handle: IServerHandle, nonce: string): Promise<Response> {
  return fetch(url(handle, `/api/activity/probe?nonce=${encodeURIComponent(nonce)}`));
}

describe('wiring self-test probe', () => {
  it('ingests a probe, answers `probe: true`, and reads back as seen', async () => {
    await bootAndUse(async (handle) => {
      const nonce = 'probe-nonce-1';
      const before = await readProbe(handle, nonce);
      assert.equal(before.status, 200);
      assert.deepEqual(await before.json(), { nonce, seen: false, at: null });

      const res = await postActivity(
        handle,
        { provider: 'claude', event: { [PROBE_MARKER]: nonce } },
        handle.activityToken,
      );
      assert.equal(res.status, 202);
      assert.deepEqual(await res.json(), { ok: true, probe: true });

      const after = await readProbe(handle, nonce);
      const body = (await after.json()) as { seen: boolean; at: number | null };
      assert.equal(body.seen, true);
      assert.equal(typeof body.at, 'number');
    });
  });

  it('leaves the execution stats untouched (a probe can never light a node)', async () => {
    await bootAndUse(async (handle) => {
      await postActivity(
        handle,
        { provider: 'claude', event: { [PROBE_MARKER]: 'inert' } },
        handle.activityToken,
      );
      const summary = (await (await fetch(url(handle, '/api/activity/summary'))).json()) as {
        nodes: Record<string, unknown>;
        pairs: Record<string, unknown>;
      };
      assert.deepEqual(summary.nodes, {});
      assert.deepEqual(summary.pairs, {});
    });
  });

  it('still enforces the ingest token on a probe', async () => {
    await bootAndUse(async (handle) => {
      const res = await postActivity(handle, {
        provider: 'claude',
        event: { [PROBE_MARKER]: 'no-token' },
      });
      assert.equal(res.status, 403);
      const after = (await (await readProbe(handle, 'no-token')).json()) as { seen: boolean };
      assert.equal(after.seen, false);
    });
  });

  it('reports an unknown nonce as unseen and rejects a missing one', async () => {
    await bootAndUse(async (handle) => {
      const unknown = (await (await readProbe(handle, 'never-sent')).json()) as { seen: boolean };
      assert.equal(unknown.seen, false);

      const missing = await fetch(url(handle, '/api/activity/probe'));
      assert.equal(missing.status, 400);
    });
  });

  it('does not swallow ordinary provider events', async () => {
    await bootAndUse(async (handle) => {
      await postActivity(
        handle,
        { provider: 'claude', event: { [PROBE_MARKER]: 'first' } },
        handle.activityToken,
      );
      const res = await postActivity(
        handle,
        { provider: 'claude', event: SKILL_PRETOOLUSE_PAYLOAD },
        handle.activityToken,
      );
      assert.equal(res.status, 202);
      assert.deepEqual(await res.json(), { ok: true, resolved: 1, spawns: 0 });
    });
  });
});
