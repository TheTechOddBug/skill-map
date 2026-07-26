/**
 * Unit coverage for `AgentDoorbell` (spec/job-lifecycle.md §Agent
 * doorbell): registration (loopback rule, idempotence), the observe →
 * settle → still-queued → wake pipeline, the consent gate, the cooldown,
 * and the boot-ping exclusion. The runtime API is a fake fetch; the DB
 * is a real primed sqlite file (`:memory:` is unusable with the
 * adapter, see the SqliteStorageAdapter note).
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { SqliteStorageAdapter } from '../../kernel/adapters/sqlite/index.js';
import type { IJobSubmitRow } from '../../kernel/types/storage.js';
import { AgentDoorbell, WAKE_PROMPT, WAKE_SESSION_TITLE } from '../agent-doorbell.js';
import { PING_EXTENSION_ID } from '../boot-ping.js';

let tmp: string;
let dbPath: string;

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'sm-doorbell-'));
  dbPath = join(tmp, 'skill-map.db');
  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  await adapter.close();
});

after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** Seed one job row in the given status. */
async function seedJob(id: string, status: 'queued' | 'running'): Promise<void> {
  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  try {
    const row: IJobSubmitRow = {
      id,
      extensionId: 'core/ai-summary-action',
      extensionVersion: '1.0.0',
      extensionKind: 'action',
      nodeId: 'a.md',
      contentHash: id.replace(/[^a-z0-9]/g, '0').padEnd(64, 'c').slice(0, 64),
      nonce: `nonce-${id}`,
      priority: 0,
      status: 'queued',
      ttlSeconds: 3600,
      createdAt: Date.now(),
    };
    await adapter.jobs.submit(row, {
      contentHash: row.contentHash,
      content: 'rendered',
      createdAt: row.createdAt,
    });
    if (status === 'running') {
      await adapter.db
        .updateTable('state_jobs')
        .set({ status: 'running' })
        .where('id', '=', id)
        .execute();
    }
  } finally {
    await adapter.close();
  }
}

/** A cwd whose settings.local.json holds the consent gate. */
function makeCwd(wakeOnSubmit: boolean): string {
  const cwd = mkdtempSync(join(tmp, 'proj-'));
  mkdirSync(join(cwd, '.skill-map'), { recursive: true });
  writeFileSync(
    join(cwd, '.skill-map', 'settings.local.json'),
    JSON.stringify({ jobs: { wakeOnSubmit } }),
  );
  return cwd;
}

interface IFakeCall {
  url: string;
  body: unknown;
}

/** Fake runtime API: records calls, answers a session id then ok. */
function fakeRuntime(): { calls: IFakeCall[]; fetchImpl: typeof fetch } {
  const calls: IFakeCall[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: JSON.parse(String(init?.body ?? 'null')) });
    const payload = url.endsWith('/session') ? { id: 'ses_wake_1' } : { ok: true };
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

function submitEnvelope(jobId: string, extensionId = 'core/ai-summary-action'): unknown {
  return {
    type: 'job.submitted',
    timestamp: Date.now(),
    runId: 'run_x',
    jobId,
    data: { nodePath: 'a.md', extensionId, supersededIds: [] },
  };
}

/** Doorbell with test timings; settle is near-instant. */
function makeDoorbell(cwd: string, fetchImpl: typeof fetch, cooldownMs = 60_000): AgentDoorbell {
  return new AgentDoorbell({ cwd, dbPath, fetchImpl, settleMs: 5, cooldownMs });
}

async function settled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 60));
}

describe('AgentDoorbell registration', () => {
  it('accepts loopback urls and refuses everything else', () => {
    const bell = makeDoorbell(makeCwd(true), fakeRuntime().fetchImpl);
    assert.equal(bell.register('http://127.0.0.1:4096'), 'registered');
    assert.equal(bell.register('http://localhost:4096/'), 'registered');
    assert.equal(bell.register('http://192.168.1.20:4096'), 'not-loopback');
    assert.equal(bell.register('http://example.com'), 'not-loopback');
    assert.equal(bell.register('not a url'), 'invalid-url');
    // Last successful write wins; refusals never clobber.
    assert.equal(bell.endpoint, 'http://localhost:4096/');
  });
});

describe('AgentDoorbell wake pipeline', () => {
  it('wakes a still-queued submit: one session, one once-mode prompt', async () => {
    await seedJob('d-20260101-000000-0001', 'queued');
    const runtime = fakeRuntime();
    const bell = makeDoorbell(makeCwd(true), runtime.fetchImpl);
    bell.register('http://127.0.0.1:4096');

    bell.observe(submitEnvelope('d-20260101-000000-0001'));
    await settled();

    assert.equal(runtime.calls.length, 2, 'session create + prompt_async');
    assert.ok(runtime.calls[0]!.url.endsWith('/session'));
    assert.deepEqual(runtime.calls[0]!.body, { title: WAKE_SESSION_TITLE });
    assert.ok(runtime.calls[1]!.url.endsWith('/session/ses_wake_1/prompt_async'));
    assert.deepEqual(runtime.calls[1]!.body, {
      parts: [{ type: 'text', text: WAKE_PROMPT }],
    });
  });

  it('stays silent when the consent gate is off (default)', async () => {
    await seedJob('d-20260101-000000-0002', 'queued');
    const runtime = fakeRuntime();
    const bell = makeDoorbell(makeCwd(false), runtime.fetchImpl);
    bell.register('http://127.0.0.1:4096');

    bell.observe(submitEnvelope('d-20260101-000000-0002'));
    await settled();
    assert.equal(runtime.calls.length, 0);
  });

  it('stays silent when the job was claimed during the settle window', async () => {
    await seedJob('d-20260101-000000-0003', 'running');
    const runtime = fakeRuntime();
    const bell = makeDoorbell(makeCwd(true), runtime.fetchImpl);
    bell.register('http://127.0.0.1:4096');

    bell.observe(submitEnvelope('d-20260101-000000-0003'));
    await settled();
    assert.equal(runtime.calls.length, 0, 'a parked agent suppresses the doorbell');
  });

  it('never wakes for the boot ping', async () => {
    await seedJob('d-20260101-000000-0004', 'queued');
    const runtime = fakeRuntime();
    const bell = makeDoorbell(makeCwd(true), runtime.fetchImpl);
    bell.register('http://127.0.0.1:4096');

    bell.observe(submitEnvelope('d-20260101-000000-0004', PING_EXTENSION_ID));
    await settled();
    assert.equal(runtime.calls.length, 0);
  });

  it('coalesces a burst under the cooldown into one wake', async () => {
    await seedJob('d-20260101-000000-0005', 'queued');
    await seedJob('d-20260101-000000-0006', 'queued');
    const runtime = fakeRuntime();
    const bell = makeDoorbell(makeCwd(true), runtime.fetchImpl);
    bell.register('http://127.0.0.1:4096');

    bell.observe(submitEnvelope('d-20260101-000000-0005'));
    bell.observe(submitEnvelope('d-20260101-000000-0006'));
    await settled();
    assert.equal(runtime.calls.length, 2, 'one session + one prompt for the whole burst');
  });

  it('does nothing without a registration, and never throws on garbage', async () => {
    const runtime = fakeRuntime();
    const bell = makeDoorbell(makeCwd(true), runtime.fetchImpl);
    bell.observe(submitEnvelope('d-20260101-000000-0007'));
    bell.observe(null);
    bell.observe({ type: 'node.activity' });
    bell.observe({ type: 'job.submitted' });
    await settled();
    assert.equal(runtime.calls.length, 0);
  });

  it('a dead runtime API is swallowed (fire-and-forget)', async () => {
    await seedJob('d-20260101-000000-0008', 'queued');
    const failing = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const bell = makeDoorbell(makeCwd(true), failing);
    bell.register('http://127.0.0.1:4096');
    bell.observe(submitEnvelope('d-20260101-000000-0008'));
    await settled();
    // Reaching here without an unhandled rejection IS the assertion.
  });
});
