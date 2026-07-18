/**
 * `POST /api/nodes/:pathB64/jobs` integration tests (Step 16 piece 1).
 *
 * Boots a real `createServer()` against a primed project (the fixture
 * probabilistic plugins + a scanned skill node whose on-disk body
 * matches the persisted hash) and exercises the contract from
 * `spec/cli-contract.md` §BFF endpoint POST /api/nodes/:pathB64/jobs:
 *
 *   - 409 `no-processing-agent` when the processing skill is absent
 *     (the operator gate; nothing enqueued).
 *   - 200 `job.submitted` envelope (validates against the schema), the
 *     job persisted `queued`, one `job.submitted` WS broadcast; the
 *     `nonce` record credential appears in NO response body.
 *   - 409 `duplicate-job` on an identical resubmit (`details.existingId`).
 *   - 409 `job-running` once the covering job is claimed.
 *   - fixer path: 409 `no-findings` without findings; with findings a
 *     changed finding set SUPERSEDES the stale queued sibling
 *     (`value.supersededIds`).
 *   - 409 `node-drifted` after an edit-after-scan.
 *   - `autoFix: true` on a finder submit freezes `state_jobs.auto_fix`;
 *     omitted defaults false; a non-boolean `autoFix` is a 400 bad body.
 *   - 404 unknown extension / unknown node / malformed pathB64 /
 *     missing DB; 400 deterministic extension, virtual node, bad body.
 */

import { strict as assert } from 'node:assert';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import { installAgentSkill } from '../../../core/agent-skill/engine.js';
import { encodeNodePath } from '../../path-codec.js';
import {
  bootAndUse,
  compileEnvelopeValidator,
  FINDER_ID,
  FIXER_ID,
  makeFakeWsClient,
  seedFindings,
  serverUrl,
  setupProbProject,
  SKILL_NODE,
  SUMMARIZER_ID,
  withProjectDb,
  type IProbProject,
} from './helpers/prob-fixture.js';

const VIRTUAL_NODE = {
  path: 'virtual/agent.md',
  kind: 'skill',
  provider: 'claude',
  virtual: true,
} as const;

interface IJobSubmittedEnvelope {
  schemaVersion: string;
  kind: string;
  value: { jobId: string; nodePath: string; extensionId: string; supersededIds: string[] };
  elapsedMs: number;
}

interface IErrorBody {
  ok: boolean;
  error: { code: string; message: string; details: { existingId?: string } | null };
}

let tmpRoot: string;
let counter = 0;
let project: IProbProject;

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-node-jobs-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

// A fresh project per test: submits mutate the queue, and the drift test
// mutates the node file, so state must never leak across cases.
beforeEach(async () => {
  counter += 1;
  const root = join(tmpRoot, `proj-${counter}`);
  project = await setupProbProject(root, [SKILL_NODE, VIRTUAL_NODE], { installSkill: true });
});

function jobsUrl(handle: Parameters<typeof serverUrl>[0], nodePath: string): string {
  return serverUrl(handle, `/api/nodes/${encodeNodePath(nodePath)}/jobs`);
}

async function postJob(
  handle: Parameters<typeof serverUrl>[0],
  nodePath: string,
  body: unknown,
): Promise<Response> {
  return fetch(jobsUrl(handle, nodePath), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/nodes/:pathB64/jobs', () => {
  it('409 no-processing-agent: the gate refuses before anything is staged', async () => {
    const bare = await setupProbProject(join(tmpRoot, `proj-gate-${counter}`), [SKILL_NODE], {
      installSkill: false,
    });
    await bootAndUse(bare, async (handle) => {
      const res = await postJob(handle, SKILL_NODE.path, { extension: SUMMARIZER_ID });
      assert.equal(res.status, 409);
      const body = (await res.json()) as IErrorBody;
      assert.equal(body.error.code, 'no-processing-agent');
      assert.match(body.error.message, /sm agent install/);
    });
    await withProjectDb(bare, async (adapter) => {
      assert.equal((await adapter.jobs.list({})).length, 0, 'nothing enqueued behind the gate');
    });
  });

  it('200: job.submitted envelope + queued row + WS broadcast, NO nonce anywhere', async () => {
    const validate = compileEnvelopeValidator();
    await bootAndUse(project, async (handle) => {
      const client = makeFakeWsClient();
      handle.broadcaster.register(client);

      const res = await postJob(handle, SKILL_NODE.path, { extension: SUMMARIZER_ID });
      assert.equal(res.status, 200);
      const raw = await res.text();
      assert.doesNotMatch(raw, /nonce/i, 'the record credential never travels to the UI');
      const env = JSON.parse(raw) as IJobSubmittedEnvelope;
      assert.equal(env.schemaVersion, '1');
      assert.equal(env.kind, 'job.submitted');
      assert.match(env.value.jobId, /^d-\d{8}-\d{6}-[0-9a-f]{4}$/);
      assert.equal(env.value.nodePath, SKILL_NODE.path);
      assert.equal(env.value.extensionId, SUMMARIZER_ID);
      assert.deepEqual(env.value.supersededIds, []);
      assert.ok(typeof env.elapsedMs === 'number');
      assert.equal(
        validate(env),
        true,
        `envelope must validate: ${JSON.stringify(validate.errors)}`,
      );

      // One WS fan-out, the canonical catalog envelope
      // (`spec/job-events.md` §`job.submitted`): unix-ms timestamp,
      // runId in mode `queue`, jobId on the envelope slot, and
      // `{ nodePath, extensionId, supersededIds }` as data. The SAME
      // shape the CLI push leg delivers via POST /api/job-events.
      assert.equal(client.sent.length, 1);
      const event = JSON.parse(client.sent[0]!) as Record<string, unknown>;
      assert.equal(event['type'], 'job.submitted');
      assert.doesNotMatch(client.sent[0]!, /nonce/i);
      assert.ok(Number.isInteger(event['timestamp']), 'unix-ms integer timestamp');
      assert.match(String(event['runId']), /^r-queue-\d{8}-\d{6}-[0-9a-f]{4}$/);
      assert.equal(event['jobId'], env.value.jobId);
      const data = event['data'] as Record<string, unknown>;
      assert.deepEqual(data, {
        nodePath: SKILL_NODE.path,
        extensionId: SUMMARIZER_ID,
        supersededIds: [],
      });
    });
    await withProjectDb(project, async (adapter) => {
      const jobs = await adapter.jobs.list({});
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0]!.status, 'queued');
      assert.equal(jobs[0]!.extensionId, SUMMARIZER_ID);
      assert.equal(jobs[0]!.nodeId, SKILL_NODE.path);
    });
  });

  it('409 duplicate-job on identical resubmit; job-running once claimed', async () => {
    await bootAndUse(project, async (handle) => {
      const first = await postJob(handle, SKILL_NODE.path, { extension: SUMMARIZER_ID });
      assert.equal(first.status, 200);
      const created = ((await first.json()) as IJobSubmittedEnvelope).value.jobId;

      const dup = await postJob(handle, SKILL_NODE.path, { extension: SUMMARIZER_ID });
      assert.equal(dup.status, 409);
      const dupRaw = await dup.text();
      assert.doesNotMatch(dupRaw, /nonce/i);
      const dupBody = JSON.parse(dupRaw) as IErrorBody;
      assert.equal(dupBody.error.code, 'duplicate-job');
      assert.equal(dupBody.error.details?.existingId, created);

      // Claim it (the external agent) -> the covering job is RUNNING.
      await withProjectDb(project, async (adapter) => {
        const claim = await adapter.jobs.claim('agent', Date.now());
        assert.equal(claim?.id, created);
      });
      const running = await postJob(handle, SKILL_NODE.path, { extension: SUMMARIZER_ID });
      assert.equal(running.status, 409);
      const runningBody = (await running.json()) as IErrorBody;
      assert.equal(runningBody.error.code, 'job-running');
      assert.equal(runningBody.error.details?.existingId, created);
    });
  });

  it('fixer: 409 no-findings without findings; supersede reported on a changed set', async () => {
    await bootAndUse(project, async (handle) => {
      const refused = await postJob(handle, SKILL_NODE.path, { extension: FIXER_ID });
      assert.equal(refused.status, 409);
      const refusedBody = (await refused.json()) as IErrorBody;
      assert.equal(refusedBody.error.code, 'no-findings');
      assert.match(refusedBody.error.message, /run the finder first/);

      // Findings land -> the fixer submit renders + enqueues.
      await seedFindings(project, SKILL_NODE.path, FINDER_ID, [{ type: 'defect-a' }]);
      const first = await postJob(handle, SKILL_NODE.path, { extension: FIXER_ID });
      assert.equal(first.status, 200);
      const firstEnv = (await first.json()) as IJobSubmittedEnvelope;
      assert.deepEqual(firstEnv.value.supersededIds, []);

      // The finder re-judges (different finding set) -> the resubmit
      // CANCELS the stale queued sibling in the same transaction.
      await seedFindings(project, SKILL_NODE.path, FINDER_ID, [
        { type: 'defect-a' },
        { type: 'defect-b' },
      ]);
      const second = await postJob(handle, SKILL_NODE.path, { extension: FIXER_ID });
      assert.equal(second.status, 200);
      const secondEnv = (await second.json()) as IJobSubmittedEnvelope;
      assert.deepEqual(secondEnv.value.supersededIds, [firstEnv.value.jobId]);
    });
    await withProjectDb(project, async (adapter) => {
      const jobs = await adapter.jobs.list({ extensionId: FIXER_ID });
      assert.equal(jobs.filter((j) => j.status === 'queued').length, 1);
      assert.equal(jobs.filter((j) => j.status === 'cancelled').length, 1);
    });
  });

  it('autoFix: true on a finder freezes state_jobs.auto_fix', async () => {
    await bootAndUse(project, async (handle) => {
      const res = await postJob(handle, SKILL_NODE.path, { extension: FINDER_ID, autoFix: true });
      assert.equal(res.status, 200);
      const env = (await res.json()) as IJobSubmittedEnvelope;
      assert.equal(env.value.extensionId, FINDER_ID);
    });
    await withProjectDb(project, async (adapter) => {
      const [job] = await adapter.jobs.list({ extensionId: FINDER_ID });
      assert.ok(job, 'the finder job was enqueued');
      assert.equal(job.autoFix, true, 'the per-job auto-fix flag is frozen on the row');
    });
  });

  it('autoFix defaults false when the body omits it', async () => {
    await bootAndUse(project, async (handle) => {
      const res = await postJob(handle, SKILL_NODE.path, { extension: FINDER_ID });
      assert.equal(res.status, 200);
    });
    await withProjectDb(project, async (adapter) => {
      const [job] = await adapter.jobs.list({ extensionId: FINDER_ID });
      assert.ok(job);
      assert.equal(job.autoFix, false, 'omitted autoFix is off');
    });
  });

  it('409 node-drifted after an edit-after-scan', async () => {
    appendFileSync(join(project.root, SKILL_NODE.path), 'drifted\n');
    await bootAndUse(project, async (handle) => {
      const res = await postJob(handle, SKILL_NODE.path, { extension: SUMMARIZER_ID });
      assert.equal(res.status, 409);
      const body = (await res.json()) as IErrorBody;
      assert.equal(body.error.code, 'node-drifted');
      assert.match(body.error.message, /run sm scan/);
    });
  });

  it('404: unknown extension, unknown node, malformed pathB64', async () => {
    await bootAndUse(project, async (handle) => {
      const badExt = await postJob(handle, SKILL_NODE.path, { extension: 'nope/never' });
      assert.equal(badExt.status, 404);
      assert.equal(((await badExt.json()) as IErrorBody).error.code, 'not-found');

      const badNode = await postJob(handle, 'docs/never.md', { extension: SUMMARIZER_ID });
      assert.equal(badNode.status, 404);

      const malformed = await fetch(serverUrl(handle, '/api/nodes/!!!/jobs'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ extension: SUMMARIZER_ID }),
      });
      assert.equal(malformed.status, 404);
    });
  });

  it('400: deterministic extension, virtual node, malformed body', async () => {
    await bootAndUse(project, async (handle) => {
      // `core/node-set-tags` is a built-in DETERMINISTIC action:
      // queueing it is refused like the CLI's exit 2 (same target the
      // CLI submit suite uses).
      const det = await postJob(handle, SKILL_NODE.path, { extension: 'core/node-set-tags' });
      assert.equal(det.status, 400);
      const detBody = (await det.json()) as IErrorBody;
      assert.equal(detBody.error.code, 'bad-query');
      assert.match(detBody.error.message, /only probabilistic extensions are queued/);

      const virtual = await postJob(handle, VIRTUAL_NODE.path, { extension: SUMMARIZER_ID });
      assert.equal(virtual.status, 400);
      assert.match(((await virtual.json()) as IErrorBody).error.message, /virtual/);

      const missing = await postJob(handle, SKILL_NODE.path, {});
      assert.equal(missing.status, 400);
      const wrongType = await postJob(handle, SKILL_NODE.path, { extension: 42 });
      assert.equal(wrongType.status, 400);
      const unknownKey = await postJob(handle, SKILL_NODE.path, {
        extension: SUMMARIZER_ID,
        force: true,
      });
      assert.equal(unknownKey.status, 400);
      const badAutoFix = await postJob(handle, SKILL_NODE.path, {
        extension: FINDER_ID,
        autoFix: 'yes',
      });
      assert.equal(badAutoFix.status, 400);
    });
  });

  it('mid-session enable: a just-enabled finder becomes SUBMITTABLE without a restart', async () => {
    // Boot ONCE with `prob-finder/quality-check` config-disabled at the
    // extension level, submit against it (refused, it is not in the
    // composed runtime), then enable it through the running server's own
    // PATCH route and submit again on the SAME server, no reboot. This is
    // the launcher's other half: the catalog now SHOWS the finder after a
    // mid-session enable, and this proves the button it renders actually
    // enqueues instead of 404-ing.
    const live = await setupProbProject(join(tmpRoot, `proj-live-${counter}`), [SKILL_NODE], {
      installSkill: true,
    });
    writeFileSync(
      join(live.root, '.skill-map', 'settings.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          plugins: { 'prob-finder': { extensions: { 'quality-check': { enabled: false } } } },
        },
        null,
        2,
      ),
    );
    await bootAndUse(live, async (handle) => {
      // Before: the disabled finder is not in the composed runtime, so
      // the submit engine cannot resolve it -> 404 not-found (identical
      // to an unknown extension id).
      const before = await postJob(handle, SKILL_NODE.path, { extension: FINDER_ID });
      assert.equal(before.status, 404, 'a config-disabled finder is unsubmittable');
      assert.equal(((await before.json()) as IErrorBody).error.code, 'not-found');

      // Enable it through the running server's PATCH route (writes
      // settings.json + configService.reload() inside the handler).
      const patch = await fetch(
        serverUrl(handle, '/api/plugins/prob-finder/extensions/quality-check'),
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ enabled: true }),
        },
      );
      assert.equal(patch.status, 200, 'the enable PATCH succeeds');

      // After: the SAME server resolves + enqueues the finder, no reboot.
      const after = await postJob(handle, SKILL_NODE.path, { extension: FINDER_ID });
      assert.equal(after.status, 200, 'the just-enabled finder submits without a restart');
      const env = (await after.json()) as IJobSubmittedEnvelope;
      assert.equal(env.value.extensionId, FINDER_ID);
    });
    await withProjectDb(live, async (adapter) => {
      const [job] = await adapter.jobs.list({ extensionId: FINDER_ID });
      assert.ok(job, 'the finder job was enqueued on the running server');
      assert.equal(job.status, 'queued');
    });
  });

  it('404: missing DB', async () => {
    // A skill-installed project with NO DB file. The extension is a
    // BUILT-IN probabilistic action (`core/ai-summarizer-action`, no
    // drop-in discovery / trust involved) so target resolution succeeds
    // and the 404 is honestly the missing-DB refusal, not an
    // unknown-extension one. The summarizer ships experimental (disabled
    // by default), so opt it back in via settings.json to keep resolution
    // succeeding.
    const bare = mkdtempSync(join(tmpRoot, 'nodb-'));
    installAgentSkill(bare, '.claude/skills');
    mkdirSync(join(bare, '.skill-map'), { recursive: true });
    writeFileSync(
      join(bare, '.skill-map', 'settings.json'),
      JSON.stringify({ plugins: { core: { extensions: { 'ai-summarizer-action': { enabled: true } } } } }),
    );
    const bareProject = { root: bare, dbPath: join(bare, '.skill-map', 'skill-map.db') };
    await bootAndUse(bareProject, async (handle) => {
      const res = await postJob(handle, SKILL_NODE.path, {
        extension: 'core/ai-summarizer-action',
      });
      assert.equal(res.status, 404);
      assert.equal(((await res.json()) as IErrorBody).error.code, 'not-found');
    });
  });
});
