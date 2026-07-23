/**
 * `POST /api/jobs/:jobId/cancel` integration tests (Step 16, launcher
 * stop; `spec/cli-contract.md` §Serve route table).
 *
 * Boots a real `createServer()` against a primed project and exercises
 * the contract row:
 *
 *   - a seeded QUEUED job -> 204 No Content, one canonical
 *     `job.cancelled` WS frame (`spec/job-events.md` §`job.cancelled`:
 *     unix-ms timestamp, runId mode `queue`, envelope `jobId`, empty
 *     `data`), the row terminal; a re-cancel -> 409 `job-terminal`.
 *   - a RUNNING job is cancellable too (the zombie-claim case the route
 *     exists for): 204 + terminal row.
 *   - unknown id (and a blank encoded-whitespace id) -> 404 `not-found`.
 *   - missing DB -> 404 `not-found`.
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

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

interface IErrorBody {
  ok: boolean;
  error: { code: string; message: string; details: unknown };
}

const QUEUED_JOB_ID = 'd-20260717-000000-cafe';

let tmpRoot: string;
let counter = 0;
let project: IProbProject;

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-job-cancel-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

// A fresh project per test: cancels mutate the queue, so state must
// never leak across cases (same discipline as the node-jobs suite).
beforeEach(async () => {
  counter += 1;
  const root = join(tmpRoot, `proj-${counter}`);
  project = await setupProbProject(root, [SKILL_NODE], { installSkill: false });
  await seedQueuedJob(project, QUEUED_JOB_ID);
});

/** Insert one QUEUED job row (+ its content row) for the fixture pair. */
async function seedQueuedJob(target: IProbProject, id: string): Promise<void> {
  await withProjectDb(target, async (adapter) => {
    await adapter.jobs.submit(
      {
        id,
        extensionId: SUMMARIZER_ID,
        extensionVersion: '1.0.0',
        extensionKind: 'action',
        nodeId: SKILL_NODE.path,
        contentHash: 'c'.repeat(64),
        nonce: 'n'.repeat(32),
        priority: 0,
        status: 'queued',
        ttlSeconds: null,
        createdAt: Date.now(),
      },
      { contentHash: 'c'.repeat(64), content: 'rendered', createdAt: Date.now() },
    );
  });
}

async function postCancel(
  handle: Parameters<typeof serverUrl>[0],
  jobId: string,
): Promise<Response> {
  return fetch(serverUrl(handle, `/api/jobs/${jobId}/cancel`), { method: 'POST' });
}

describe('POST /api/jobs/:jobId/cancel', () => {
  it('204: queued job -> terminal row + canonical job.cancelled WS frame; re-cancel -> 409 job-terminal', async () => {
    await bootAndUse(project, async (handle) => {
      const client = makeFakeWsClient();
      handle.broadcaster.register(client);

      const res = await postCancel(handle, QUEUED_JOB_ID);
      assert.equal(res.status, 204);
      assert.equal(await res.text(), '', 'No Content by contract');

      // One WS fan-out, the canonical catalog envelope
      // (`spec/job-events.md` §`job.cancelled`): unix-ms timestamp,
      // runId in mode `queue`, the job's id on the envelope slot, and
      // EMPTY data (the envelope's jobId identifies the job). The SAME
      // shape `sm jobs cancel` delivers via POST /api/job-events.
      assert.equal(client.sent.length, 1);
      const event = JSON.parse(client.sent[0]!) as Record<string, unknown>;
      assert.equal(event['type'], 'job.cancelled');
      assert.ok(Number.isInteger(event['timestamp']), 'unix-ms integer timestamp');
      assert.match(String(event['runId']), /^r-queue-\d{8}-\d{6}-[0-9a-f]{4}$/);
      assert.equal(event['jobId'], QUEUED_JOB_ID);
      assert.deepEqual(event['data'], {});

      // Re-cancel: the row is terminal now, the stop has nothing left
      // to do -> 409 `job-terminal`, and NO second broadcast.
      const again = await postCancel(handle, QUEUED_JOB_ID);
      assert.equal(again.status, 409);
      const body = (await again.json()) as IErrorBody;
      assert.equal(body.error.code, 'job-terminal');
      assert.match(body.error.message, /already terminal/);
      assert.equal(client.sent.length, 1, 'a refused cancel broadcasts nothing');
    });
    await withProjectDb(project, async (adapter) => {
      const job = await adapter.jobs.get(QUEUED_JOB_ID);
      assert.equal(job?.status, 'cancelled');
      assert.ok(Number.isInteger(job?.finishedAt), 'terminal row carries finishedAt');
    });
  });

  it('204: a RUNNING job is cancellable (the zombie-claim case)', async () => {
    // Claim the seeded job (the external agent) so it holds a live
    // claim; a killed agent leaves exactly this row behind.
    await withProjectDb(project, async (adapter) => {
      const claim = await adapter.jobs.claim('agent', Date.now());
      assert.equal(claim?.id, QUEUED_JOB_ID);
    });
    await bootAndUse(project, async (handle) => {
      const client = makeFakeWsClient();
      handle.broadcaster.register(client);

      const res = await postCancel(handle, QUEUED_JOB_ID);
      assert.equal(res.status, 204);
      assert.equal(client.sent.length, 1);
      const event = JSON.parse(client.sent[0]!) as Record<string, unknown>;
      assert.equal(event['type'], 'job.cancelled');
      assert.equal(event['jobId'], QUEUED_JOB_ID);
    });
    await withProjectDb(project, async (adapter) => {
      assert.equal((await adapter.jobs.get(QUEUED_JOB_ID))?.status, 'cancelled');
    });
  });

  it('404: unknown id and blank encoded-whitespace id', async () => {
    await bootAndUse(project, async (handle) => {
      const unknown = await postCancel(handle, 'd-20990101-000000-dead');
      assert.equal(unknown.status, 404);
      const body = (await unknown.json()) as IErrorBody;
      assert.equal(body.error.code, 'not-found');
      assert.match(body.error.message, /not found/);

      // `%20` matches the `:jobId` segment as a blank string; the
      // defensive shape gate refuses it without touching the DB.
      const blank = await fetch(serverUrl(handle, '/api/jobs/%20/cancel'), { method: 'POST' });
      assert.equal(blank.status, 404);
      assert.equal(((await blank.json()) as IErrorBody).error.code, 'not-found');
    });
    await withProjectDb(project, async (adapter) => {
      assert.equal(
        (await adapter.jobs.get(QUEUED_JOB_ID))?.status,
        'queued',
        'misses leave the queue untouched',
      );
    });
  });

  it('404: missing DB', async () => {
    const bare = mkdtempSync(join(tmpRoot, 'nodb-'));
    const bareProject = { root: bare, dbPath: join(bare, '.skill-map', 'skill-map.db') };
    await bootAndUse(bareProject, async (handle) => {
      const res = await postCancel(handle, QUEUED_JOB_ID);
      assert.equal(res.status, 404);
      assert.equal(((await res.json()) as IErrorBody).error.code, 'not-found');
    });
  });
});
