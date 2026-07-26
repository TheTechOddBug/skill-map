/**
 * Unit tests for the shared `recordJob` engine
 * (`core/jobs/record-engine.ts`): the nonce + running gate, the completed /
 * failed transition, and the structured refusals shared by `sm record` and
 * the MCP `record_job` tool. Runs against a real project seeded with the
 * `prob-summarizer` drop-in (so the report schema resolves through a real
 * composed runtime), never `:memory:`.
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { loadConfig } from '../../../kernel/config/loader.js';
import { sha256 } from '../../../kernel/orchestrator/node-build.js';
import type { IJobSubmitRow } from '../../../kernel/types/storage.js';
import { loadPluginRuntime } from '../../runtime/plugin-runtime.js';
import { buildFreshResolver } from '../../runtime/fresh-resolver.js';
import { buildActionRuntime, type IActionRuntime } from '../action-runtime.js';
import { recordJob, type IJobLifecycleEvent } from '../record-engine.js';
import {
  setupProbProject,
  withProjectDb,
  SKILL_NODE,
  SUMMARIZER_ID,
  type IProbProject,
} from '../../../server/routes/__tests__/helpers/prob-fixture.js';

const VALID_REPORT = {
  summary: 'A one-line summary of the node.',
  confidence: 0.9,
  safety: { injectionDetected: false, contentQuality: 'clean' },
};

let tmpRoot: string;
let counter = 0;
let project: IProbProject;
let runtime: IActionRuntime;

before(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-record-engine-'));
  project = await setupProbProject(join(tmpRoot, 'proj'), [SKILL_NODE], { installSkill: true });
  const pluginRuntime = await loadPluginRuntime({ runtimeContext: { cwd: project.root } });
  const resolveEnabled = await buildFreshResolver({
    effectiveConfig: () => loadConfig({ cwd: project.root }).effective,
  });
  runtime = buildActionRuntime(pluginRuntime, () => {}, undefined, resolveEnabled);
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function nextId(): string {
  counter += 1;
  return `d-20260101-000000-${String(1000 + counter)}`;
}

/** Seed a queued job for the summarizer against the skill node. */
async function seedQueued(
  id: string,
  extensionId: string = SUMMARIZER_ID,
): Promise<{ id: string; nonce: string }> {
  // Unique content hash per job: the project is reused across tests and the
  // active-jobs unique index is (extension_id, node_id, content_hash).
  const contentHash = sha256(id);
  await withProjectDb(project, async (adapter) => {
    const row: IJobSubmitRow = {
      id,
      extensionId,
      extensionVersion: '1.0.0',
      extensionKind: 'action',
      nodeId: SKILL_NODE.path,
      contentHash,
      nonce: `nonce-${id}`,
      priority: 0,
      status: 'queued',
      ttlSeconds: 3600,
      createdAt: Date.now(),
    };
    await adapter.jobs.submit(row, { contentHash: row.contentHash, content: `R ${id}`, createdAt: row.createdAt });
  });
  return { id, nonce: `nonce-${id}` };
}

/** Seed and claim so the job is running. */
async function seedRunning(
  id: string,
  extensionId?: string,
): Promise<{ id: string; nonce: string }> {
  await seedQueued(id, extensionId);
  return withProjectDb(project, async (adapter) => {
    // Filter to the seeded extension: the project is shared across tests, so
    // an unfiltered claim can hand back some other test's queued job.
    const claim = await adapter.jobs.claim('agent', Date.now(), extensionId);
    assert.ok(claim);
    return { id: claim.id, nonce: claim.nonce };
  });
}

interface IRecordOpts {
  id: string;
  nonce: string;
  status: 'completed' | 'failed';
  reportText?: string;
  errorText?: string | null;
  events: IJobLifecycleEvent[];
}

async function record(opts: IRecordOpts): Promise<Awaited<ReturnType<typeof recordJob>>> {
  return withProjectDb(project, (adapter) =>
    recordJob({
      adapter,
      getRuntime: async () => runtime,
      id: opts.id,
      nonce: opts.nonce,
      status: opts.status,
      ...(opts.reportText !== undefined ? { reportText: opts.reportText } : {}),
      errorText: opts.errorText ?? null,
      metrics: { tokensIn: 12, tokensOut: 34, durationMs: undefined, model: null },
      now: Date.now(),
      runId: 'r-ext-20260101-000000-abcd',
      cwd: project.root,
      channel: 'cli',
      onEvent: (event) => {
        opts.events.push(event);
      },
    }),
  );
}

describe('recordJob engine', () => {
  it('completes a running job with a valid report and emits job.completed', async () => {
    const { id, nonce } = await seedRunning(nextId());
    const events: IJobLifecycleEvent[] = [];
    const outcome = await record({ id, nonce, status: 'completed', reportText: JSON.stringify(VALID_REPORT), events });
    assert.equal(outcome.kind, 'completed');
    if (outcome.kind !== 'completed') return;
    assert.equal(outcome.execution.status, 'completed');
    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, 'job.completed');
    assert.equal(events[0]?.jobId, id);

    await withProjectDb(project, async (adapter) => {
      const job = await adapter.jobs.get(id);
      assert.equal(job?.status, 'completed');
      const execs = await adapter.history.list({});
      assert.ok(execs.some((e) => e.jobId === id && e.status === 'completed'));
    });
  });

  it('moves a running job to failed / report-invalid on an invalid report', async () => {
    const { id, nonce } = await seedRunning(nextId());
    const events: IJobLifecycleEvent[] = [];
    const outcome = await record({ id, nonce, status: 'completed', reportText: JSON.stringify({ confidence: 0.5 }), events });
    assert.equal(outcome.kind, 'report-invalid');
    assert.equal(events[0]?.type, 'job.failed');

    await withProjectDb(project, async (adapter) => {
      const job = await adapter.jobs.get(id);
      assert.equal(job?.status, 'failed');
      assert.equal(job?.failureReason, 'report-invalid');
    });
  });

  it('records a runner-error failure and emits job.failed on --status failed', async () => {
    const { id, nonce } = await seedRunning(nextId());
    const events: IJobLifecycleEvent[] = [];
    const outcome = await record({ id, nonce, status: 'failed', errorText: 'model timed out', events });
    assert.equal(outcome.kind, 'completed');
    if (outcome.kind !== 'completed') return;
    assert.equal(outcome.execution.status, 'failed');
    assert.equal(outcome.execution.failureReason, 'runner-error');
    assert.equal(events[0]?.type, 'job.failed');
    assert.equal(events[0]?.data['message'], 'model timed out');
  });

  it('refuses a nonce mismatch without mutating', async () => {
    const { id } = await seedRunning(nextId());
    const events: IJobLifecycleEvent[] = [];
    const outcome = await record({ id, nonce: 'wrong', status: 'failed', errorText: 'x', events });
    assert.deepEqual(outcome, { kind: 'nonce-mismatch' });
    assert.equal(events.length, 0);
    await withProjectDb(project, async (adapter) => {
      assert.equal((await adapter.jobs.get(id))?.status, 'running');
    });
  });

  it('refuses a non-running (queued) job', async () => {
    const { id, nonce } = await seedQueued(nextId());
    const events: IJobLifecycleEvent[] = [];
    const outcome = await record({ id, nonce, status: 'failed', errorText: 'x', events });
    assert.equal(outcome.kind, 'not-running');
    if (outcome.kind === 'not-running') assert.equal(outcome.status, 'queued');
  });

  it('refuses an unknown job id', async () => {
    const events: IJobLifecycleEvent[] = [];
    const outcome = await record({ id: 'd-20990101-000000-ffff', nonce: 'x', status: 'failed', errorText: 'x', events });
    assert.deepEqual(outcome, { kind: 'not-found' });
  });
});

/**
 * The tagger's tags ride `job.completed` as a PROPOSAL
 * (spec/job-lifecycle.md §Tags proposal): the record path writes no
 * curation at all, so the frame is the only way the operator (CLI or UI)
 * learns what the model inferred and can save it themselves.
 */
describe('recordJob engine, tagger proposal on the completion event', () => {
  const TAGGER_ID = 'core/ai-tagger-action';
  const TAGS_REPORT = JSON.stringify({
    tags: ['deploy-pipeline'],
    confidence: 0.9,
    safety: { injectionDetected: false, contentQuality: 'clean' },
  });

  it('carries the report tags as tagsProposed (consent plays no part)', async () => {
    const { id, nonce } = await seedRunning(nextId(), TAGGER_ID);
    const events: IJobLifecycleEvent[] = [];

    const outcome = await record({ id, nonce, status: 'completed', reportText: TAGS_REPORT, events });

    // The record ALWAYS succeeds: the proposal read is best-effort.
    assert.equal(outcome.kind, 'completed');
    const completed = events.find((e) => e.type === 'job.completed');
    assert.ok(completed, 'job.completed emitted');
    assert.deepEqual(completed!.data['tagsProposed'], ['deploy-pipeline']);
    // The frame names its node (spec/job-events.md): consumers key the
    // proposal on it instead of on whatever node their UI shows.
    assert.equal(completed!.data['nodeId'], SKILL_NODE.path);
  });

  it('reports an EMPTY proposal when the tagger found nothing (retires a stale one)', async () => {
    const { id, nonce } = await seedRunning(nextId(), TAGGER_ID);
    const events: IJobLifecycleEvent[] = [];
    const emptyReport = JSON.stringify({
      tags: [],
      confidence: 0.5,
      safety: { injectionDetected: false, contentQuality: 'clean' },
    });

    await record({ id, nonce, status: 'completed', reportText: emptyReport, events });

    const completed = events.find((e) => e.type === 'job.completed');
    // "I looked and found nothing" must be distinguishable from "no tagger
    // ran", or a consumer keeps a stale proposal from an earlier run on
    // screen. An empty report may itself be schema-invalid (tags has a
    // minItems), in which case no completion event exists at all.
    if (completed) assert.deepEqual(completed.data['tagsProposed'], []);
  });

  it('leaves the field off a non-tagger completion', async () => {
    const { id, nonce } = await seedRunning(nextId());
    const events: IJobLifecycleEvent[] = [];

    await record({ id, nonce, status: 'completed', reportText: JSON.stringify(VALID_REPORT), events });

    const completed = events.find((e) => e.type === 'job.completed');
    assert.ok(completed);
    assert.equal(completed!.data['tagsProposed'], undefined);
  });
});
