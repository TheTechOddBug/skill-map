/**
 * `POST /api/job-events` integration tests (the CLI-to-server push leg,
 * `spec/job-events.md` §Transport).
 *
 * Each test boots a real `createServer()` against a bare tempdir that
 * has NO `.skill-map` DB at all: the route is DB-free by contract (the
 * job row already carries the truth; the push is a cache-invalidation
 * hint), so the whole suite doubles as the no-DB regression guard.
 *
 * Coverage:
 *   - 403 `token-mismatch`: missing token, wrong token (before body work).
 *   - 400 `bad-query`: non-catalog `type`, missing `jobId`, non-integer
 *     `timestamp`, non-object `data`, unknown envelope field, non-object
 *     body.
 *   - 202 `{ ok: true }` + the envelope arrives VERBATIM on a connected
 *     `/ws` client (including unknown `data` fields, which are forwarded,
 *     not stripped: consumers ignore them per the catalog).
 *   - all five catalog `job.*` types are accepted.
 */

import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import WebSocket from 'ws';

import {
  createServer,
  type IServerOptions,
  type IServerHandle,
} from '../../index.js';

const TOKEN_HEADER = 'x-skill-map-token';

/** A canonical `job.claimed` envelope (`spec/job-events.md` §`job.claimed`). */
const CLAIMED_EVENT = {
  type: 'job.claimed',
  timestamp: 1745159455300,
  runId: 'r-ext-20260420-143055-a3f2',
  jobId: 'd-20260420-143055-b001',
  data: {
    extensionId: 'prob-summarizer/skill-echo',
    extensionVersion: '1.2.0',
    nodeId: '.claude/skills/foo/SKILL.md',
    ttlSeconds: 180,
    priority: 0,
  },
} as const;

let tmp: string;
let dbPath: string;

before(() => {
  tmp = mkdtempSync(join(tmpdir(), 'skill-map-job-events-endpoint-'));
  dbPath = join(tmp, '.skill-map', 'skill-map.db');
});

after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function defaultOptions(): IServerOptions {
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
    settingsEnv: {},
  };
}

async function bootAndUse<T>(fn: (handle: IServerHandle) => Promise<T>): Promise<T> {
  const handle = await createServer(defaultOptions(), {
    runtimeContext: { cwd: tmp },
  });
  try {
    return await fn(handle);
  } finally {
    await handle.close();
  }
}

async function postJobEvent(
  handle: IServerHandle,
  body: unknown,
  token?: string,
): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== undefined) headers[TOKEN_HEADER] = token;
  return fetch(`http://127.0.0.1:${handle.address.port}/api/job-events`, {
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

describe('POST /api/job-events, token gate', () => {
  it('403 token-mismatch when the header is missing', async () => {
    await bootAndUse(async (handle) => {
      const res = await postJobEvent(handle, CLAIMED_EVENT);
      assert.equal(res.status, 403);
      const envelope = (await res.json()) as { ok: boolean; error: { code: string } };
      assert.equal(envelope.ok, false);
      assert.equal(envelope.error.code, 'token-mismatch');
    });
  });

  it('403 token-mismatch on a wrong token', async () => {
    await bootAndUse(async (handle) => {
      const res = await postJobEvent(
        handle,
        CLAIMED_EVENT,
        'f'.repeat(handle.activityToken.length),
      );
      assert.equal(res.status, 403);
      const envelope = (await res.json()) as { error: { code: string } };
      assert.equal(envelope.error.code, 'token-mismatch');
    });
  });
});

describe('POST /api/job-events, body validation', () => {
  it('400 bad-query on every malformed envelope', async () => {
    await bootAndUse(async (handle) => {
      const bads: unknown[] = [
        // Non-catalog type (a WS event type, but not a pushed job.* one).
        { ...CLAIMED_EVENT, type: 'scan.started' },
        { ...CLAIMED_EVENT, type: 'nope' },
        // Missing jobId (every pushed catalog type is job-scoped).
        { ...CLAIMED_EVENT, jobId: undefined },
        { ...CLAIMED_EVENT, jobId: null },
        // Non-integer timestamp / non-string runId / non-object data.
        { ...CLAIMED_EVENT, timestamp: '2026-07-17T00:00:00Z' },
        { ...CLAIMED_EVENT, runId: 42 },
        { ...CLAIMED_EVENT, data: 'not-an-object' },
        // Unknown envelope-level field (the envelope is closed; only
        // `data` is open-ended).
        { ...CLAIMED_EVENT, extra: true },
        // Not an object at all.
        [CLAIMED_EVENT],
        'job.claimed',
      ];
      for (const bad of bads) {
        const res = await postJobEvent(handle, bad, handle.activityToken);
        assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(bad)}`);
        const envelope = (await res.json()) as { error: { code: string } };
        assert.equal(envelope.error.code, 'bad-query');
      }
    });
  });
});

describe('POST /api/job-events, rebroadcast', () => {
  it('202 and the envelope reaches a connected /ws client VERBATIM (no DB present)', async () => {
    // The route is DB-free by contract: prove the project has no DB at
    // all while the push round-trips.
    assert.equal(existsSync(dbPath), false, 'suite precondition: no project DB');
    await bootAndUse(async (handle) => {
      // Unknown data fields ride along untouched (consumers ignore
      // them per the catalog; the server must not strip them).
      const sent = { ...CLAIMED_EVENT, data: { ...CLAIMED_EVENT.data, futureField: 'x' } };
      const [frame] = await withWsFrames(handle, 1, async () => {
        const res = await postJobEvent(handle, sent, handle.activityToken);
        assert.equal(res.status, 202);
        assert.deepEqual(await res.json(), { ok: true });
      });
      assert.deepEqual(frame, sent);
    });
    assert.equal(existsSync(dbPath), false, 'the push must not create a DB');
  });

  it('accepts all five catalog job.* types', async () => {
    await bootAndUse(async (handle) => {
      const types = [
        'job.submitted',
        'job.claimed',
        'job.completed',
        'job.failed',
        'job.cancelled',
      ];
      const frames = await withWsFrames(handle, types.length, async () => {
        for (const type of types) {
          const res = await postJobEvent(
            handle,
            { ...CLAIMED_EVENT, type, data: {} },
            handle.activityToken,
          );
          assert.equal(res.status, 202, `expected 202 for ${type}`);
        }
      });
      assert.deepEqual(
        frames.map((f) => f['type']),
        types,
      );
    });
  });
});
