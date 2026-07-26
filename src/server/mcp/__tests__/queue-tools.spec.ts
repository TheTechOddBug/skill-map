/**
 * Unit tests for the write-gated MCP queue tool executors
 * (`server/mcp/queue-tools.ts`), exercised directly over a primed project
 * (no MCP transport). The project carries the `prob-*` drop-in plugins (via
 * the shared `prob-fixture` helper) so submit / record resolve real prompt
 * + report schemas; jobs are seeded through the storage port. Never
 * `:memory:` (the adapter opens two DatabaseSync instances).
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

// eslint-disable-next-line import-x/extensions
import { McpError } from '@modelcontextprotocol/sdk/types.js';

import { emptyPluginRuntime, loadPluginRuntime, type IPluginRuntime } from '../../../core/runtime/plugin-runtime.js';
import type { IJobSubmitRow } from '../../../kernel/types/storage.js';
import { WsBroadcaster } from '../../broadcaster.js';
import type { IMcpWriteContext } from '../context.js';
import {
  cancelJob,
  claimJobTool,
  claimWaitProgressFrom,
  claimWithOptionalWait,
  failJob,
  getJob,
  listExtensions,
  listJobs,
  recordJobTool,
  submitJob,
} from '../queue-tools.js';
import {
  bodyFor,
  FINDER_ID,
  FIXER_ID,
  setupProbProject,
  SKILL_NODE,
  SUMMARIZER_ID,
  withProjectDb,
  type IProbProject,
} from '../../routes/__tests__/helpers/prob-fixture.js';

const VALID_REPORT = {
  summary: 'A one-line summary of the node.',
  confidence: 0.9,
  safety: { injectionDetected: false, contentQuality: 'clean' },
};

let tmpRoot: string;
let counter = 0;

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-mcp-queue-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

async function makeProject(installSkill: boolean): Promise<IProbProject> {
  counter += 1;
  return setupProbProject(join(tmpRoot, `p-${counter}`), [SKILL_NODE], { installSkill });
}

function ctxFor(project: IProbProject, pluginRuntime: IPluginRuntime): IMcpWriteContext {
  return { dbPath: project.dbPath, cwd: project.root, pluginRuntime, broadcaster: new WsBroadcaster() };
}

/** ctx with a real composed runtime (submit / record need it). */
async function realCtx(project: IProbProject): Promise<IMcpWriteContext> {
  const pluginRuntime = await loadPluginRuntime({ runtimeContext: { cwd: project.root } });
  return ctxFor(project, pluginRuntime);
}

/** ctx with no plugins (claim / cancel / fail / list / get do not resolve extensions). */
function bareCtx(project: IProbProject): IMcpWriteContext {
  return ctxFor(project, emptyPluginRuntime());
}

async function seedQueued(project: IProbProject, id: string): Promise<{ id: string; nonce: string }> {
  await withProjectDb(project, async (adapter) => {
    const row: IJobSubmitRow = {
      id,
      extensionId: SUMMARIZER_ID,
      extensionVersion: '1.0.0',
      extensionKind: 'action',
      nodeId: SKILL_NODE.path,
      contentHash: 'h'.repeat(64),
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

describe('mcp list_extensions', () => {
  it('lists the enabled probabilistic extensions with id / kind / role', async () => {
    const project = await makeProject(true);
    const { extensions } = await listExtensions(await realCtx(project));
    const byId = new Map(extensions.map((e) => [e.id, e]));
    // The fixture ships a finder (analyzer), a fixer (action w/ analyzerIds),
    // and a standalone summarizer (action, no analyzerIds).
    assert.equal(byId.get(FINDER_ID)?.role, 'finder');
    assert.equal(byId.get(FINDER_ID)?.kind, 'analyzer');
    const fixer = byId.get(FIXER_ID);
    assert.equal(fixer?.role, 'fixer');
    assert.ok((fixer?.analyzerIds ?? []).length > 0, 'a fixer carries analyzerIds');
    assert.equal(byId.get(SUMMARIZER_ID)?.role, 'standalone');
    // Every entry carries a non-empty description (the discovery payload).
    for (const e of extensions) assert.ok(e.description.length > 0);
  });

  it('sorts by id', async () => {
    const project = await makeProject(true);
    const { extensions } = await listExtensions(await realCtx(project));
    const ids = extensions.map((e) => e.id);
    assert.deepEqual(ids, [...ids].sort((a, b) => a.localeCompare(b)));
  });
});

describe('mcp submit_job', () => {
  it('creates a job for a probabilistic action', async () => {
    const project = await makeProject(true);
    const ctx = await realCtx(project);
    const result = await submitJob(ctx, { node: SKILL_NODE.path, extension: SUMMARIZER_ID });
    assert.equal(result.outcome, 'created');
    if (result.outcome !== 'created') return;
    assert.equal(result.nodePath, SKILL_NODE.path);
    assert.deepEqual(result.supersededIds, []);
  });

  it('refuses a duplicate submit', async () => {
    const project = await makeProject(true);
    const ctx = await realCtx(project);
    await submitJob(ctx, { node: SKILL_NODE.path, extension: SUMMARIZER_ID });
    const dup = await submitJob(ctx, { node: SKILL_NODE.path, extension: SUMMARIZER_ID });
    assert.equal(dup.outcome, 'duplicate');
  });

  it('refuses a drifted node (on-disk body no longer matches the scan)', async () => {
    const project = await makeProject(true);
    // Edit the file so its bytes no longer hash to the scanned bodyHash.
    writeFileSync(join(project.root, SKILL_NODE.path), `---\ntitle: t\n---\n${bodyFor(SKILL_NODE.path)}EDITED\n`);
    const ctx = await realCtx(project);
    const result = await submitJob(ctx, { node: SKILL_NODE.path, extension: SUMMARIZER_ID });
    assert.equal(result.outcome, 'drift');
  });

  it('refuses a fixer over a node with no findings (no-findings)', async () => {
    const project = await makeProject(true);
    const ctx = await realCtx(project);
    const result = await submitJob(ctx, { node: SKILL_NODE.path, extension: FIXER_ID });
    assert.equal(result.outcome, 'no-findings');
  });

  it('refuses when no processing skill is installed (McpError)', async () => {
    const project = await makeProject(false);
    const ctx = await realCtx(project);
    await assert.rejects(
      () => submitJob(ctx, { node: SKILL_NODE.path, extension: SUMMARIZER_ID }),
      (err: unknown) => err instanceof McpError,
    );
  });
});

describe('mcp claim_job', () => {
  it('returns null on an empty queue', async () => {
    const project = await makeProject(true);
    const result = await claimJobTool(bareCtx(project), {});
    assert.equal(result, null);
  });

  it('round-trips a submitted job (nonce + rendered content)', async () => {
    const project = await makeProject(true);
    const ctx = await realCtx(project);
    const submitted = await submitJob(ctx, { node: SKILL_NODE.path, extension: SUMMARIZER_ID });
    assert.equal(submitted.outcome, 'created');
    const claim = await claimJobTool(ctx, {});
    assert.ok(claim);
    if (!claim) return;
    assert.equal(typeof claim.nonce, 'string');
    assert.ok(claim.content.length > 0, 'rendered prompt returned');
    if (submitted.outcome === 'created') assert.equal(claim.id, submitted.jobId);
  });

  it('wait set + a job already present returns it immediately (no sleeping)', async () => {
    const project = await makeProject(true);
    const ctx = await realCtx(project);
    const submitted = await submitJob(ctx, { node: SKILL_NODE.path, extension: SUMMARIZER_ID });
    assert.equal(submitted.outcome, 'created');
    const started = Date.now();
    const claim = await claimJobTool(ctx, { wait: 5 });
    assert.ok(claim, 'a present job is claimed on the first attempt');
    // The immediate hit must not park for a poll interval (2000ms).
    assert.ok(Date.now() - started < 1000, 'returned without sleeping');
  });

  it('wait set + empty queue the whole time returns empty after the window (polls > once)', async () => {
    const project = await makeProject(true);
    const started = Date.now();
    // Tiny injected interval keeps the test fast while still polling many times.
    const outcome = await claimWithOptionalWait(bareCtx(project), 'agent', undefined, 1, {
      pollIntervalMs: 10,
    });
    assert.equal(outcome.kind, 'empty');
    assert.ok(Date.now() - started >= 1000, 'held for roughly the full window');
  });

  it('wait set + a job appearing after the first attempt is claimed by the blocking loop', async () => {
    const project = await makeProject(true);
    const ctx = await realCtx(project);
    // No job present at call time; insert one shortly after the poll starts.
    setTimeout(() => {
      void seedQueued(project, 'd-20260101-000000-9601');
    }, 30);
    const outcome = await claimWithOptionalWait(ctx, 'agent', undefined, 5, {
      pollIntervalMs: 10,
    });
    assert.equal(outcome.kind, 'claimed');
    if (outcome.kind === 'claimed') assert.equal(outcome.id, 'd-20260101-000000-9601');
  });

  it('parked wait fires the progress heartbeat on cadence with elapsed seconds', async () => {
    const project = await makeProject(true);
    const ticks: number[] = [];
    // 1s window, 10ms polls, 100ms heartbeat cadence: expect ~9 ticks.
    const outcome = await claimWithOptionalWait(bareCtx(project), 'agent', undefined, 1, {
      pollIntervalMs: 10,
      progressIntervalMs: 100,
      onProgress: async (elapsed) => {
        ticks.push(elapsed);
      },
    });
    assert.equal(outcome.kind, 'empty');
    assert.ok(ticks.length >= 5, `heartbeat fired repeatedly (got ${ticks.length})`);
    // Elapsed values are non-decreasing whole seconds.
    for (let i = 1; i < ticks.length; i++) {
      assert.ok(ticks[i]! >= ticks[i - 1]!, 'elapsed seconds never regress');
    }
  });

  it('no heartbeat without an onProgress emitter (token-less request shape)', async () => {
    const project = await makeProject(true);
    // Same window with no emitter: just proves the loop tolerates absence
    // (the registration only builds an emitter when the request carried a
    // progressToken, per MCP progress semantics).
    const outcome = await claimWithOptionalWait(bareCtx(project), 'agent', undefined, 1, {
      pollIntervalMs: 10,
      progressIntervalMs: 100,
    });
    assert.equal(outcome.kind, 'empty');
  });

  it('an immediate claim never fires the heartbeat (response is the signal)', async () => {
    const project = await makeProject(true);
    const ctx = await realCtx(project);
    const submitted = await submitJob(ctx, { node: SKILL_NODE.path, extension: SUMMARIZER_ID });
    assert.equal(submitted.outcome, 'created');
    const ticks: number[] = [];
    const outcome = await claimWithOptionalWait(ctx, 'agent', undefined, 5, {
      pollIntervalMs: 10,
      progressIntervalMs: 20,
      onProgress: async (elapsed) => {
        ticks.push(elapsed);
      },
    });
    assert.equal(outcome.kind, 'claimed');
    assert.deepEqual(ticks, [], 'first-attempt hit parks nothing');
  });

  it('every claim attempt fires onClaimAttempt (presence), empty queue included', async () => {
    const project = await makeProject(true);
    let attempts = 0;
    const ctx = { ...bareCtx(project), onClaimAttempt: () => { attempts += 1; } };
    // Empty queue: no claim, still an attending agent.
    const empty = await claimJobTool(ctx, {});
    assert.equal(empty, null);
    assert.equal(attempts, 1);
    // A real claim counts too (once per tool call, not per poll tick).
    await seedQueued(project, 'd-20260101-000000-9700');
    const claimed = await claimJobTool(ctx, {});
    assert.ok(claimed);
    assert.equal(attempts, 2);
  });

  it('claimWaitProgressFrom binds the progressToken and swallows transport errors', async () => {
    const sent: unknown[] = [];
    const withToken = {
      _meta: { progressToken: 'tok-1' },
      sendNotification: async (n: unknown) => {
        sent.push(n);
      },
    } as unknown as Parameters<typeof claimWaitProgressFrom>[0];
    const emitter = claimWaitProgressFrom(withToken);
    assert.ok(emitter, 'a token yields an emitter');
    await emitter(30);
    assert.deepEqual(sent, [
      {
        method: 'notifications/progress',
        params: { progressToken: 'tok-1', progress: 30 },
      },
    ]);

    // No token -> no emitter (per MCP, progress only goes to who asked).
    const withoutToken = {
      _meta: {},
      sendNotification: async () => {},
    } as unknown as Parameters<typeof claimWaitProgressFrom>[0];
    assert.equal(claimWaitProgressFrom(withoutToken), undefined);

    // A dying transport mid-park must not throw out of a heartbeat tick.
    const failing = {
      _meta: { progressToken: 7 },
      sendNotification: async () => {
        throw new Error('session gone');
      },
    } as unknown as Parameters<typeof claimWaitProgressFrom>[0];
    await assert.doesNotReject(() => claimWaitProgressFrom(failing)!(5));
  });

  it('fails and skips a claimed job with a missing content row (McpError)', async () => {
    const project = await makeProject(true);
    const { contentHash } = { contentHash: 'h'.repeat(64) };
    await seedQueued(project, 'd-20260101-000000-9001');
    await withProjectDb(project, (adapter) =>
      adapter.db.deleteFrom('state_job_contents').where('contentHash', '=', contentHash).execute(),
    );
    await assert.rejects(() => claimJobTool(bareCtx(project), {}), (err: unknown) => err instanceof McpError);
    await withProjectDb(project, async (adapter) => {
      const job = await adapter.jobs.get('d-20260101-000000-9001');
      assert.equal(job?.status, 'failed');
      assert.equal(job?.failureReason, 'job-file-missing');
    });
  });
});

describe('mcp record_job', () => {
  async function submitAndClaim(project: IProbProject, ctx: IMcpWriteContext): Promise<{ id: string; nonce: string }> {
    await submitJob(ctx, { node: SKILL_NODE.path, extension: SUMMARIZER_ID });
    const claim = await claimJobTool(ctx, {});
    assert.ok(claim);
    return { id: claim!.id, nonce: claim!.nonce };
  }

  it('records a completed job with a valid report', async () => {
    const project = await makeProject(true);
    const ctx = await realCtx(project);
    const { id, nonce } = await submitAndClaim(project, ctx);
    const result = await recordJobTool(ctx, { id, nonce, status: 'completed', report: JSON.stringify(VALID_REPORT) });
    assert.equal(result.outcome, 'completed');
    if (result.outcome === 'completed') assert.match(result.executionId, /^e-/);
  });

  it('maps an invalid report to report-invalid', async () => {
    const project = await makeProject(true);
    const ctx = await realCtx(project);
    const { id, nonce } = await submitAndClaim(project, ctx);
    const result = await recordJobTool(ctx, { id, nonce, status: 'completed', report: JSON.stringify({ confidence: 0.5 }) });
    assert.equal(result.outcome, 'report-invalid');
  });

  it('maps a bad nonce to nonce-mismatch', async () => {
    const project = await makeProject(true);
    const ctx = await realCtx(project);
    const { id } = await submitAndClaim(project, ctx);
    const result = await recordJobTool(ctx, { id, nonce: 'wrong', status: 'completed', report: JSON.stringify(VALID_REPORT) });
    assert.deepEqual(result, { outcome: 'nonce-mismatch' });
  });

  it('maps a queued (non-running) job to not-running', async () => {
    const project = await makeProject(true);
    const { id, nonce } = await seedQueued(project, 'd-20260101-000000-9101');
    const result = await recordJobTool(bareCtx(project), { id, nonce, status: 'failed' });
    assert.equal(result.outcome, 'not-running');
    if (result.outcome === 'not-running') assert.equal(result.status, 'queued');
  });
});

describe('mcp cancel_job / fail_job', () => {
  it('cancels a queued job, then refuses the terminal one', async () => {
    const project = await makeProject(true);
    await seedQueued(project, 'd-20260101-000000-9201');
    assert.deepEqual(await cancelJob(bareCtx(project), { id: 'd-20260101-000000-9201' }), { outcome: 'cancelled' });
    assert.deepEqual(await cancelJob(bareCtx(project), { id: 'd-20260101-000000-9201' }), { outcome: 'already-terminal' });
  });

  it('fails a queued job and reports not-found for an unknown id', async () => {
    const project = await makeProject(true);
    await seedQueued(project, 'd-20260101-000000-9301');
    assert.deepEqual(await failJob(bareCtx(project), { id: 'd-20260101-000000-9301' }), { outcome: 'failed' });
    assert.deepEqual(await failJob(bareCtx(project), { id: 'd-20990101-000000-ffff' }), { outcome: 'not-found' });
  });
});

describe('mcp list_jobs / get_job', () => {
  it('lists jobs with the nonce stripped', async () => {
    const project = await makeProject(true);
    await seedQueued(project, 'd-20260101-000000-9401');
    const { items } = await listJobs(bareCtx(project), {});
    assert.equal(items.length, 1);
    assert.equal(items[0]?.id, 'd-20260101-000000-9401');
    assert.equal('nonce' in (items[0] as object), false);
  });

  it('gets one job (nonce stripped) and throws for an unknown id', async () => {
    const project = await makeProject(true);
    await seedQueued(project, 'd-20260101-000000-9501');
    const { item } = await getJob(bareCtx(project), { id: 'd-20260101-000000-9501' });
    assert.equal(item.id, 'd-20260101-000000-9501');
    assert.equal('nonce' in (item as object), false);
    await assert.rejects(
      () => getJob(bareCtx(project), { id: 'd-20990101-000000-ffff' }),
      (err: unknown) => err instanceof McpError,
    );
  });
});
