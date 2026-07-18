/**
 * End-to-end tests for `sm record` (Step 10 Phase D, the job callback)
 * against a real project DB. The happy completed path runs the full loop
 * against the built-in `core/markdown-summarizer`: `sm jobs submit` ->
 * `sm jobs claim` (to obtain the nonce) -> `sm record --status completed`
 * with a schema-valid report. The error paths seed a job directly through
 * the storage port (mirroring `job-claim-cli.spec.ts`).
 *
 * Coverage:
 *   - full loop: submit -> claim -> record completed with a VALID report
 *     -> job completed + a state_executions row with the report inline;
 *     --json streams the synthetic ndjson run envelope
 *     (`spec/job-events.md`), the only JSON output.
 *   - bad nonce -> exit 4, no mutation (job stays running).
 *   - non-running job (queued / already terminal) -> exit 2.
 *   - record completed with an INVALID report -> job failed / report-invalid
 *     + exit 2 (report-invalid is the "otherwise" bucket).
 *   - record failed --error -> job failed / runner-error, exit 0, error text
 *     stored verbatim in report_json.
 *   - missing id -> exit 5.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deepStrictEqual, strictEqual, ok, match } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import type { BaseContext } from 'clipanion';

import { JobSubmitCommand, JobClaimCommand } from '../job-queue.js';
import { RecordCommand } from '../record.js';
import { SqliteStorageAdapter } from '../../../kernel/adapters/sqlite/index.js';
import { sha256 } from '../../../kernel/orchestrator/node-build.js';
import type { IJobSubmitRow } from '../../../kernel/types/storage.js';
import { installAgentSkill } from '../../../core/agent-skill/engine.js';

const ACTION_ID = 'core/markdown-summarizer';
const NOTE = { path: 'notes/guide.md', kind: 'markdown', provider: 'markdown' };

const VALID_REPORT = {
  whatItCovers: 'A short guide to the thing.',
  confidence: 0.9,
  safety: { injectionDetected: false, contentQuality: 'clean' },
};

let tmpRoot: string;
let counter = 0;

interface ICaptured {
  context: BaseContext;
  stdout: () => string;
  stderr: () => string;
}

function captureContext(): ICaptured {
  const out: string[] = [];
  const err: string[] = [];
  const context = {
    stdout: { write: (s: string) => { out.push(s); return true; } },
    stderr: { write: (s: string) => { err.push(s); return true; } },
  } as unknown as BaseContext;
  return { context, stdout: () => out.join(''), stderr: () => err.join('') };
}

async function insertNode(
  adapter: SqliteStorageAdapter,
  opts: { path: string; kind: string; provider: string },
): Promise<void> {
  await adapter.db
    .insertInto('scan_nodes')
    .values({
      path: opts.path,
      kind: opts.kind,
      provider: opts.provider,
      title: null,
      description: null,
      stability: null,
      version: null,
      sidecarStatus: null,
      annotationsJson: null,
      sidecarRootJson: null,
      frontmatterJson: '{}',
      // Real hash of the written body: submit now verifies disk vs scan.
      bodyHash: sha256(`Body of ${opts.path}\n`),
      frontmatterHash: 'f'.repeat(64),
      bytesFrontmatter: 0,
      bytesBody: 8,
      bytesTotal: 8,
      tokensFrontmatter: null,
      tokensBody: null,
      tokensTotal: null,
      externalRefsJson: null,
      scannedAt: Date.now(),
      modifiedAtMs: null,
      virtual: 0,
      derivedFromJson: null,
    })
    .execute();
}

interface IProject {
  root: string;
  dbPath: string;
}

/** Temp project with a migrated DB and a real markdown body file. */
async function setupProject(): Promise<IProject> {
  counter += 1;
  const root = join(tmpRoot, `proj-${counter}`);
  const dbPath = join(root, '.skill-map', 'skill-map.db');
  mkdirSync(join(root, '.skill-map'), { recursive: true });
  // Processing-agent gate (spec/job-lifecycle.md §Submit): submits refuse
  // unless the processing skill is installed; materialise the canonical copy.
  installAgentSkill(root, '.claude/skills');

  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  try {
    await insertNode(adapter, NOTE);
    const abs = join(root, NOTE.path);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, `---\ntitle: t\n---\nBody of ${NOTE.path}\n`);
  } finally {
    await adapter.close();
  }
  return { root, dbPath };
}

async function openDb(dbPath: string): Promise<SqliteStorageAdapter> {
  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  return adapter;
}

/** Seed a queued job directly through the port (no scan / submit command). */
async function seedQueued(dbPath: string, id: string): Promise<{ id: string; nonce: string }> {
  const adapter = await openDb(dbPath);
  try {
    const row: IJobSubmitRow = {
      id,
      extensionId: ACTION_ID,
      extensionVersion: '1.0.0',
      extensionKind: 'action',
      nodeId: NOTE.path,
      contentHash: 'h'.repeat(64),
      nonce: `nonce-${id}`,
      priority: 0,
      status: 'queued',
      ttlSeconds: 3600,
      createdAt: Date.now(),
    };
    await adapter.jobs.submit(row, { contentHash: row.contentHash, content: `R ${id}`, createdAt: row.createdAt });
    return { id, nonce: row.nonce };
  } finally {
    await adapter.close();
  }
}

/** Seed a queued job and claim it so it is `running`. */
async function seedRunning(dbPath: string, id: string): Promise<{ id: string; nonce: string }> {
  await seedQueued(dbPath, id);
  const adapter = await openDb(dbPath);
  try {
    const claim = await adapter.jobs.claim('agent', Date.now());
    ok(claim);
    return { id: claim.id, nonce: claim.nonce };
  } finally {
    await adapter.close();
  }
}

async function run(cmd: { context: BaseContext; execute(): Promise<number> }, cap: ICaptured): Promise<number> {
  cmd.context = cap.context;
  return cmd.execute();
}

async function withCwd<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const orig = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(orig);
  }
}

function buildSubmit(node: string): JobSubmitCommand {
  const cmd = new JobSubmitCommand();
  cmd.extension = ACTION_ID;
  cmd.node = node;
  cmd.all = false;
  cmd.force = false;
  cmd.ttl = undefined;
  cmd.priority = undefined;
  cmd.json = false;
  cmd.db = undefined;
  return cmd;
}

function buildClaim(): JobClaimCommand {
  const cmd = new JobClaimCommand();
  cmd.filter = undefined;
  cmd.json = true;
  cmd.wait = false;
  cmd.db = undefined;
  return cmd;
}

interface IRecordOverrides {
  id?: string;
  nonce?: string;
  status: string;
  report?: string;
  error?: string;
  tokensIn?: string;
  tokensOut?: string;
  durationMs?: string;
  model?: string;
  json?: boolean;
}

function buildRecord(o: IRecordOverrides): RecordCommand {
  const cmd = new RecordCommand();
  cmd.id = o.id ?? '';
  cmd.nonce = o.nonce ?? '';
  cmd.status = o.status;
  cmd.report = o.report;
  cmd.error = o.error;
  cmd.tokensIn = o.tokensIn;
  cmd.tokensOut = o.tokensOut;
  cmd.durationMs = o.durationMs;
  cmd.model = o.model;
  cmd.json = o.json ?? false;
  cmd.db = undefined;
  return cmd;
}

/** Full loop: submit + claim through the real commands, return id + nonce. */
async function submitAndClaim(root: string): Promise<{ id: string; nonce: string }> {
  await withCwd(root, async () => run(buildSubmit(NOTE.path), captureContext()));
  return withCwd(root, async () => {
    const cap = captureContext();
    await run(buildClaim(), cap);
    const parsed = JSON.parse(cap.stdout()) as { id: string; nonce: string };
    return { id: parsed.id, nonce: parsed.nonce };
  });
}

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-record-cli-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('sm record --status completed', () => {
  it('full loop: submit -> claim -> record a valid report -> job completed + execution row', async () => {
    const proj = await setupProject();
    const { id, nonce } = await submitAndClaim(proj.root);

    writeFileSync(join(proj.root, 'report.json'), JSON.stringify(VALID_REPORT));
    const code = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const c = await run(
        buildRecord({ id, nonce, status: 'completed', report: 'report.json', tokensIn: '12', tokensOut: '34', json: true }),
        cap,
      );
      // --json is the synthetic ndjson run envelope (spec/job-events.md):
      // one event per line, run-level events with jobId null, and the new
      // execution id on job.callback.received.data.executionId.
      const events = cap.stdout().trim().split('\n').map(
        (line) =>
          JSON.parse(line) as {
            type: string;
            timestamp: number;
            runId: string;
            jobId: string | null;
            data: Record<string, unknown>;
          },
      );
      deepStrictEqual(
        events.map((e) => e.type),
        ['run.started', 'job.claimed', 'job.callback.received', 'job.completed', 'run.summary'],
      );
      match(events[0]!.runId, /^r-ext-\d{8}-\d{6}-[0-9a-f]{4}$/);
      ok(events.every((e) => e.runId === events[0]!.runId), 'one runId per envelope');
      strictEqual(events[0]!.jobId, null);
      strictEqual(events[0]!.data['mode'], 'external');
      // job.claimed is replayed from the job row.
      strictEqual(events[1]!.jobId, id);
      strictEqual(events[1]!.data['extensionId'], ACTION_ID);
      strictEqual(events[1]!.data['nodeId'], NOTE.path);
      strictEqual(events[2]!.data['status'], 'completed');
      match(String(events[2]!.data['executionId']), /^e-\d{8}-\d{6}-[0-9a-f]{4}$/);
      strictEqual(events[3]!.data['tokensIn'], 12);
      strictEqual(events[3]!.data['tokensOut'], 34);
      // job.completed carries the job's frozen extension identity so a hook
      // can filter to a kind / extension (Decision #144, core/auto-fix).
      strictEqual(events[3]!.data['extensionId'], ACTION_ID);
      strictEqual(events[3]!.data['extensionKind'], 'action');
      strictEqual(events[4]!.jobId, null);
      strictEqual(events[4]!.data['jobsAttempted'], 1);
      strictEqual(events[4]!.data['jobsCompleted'], 1);
      strictEqual(events[4]!.data['jobsFailed'], 0);
      return c;
    });
    strictEqual(code, 0);

    const adapter = await openDb(proj.dbPath);
    try {
      const job = await adapter.jobs.get(id);
      ok(job);
      strictEqual(job.status, 'completed');
      ok(job.finishedAt, 'finishedAt stamped');

      const rows = await adapter.history.list({});
      strictEqual(rows.length, 1);
      const rec = rows[0]!;
      strictEqual(rec.jobId, id);
      strictEqual(rec.status, 'completed');
      strictEqual(rec.tokensIn, 12);
      strictEqual(rec.tokensOut, 34);
      ok(rec.reportPath, 'report stored inline');
      strictEqual(JSON.parse(rec.reportPath!).whatItCovers, VALID_REPORT.whatItCovers);
    } finally {
      await adapter.close();
    }
  });

  it('an INVALID report moves the job to failed / report-invalid and exits 2', async () => {
    const proj = await setupProject();
    const { id, nonce } = await seedRunning(proj.dbPath, 'd-20260101-000000-0011');

    // Missing whatItCovers + safety (report-base requires safety + confidence).
    writeFileSync(join(proj.root, 'bad.json'), JSON.stringify({ confidence: 0.5 }));
    const code = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const c = await run(buildRecord({ id, nonce, status: 'completed', report: 'bad.json' }), cap);
      match(cap.stderr(), /schema validation/);
      return c;
    });
    strictEqual(code, 2);

    const adapter = await openDb(proj.dbPath);
    try {
      const job = await adapter.jobs.get(id);
      ok(job);
      strictEqual(job.status, 'failed');
      strictEqual(job.failureReason, 'report-invalid');
      const rows = await adapter.history.list({});
      strictEqual(rows[0]!.failureReason, 'report-invalid');
    } finally {
      await adapter.close();
    }
  });

  it('rejects --status completed with no --report (exit 2, no mutation)', async () => {
    const proj = await setupProject();
    const { id, nonce } = await seedRunning(proj.dbPath, 'd-20260101-000000-0012');
    const code = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const c = await run(buildRecord({ id, nonce, status: 'completed' }), cap);
      match(cap.stderr(), /requires --report/);
      return c;
    });
    strictEqual(code, 2);

    const adapter = await openDb(proj.dbPath);
    try {
      strictEqual((await adapter.jobs.get(id))!.status, 'running', 'job untouched');
    } finally {
      await adapter.close();
    }
  });
});

describe('sm record --status failed', () => {
  it('records a runner-error failure and stores --error verbatim, exit 0', async () => {
    const proj = await setupProject();
    const { id, nonce } = await seedRunning(proj.dbPath, 'd-20260101-000000-0021');
    const code = await withCwd(proj.root, async () =>
      run(buildRecord({ id, nonce, status: 'failed', error: 'model timed out' }), captureContext()),
    );
    strictEqual(code, 0);

    const adapter = await openDb(proj.dbPath);
    try {
      const job = await adapter.jobs.get(id);
      ok(job);
      strictEqual(job.status, 'failed');
      strictEqual(job.failureReason, 'runner-error');
      const rows = await adapter.history.list({});
      strictEqual(rows[0]!.failureReason, 'runner-error');
      strictEqual(rows[0]!.reportPath, 'model timed out', '--error stored verbatim');
    } finally {
      await adapter.close();
    }
  });

  it('--json streams the failed synthetic envelope (job.failed + run.summary)', async () => {
    const proj = await setupProject();
    const { id, nonce } = await seedRunning(proj.dbPath, 'd-20260101-000000-0022');
    const code = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const c = await run(
        buildRecord({ id, nonce, status: 'failed', error: 'model timed out', json: true }),
        cap,
      );
      const events = cap.stdout().trim().split('\n').map(
        (line) => JSON.parse(line) as { type: string; jobId: string | null; data: Record<string, unknown> },
      );
      deepStrictEqual(
        events.map((e) => e.type),
        ['run.started', 'job.claimed', 'job.callback.received', 'job.failed', 'run.summary'],
      );
      strictEqual(events[2]!.data['status'], 'failed');
      strictEqual(events[3]!.jobId, id);
      strictEqual(events[3]!.data['reason'], 'runner-error');
      strictEqual(events[3]!.data['message'], 'model timed out');
      strictEqual(events[4]!.data['jobsAttempted'], 1);
      strictEqual(events[4]!.data['jobsCompleted'], 0);
      strictEqual(events[4]!.data['jobsFailed'], 1);
      return c;
    });
    strictEqual(code, 0);
  });
});

describe('sm record authentication + state guards', () => {
  it('exits 4 on a nonce mismatch and does not mutate the job', async () => {
    const proj = await setupProject();
    const { id } = await seedRunning(proj.dbPath, 'd-20260101-000000-0031');
    const code = await withCwd(proj.root, async () =>
      run(buildRecord({ id, nonce: 'wrong-nonce', status: 'failed', error: 'x' }), captureContext()),
    );
    strictEqual(code, 4);

    const adapter = await openDb(proj.dbPath);
    try {
      strictEqual((await adapter.jobs.get(id))!.status, 'running', 'no mutation on nonce mismatch');
    } finally {
      await adapter.close();
    }
  });

  it('exits 2 on a non-running (queued) job', async () => {
    const proj = await setupProject();
    const { id, nonce } = await seedQueued(proj.dbPath, 'd-20260101-000000-0041');
    const code = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const c = await run(buildRecord({ id, nonce, status: 'failed', error: 'x' }), cap);
      match(cap.stderr(), /not in running state/);
      return c;
    });
    strictEqual(code, 2);
  });

  it('exits 2 on an already-terminal job', async () => {
    const proj = await setupProject();
    const { id, nonce } = await seedRunning(proj.dbPath, 'd-20260101-000000-0042');
    // Drive it terminal out-of-band.
    const seed = await openDb(proj.dbPath);
    try {
      await seed.jobs.cancel(id, Date.now());
    } finally {
      await seed.close();
    }
    const code = await withCwd(proj.root, async () =>
      run(buildRecord({ id, nonce, status: 'failed', error: 'x' }), captureContext()),
    );
    strictEqual(code, 2);
  });

  it('exits 5 for a missing job id', async () => {
    const proj = await setupProject();
    const code = await withCwd(proj.root, async () =>
      run(buildRecord({ id: 'd-20990101-000000-ffff', nonce: 'x', status: 'failed', error: 'x' }), captureContext()),
    );
    strictEqual(code, 5);
  });
});
