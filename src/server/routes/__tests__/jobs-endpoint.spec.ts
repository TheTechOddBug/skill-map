/**
 * `GET /api/jobs` integration tests (the cross-corpus job list, read side
 * of the UI queue inspector; `spec/cli-contract.md` §Serve route table).
 *
 * Boots a real `createServer()` against a primed project, seeds jobs across
 * every lifecycle status / two extensions / two nodes, and exercises the
 * contract:
 *
 *   - the full list comes back newest-first (`createdAt DESC`);
 *   - the `status` / `extension` / `node` filters narrow correctly (and
 *     `extension` matches by bare-id suffix, like the CLI verb);
 *   - the `nonce` record credential is ABSENT from every row
 *     (`spec/job-lifecycle.md` §Nonce exposure), enforced both by an
 *     explicit `in` check and by the envelope schema's
 *     `additionalProperties: false`;
 *   - an unknown `status` value → 400 `bad-query`, an empty `status=` is
 *     treated as absent;
 *   - a missing DB degrades to an empty list (200), not an error.
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import {
  bootAndUse,
  compileEnvelopeValidator,
  FINDER_ID,
  serverUrl,
  setupProbProject,
  SKILL_NODE,
  SUMMARIZER_ID,
  withProjectDb,
  type INodeSeed,
  type IProbProject,
} from './helpers/prob-fixture.js';

interface IErrorBody {
  ok: boolean;
  error: { code: string; message: string; details: unknown };
}

interface IJobsEnvelope {
  schemaVersion: string;
  kind: string;
  items: Array<Record<string, unknown>>;
  filters: Record<string, unknown>;
  counts: { total: number; returned: number };
}

// A second (virtual) node so `node=` has two buckets to discriminate. Jobs
// carry `nodeId` as a free string (a job outlives the node leaving the
// scan), so the path need not resolve to a live file.
const NODE_B: INodeSeed = { path: 'docs/readme.md', kind: 'doc', provider: 'markdown', virtual: true };

/** Deterministic 64-hex content hash, distinct per job (the active-job unique index is keyed on it). */
function contentHash(n: number): string {
  return n.toString(16).padStart(64, '0');
}

interface IJobSeed {
  id: string;
  extensionId: string;
  extensionKind: 'action' | 'analyzer';
  nodeId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: number;
}

const BASE_MS = 1_700_000_000_000;

// Five jobs, strictly increasing createdAt so newest-first is unambiguous.
// Extensions: SUMMARIZER_ID (prob-summarizer/skill-echo, action) and
// FINDER_ID (prob-finder/quality-check, analyzer). Nodes: SKILL (A) / B.
const SEEDS: readonly IJobSeed[] = [
  { id: 'd-20260101-000001-0001', extensionId: SUMMARIZER_ID, extensionKind: 'action', nodeId: SKILL_NODE.path, status: 'queued', createdAt: BASE_MS + 1000 },
  { id: 'd-20260101-000002-0002', extensionId: FINDER_ID, extensionKind: 'analyzer', nodeId: SKILL_NODE.path, status: 'running', createdAt: BASE_MS + 2000 },
  { id: 'd-20260101-000003-0003', extensionId: SUMMARIZER_ID, extensionKind: 'action', nodeId: NODE_B.path, status: 'completed', createdAt: BASE_MS + 3000 },
  { id: 'd-20260101-000004-0004', extensionId: FINDER_ID, extensionKind: 'analyzer', nodeId: NODE_B.path, status: 'failed', createdAt: BASE_MS + 4000 },
  { id: 'd-20260101-000005-0005', extensionId: SUMMARIZER_ID, extensionKind: 'action', nodeId: SKILL_NODE.path, status: 'cancelled', createdAt: BASE_MS + 5000 },
];

let tmpRoot: string;
let counter = 0;
let project: IProbProject;

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-jobs-list-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  counter += 1;
  const root = join(tmpRoot, `proj-${counter}`);
  project = await setupProbProject(root, [SKILL_NODE, NODE_B], { installSkill: false });
  await withProjectDb(project, async (adapter) => {
    let i = 0;
    for (const seed of SEEDS) {
      i += 1;
      const hash = contentHash(i);
      await adapter.jobs.submit(
        {
          id: seed.id,
          extensionId: seed.extensionId,
          extensionVersion: '1.0.0',
          extensionKind: seed.extensionKind,
          nodeId: seed.nodeId,
          contentHash: hash,
          nonce: 'n'.repeat(32),
          priority: 0,
          status: seed.status,
          ttlSeconds: null,
          createdAt: seed.createdAt,
        },
        { contentHash: hash, content: 'rendered', createdAt: seed.createdAt },
      );
    }
  });
});

async function getJobs(
  handle: Parameters<typeof serverUrl>[0],
  qs = '',
): Promise<{ status: number; env: IJobsEnvelope }> {
  const res = await fetch(serverUrl(handle, `/api/jobs${qs}`));
  return { status: res.status, env: (await res.json()) as IJobsEnvelope };
}

/** Ids in the response order (newest-first by contract). */
function ids(env: IJobsEnvelope): string[] {
  return env.items.map((row) => row['id'] as string);
}

describe('GET /api/jobs', () => {
  it('200: full list, newest-first, nonce absent, envelope validates', async () => {
    const validate = compileEnvelopeValidator();
    await bootAndUse(project, async (handle) => {
      const { status, env } = await getJobs(handle);
      assert.equal(status, 200);
      assert.equal(env.schemaVersion, '1');
      assert.equal(env.kind, 'jobs');

      // Newest-first: createdAt DESC (job 5 down to job 1).
      assert.deepEqual(ids(env), [
        'd-20260101-000005-0005',
        'd-20260101-000004-0004',
        'd-20260101-000003-0003',
        'd-20260101-000002-0002',
        'd-20260101-000001-0001',
      ]);
      assert.equal(env.counts.total, 5);
      assert.equal(env.counts.returned, 5);
      assert.deepEqual(env.filters, { status: null, extension: null, node: null });

      // The record credential never rides a read surface.
      for (const row of env.items) {
        assert.ok(!('nonce' in row), `nonce must be stripped: ${JSON.stringify(row)}`);
      }
      // A representative row carries the full public projection.
      const first = env.items[0]!;
      assert.equal(first['extensionId'], SUMMARIZER_ID);
      assert.equal(first['status'], 'cancelled');
      assert.equal(first['extensionKind'], 'action');

      // `additionalProperties: false` on the item shape doubles as a
      // second nonce-absence guard.
      assert.equal(
        validate(env),
        true,
        `envelope must validate: ${JSON.stringify(validate.errors)}`,
      );
    });
  });

  // Host-locked SYSTEM extensions (the `core/ai-ping-action` liveness probe)
  // are internal infra: their jobs must NOT surface in the UI queue list,
  // the same way `locked` strips them from the plugin list + MCP tools.
  it('200: hides jobs from host-locked system extensions (ai-ping-action)', async () => {
    const PING_ID = 'core/ai-ping-action';
    const PING_JOB = 'd-20260101-000099-0099';
    await withProjectDb(project, async (adapter) => {
      const hash = contentHash(99);
      await adapter.jobs.submit(
        {
          id: PING_JOB,
          extensionId: PING_ID,
          extensionVersion: '1.0.0',
          extensionKind: 'action',
          nodeId: SKILL_NODE.path,
          contentHash: hash,
          nonce: 'n'.repeat(32),
          priority: 0,
          status: 'queued',
          ttlSeconds: null,
          createdAt: BASE_MS + 9000,
        },
        { contentHash: hash, content: 'ping', createdAt: BASE_MS + 9000 },
      );
    });
    await bootAndUse(project, async (handle) => {
      const { status, env } = await getJobs(handle);
      assert.equal(status, 200);
      const returned = ids(env);
      assert.ok(!returned.includes(PING_JOB), 'the locked ping job must be hidden');
      assert.equal(returned.length, SEEDS.length, 'only the real jobs remain');
    });
  });

  it('200: status filter narrows to one bucket', async () => {
    await bootAndUse(project, async (handle) => {
      const { env } = await getJobs(handle, '?status=queued');
      assert.deepEqual(ids(env), ['d-20260101-000001-0001']);
      assert.equal(env.counts.total, 1);
      assert.deepEqual(env.filters, { status: 'queued', extension: null, node: null });

      const running = await getJobs(handle, '?status=running');
      assert.deepEqual(ids(running.env), ['d-20260101-000002-0002']);
    });
  });

  it('200: extension filter (bare-id suffix and qualified), newest-first', async () => {
    await bootAndUse(project, async (handle) => {
      // Bare suffix of prob-summarizer/skill-echo → jobs 5, 3, 1.
      const bare = await getJobs(handle, '?extension=skill-echo');
      assert.deepEqual(ids(bare.env), [
        'd-20260101-000005-0005',
        'd-20260101-000003-0003',
        'd-20260101-000001-0001',
      ]);

      // Qualified id → the two finder jobs (4, 2).
      const qualified = await getJobs(handle, `?extension=${encodeURIComponent(FINDER_ID)}`);
      assert.deepEqual(ids(qualified.env), ['d-20260101-000004-0004', 'd-20260101-000002-0002']);
    });
  });

  it('200: node filter narrows to the target node', async () => {
    await bootAndUse(project, async (handle) => {
      const a = await getJobs(handle, `?node=${encodeURIComponent(SKILL_NODE.path)}`);
      assert.deepEqual(ids(a.env), [
        'd-20260101-000005-0005',
        'd-20260101-000002-0002',
        'd-20260101-000001-0001',
      ]);

      const b = await getJobs(handle, `?node=${encodeURIComponent(NODE_B.path)}`);
      assert.deepEqual(ids(b.env), ['d-20260101-000004-0004', 'd-20260101-000003-0003']);
    });
  });

  it('200: empty status= is treated as absent (returns every job)', async () => {
    await bootAndUse(project, async (handle) => {
      const { env } = await getJobs(handle, '?status=');
      assert.equal(env.counts.total, 5);
      assert.deepEqual(env.filters, { status: null, extension: null, node: null });
    });
  });

  it('400: unknown status value → bad-query', async () => {
    await bootAndUse(project, async (handle) => {
      const res = await fetch(serverUrl(handle, '/api/jobs?status=bogus'));
      assert.equal(res.status, 400);
      const body = (await res.json()) as IErrorBody;
      assert.equal(body.error.code, 'bad-query');
      assert.match(body.error.message, /unknown status/);
    });
  });

  it('200: missing DB degrades to an empty list', async () => {
    const bare = mkdtempSync(join(tmpRoot, 'nodb-'));
    const bareProject = { root: bare, dbPath: join(bare, '.skill-map', 'skill-map.db') };
    await bootAndUse(bareProject, async (handle) => {
      const { status, env } = await getJobs(handle);
      assert.equal(status, 200);
      assert.equal(env.kind, 'jobs');
      assert.deepEqual(env.items, []);
      assert.equal(env.counts.total, 0);
    });
  });
});
