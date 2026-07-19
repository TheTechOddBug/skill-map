/**
 * Bulk queue mutations integration tests (`spec/cli-contract.md` §Serve
 * route table): `POST /api/jobs/cancel-all`, `/fail-all`, `/prune`.
 *
 * Boots a real `createServer()` against a primed project and exercises each
 * contract row:
 *
 *   - `cancel-all` / `fail-all` move EVERY active (queued / running) job to
 *     the terminal state in one shot, broadcast one canonical envelope per
 *     affected id, leave already-terminal rows untouched, and answer 204.
 *   - `prune` deletes ALL terminal jobs NOW (completed + failed + cancelled,
 *     incl. `failed`, unlike the retention-based CLI verb), leaves active
 *     jobs, emits NO WS frame, and answers 204.
 *   - an empty queue / missing DB is a vacuous 204 no-op.
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import type { JobStatus } from '../../../kernel/types.js';
import {
  bootAndUse,
  makeFakeWsClient,
  serverUrl,
  setupProbProject,
  SKILL_NODE,
  SUMMARIZER_ID,
  withProjectDb,
  type IProbProject,
} from './helpers/prob-fixture.js';

let tmpRoot: string;
let counter = 0;
let project: IProbProject;

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-job-bulk-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

// A fresh, EMPTY project per test; each case seeds exactly the queue it
// needs (bulk mutations must never leak state across cases).
beforeEach(async () => {
  counter += 1;
  const root = join(tmpRoot, `proj-${counter}`);
  project = await setupProbProject(root, [SKILL_NODE], { installSkill: false });
});

/** Distinct 64-hex content hash per job (the active-job unique index is keyed on it). */
function contentHash(n: number): string {
  return n.toString(16).padStart(64, '0');
}

/** Insert one job (+ content row) in the given lifecycle state. */
async function seedJob(target: IProbProject, id: string, status: JobStatus, n: number): Promise<void> {
  const hash = contentHash(n);
  await withProjectDb(target, async (adapter) => {
    await adapter.jobs.submit(
      {
        id,
        extensionId: SUMMARIZER_ID,
        extensionVersion: '1.0.0',
        extensionKind: 'action',
        nodeId: SKILL_NODE.path,
        contentHash: hash,
        nonce: 'n'.repeat(32),
        priority: 0,
        status,
        ttlSeconds: null,
        createdAt: Date.now(),
      },
      { contentHash: hash, content: 'rendered', createdAt: Date.now() },
    );
  });
}

async function post(handle: Parameters<typeof serverUrl>[0], path: string): Promise<Response> {
  return fetch(serverUrl(handle, path), { method: 'POST' });
}

/** Parsed WS frames sent to a fake client. */
function frames(client: ReturnType<typeof makeFakeWsClient>): Array<Record<string, unknown>> {
  return client.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
}

describe('POST /api/jobs/cancel-all', () => {
  it('204: cancels every active job, one job.cancelled per id, terminals untouched', async () => {
    await seedJob(project, 'j-queued', 'queued', 1);
    await seedJob(project, 'j-running', 'running', 2);
    await seedJob(project, 'j-done', 'completed', 3);

    await bootAndUse(project, async (handle) => {
      const client = makeFakeWsClient();
      handle.broadcaster.register(client);

      const res = await post(handle, '/api/jobs/cancel-all');
      assert.equal(res.status, 204);
      assert.equal(await res.text(), '', 'No Content by contract');

      // One `job.cancelled` frame per active id (order not contractual).
      const sent = frames(client);
      assert.equal(sent.length, 2);
      assert.ok(sent.every((e) => e['type'] === 'job.cancelled'));
      assert.deepEqual(
        new Set(sent.map((e) => e['jobId'])),
        new Set(['j-queued', 'j-running']),
      );
    });
    await withProjectDb(project, async (adapter) => {
      assert.equal((await adapter.jobs.get('j-queued'))?.status, 'cancelled');
      assert.equal((await adapter.jobs.get('j-running'))?.status, 'cancelled');
      assert.equal((await adapter.jobs.get('j-done'))?.status, 'completed', 'terminal untouched');
    });
  });

  it('204: empty queue is a vacuous no-op (no broadcast)', async () => {
    await bootAndUse(project, async (handle) => {
      const client = makeFakeWsClient();
      handle.broadcaster.register(client);
      const res = await post(handle, '/api/jobs/cancel-all');
      assert.equal(res.status, 204);
      assert.equal(client.sent.length, 0);
    });
  });
});

describe('POST /api/jobs/prune', () => {
  it('204: deletes ALL terminal jobs (incl. failed), leaves active, emits no WS frame', async () => {
    // Build real terminal rows (with finishedAt) by transitioning queued
    // jobs; a directly-seeded terminal row carries no finishedAt and would
    // not be pruned by the adapter's `finishedAt is not null` filter.
    await seedJob(project, 'j-cancelled', 'queued', 1);
    await seedJob(project, 'j-failed', 'queued', 2);
    await seedJob(project, 'j-active', 'queued', 3);
    await withProjectDb(project, async (adapter) => {
      await adapter.jobs.cancel('j-cancelled', Date.now());
      await adapter.jobs.fail('j-failed', Date.now());
    });

    await bootAndUse(project, async (handle) => {
      const client = makeFakeWsClient();
      handle.broadcaster.register(client);

      const res = await post(handle, '/api/jobs/prune');
      assert.equal(res.status, 204);
      // Silent GC: prune emits no WS event by contract.
      assert.equal(client.sent.length, 0);
    });
    await withProjectDb(project, async (adapter) => {
      assert.equal(await adapter.jobs.get('j-cancelled'), null, 'cancelled pruned');
      assert.equal(await adapter.jobs.get('j-failed'), null, 'failed pruned (unlike CLI retention)');
      assert.equal((await adapter.jobs.get('j-active'))?.status, 'queued', 'active kept');
    });
  });

  it('204: ?status=failed clears only failed, leaves other terminal states', async () => {
    await seedJob(project, 'j-failed', 'queued', 1);
    await seedJob(project, 'j-cancelled', 'queued', 2);
    await withProjectDb(project, async (adapter) => {
      await adapter.jobs.fail('j-failed', Date.now());
      await adapter.jobs.cancel('j-cancelled', Date.now());
    });

    await bootAndUse(project, async (handle) => {
      const res = await post(handle, '/api/jobs/prune?status=failed');
      assert.equal(res.status, 204);
    });
    await withProjectDb(project, async (adapter) => {
      assert.equal(await adapter.jobs.get('j-failed'), null, 'failed pruned');
      assert.equal(
        (await adapter.jobs.get('j-cancelled'))?.status,
        'cancelled',
        'other terminal states kept',
      );
    });
  });

  it('400: a non-terminal / unknown status is rejected', async () => {
    await bootAndUse(project, async (handle) => {
      // `running` is a valid lifecycle state but not a terminal one.
      const active = await post(handle, '/api/jobs/prune?status=running');
      assert.equal(active.status, 400);
      const unknown = await post(handle, '/api/jobs/prune?status=bogus');
      assert.equal(unknown.status, 400);
    });
  });

  it('204: missing DB is a vacuous no-op', async () => {
    const bare = mkdtempSync(join(tmpRoot, 'nodb-'));
    const bareProject = { root: bare, dbPath: join(bare, '.skill-map', 'skill-map.db') };
    await bootAndUse(bareProject, async (handle) => {
      const res = await post(handle, '/api/jobs/prune');
      assert.equal(res.status, 204);
    });
  });
});
