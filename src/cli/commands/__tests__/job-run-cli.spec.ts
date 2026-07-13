/**
 * End-to-end tests for `sm job run` (Step 10 Phase E, the CLI-runner drain
 * loop) against a real project DB (never `:memory:`, see
 * feedback_sqlite_in_memory_workaround). Every test injects a `MockRunner`
 * through the `_setRunnerFactoryForTests` seam; no `claude` subprocess is
 * ever spawned.
 *
 * Coverage:
 *   - `--all` with a valid `core/markdown-summarizer` report: both jobs
 *     completed (priority order respected), executions written with runner
 *     metrics, summaries upserted (writesSummary), queue drained.
 *   - invalid report -> failed / report-invalid (exit 1, no summary).
 *   - non-zero runner exit -> failed / runner-error, output attempt stored
 *     as the failure detail (exit 1).
 *   - reap runs FIRST: an expired running job is reaped (failed /
 *     abandoned) before any claim, never re-run.
 *   - `--max 1` stops after one job (the other stays queued).
 *   - empty queue -> exit 0 with the "queue empty" note.
 *   - `ClaudeCliNotFoundError` from the runner: the claimed job is failed
 *     (runner-error), the drain aborts, exit 2 with the install advisory.
 *   - `--all` + `--max` -> usage error, exit 2.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strictEqual, ok, match } from 'node:assert';
import { after, afterEach, before, describe, it } from 'node:test';

import type { BaseContext } from 'clipanion';

import { JobSubmitCommand } from '../job-queue.js';
import { JobRunCommand, _setRunnerFactoryForTests } from '../job-run.js';
import {
  ClaudeCliNotFoundError,
  MockRunner,
} from '../../../kernel/adapters/runner/index.js';
import type { IRunResult, RunnerPort } from '../../../kernel/ports/runner.js';
import { SqliteStorageAdapter } from '../../../kernel/adapters/sqlite/index.js';
import { sha256 } from '../../../kernel/orchestrator/node-build.js';
import type { Job } from '../../../kernel/types.js';

const ACTION_ID = 'core/markdown-summarizer';
const NOTE_A = { path: 'notes/alpha.md', kind: 'markdown', provider: 'markdown' };
const NOTE_B = { path: 'notes/beta.md', kind: 'markdown', provider: 'markdown' };

const VALID_REPORT = {
  whatItCovers: 'A short guide to the thing.',
  confidence: 0.9,
  safety: { injectionDetected: false, contentQuality: 'clean' },
};

interface IRunEnvelope {
  reaped: number;
  processed: {
    jobId: string;
    executionId: string;
    status: 'completed' | 'failed';
    failureReason: string | null;
  }[];
  counts: { processed: number; completed: number; failed: number };
}

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

/** Temp project with a migrated DB and real markdown body files. */
async function setupProject(nodes = [NOTE_A]): Promise<IProject> {
  counter += 1;
  const root = join(tmpRoot, `proj-${counter}`);
  const dbPath = join(root, '.skill-map', 'skill-map.db');
  mkdirSync(join(root, '.skill-map'), { recursive: true });

  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  try {
    for (const node of nodes) {
      await insertNode(adapter, node);
      const abs = join(root, node.path);
      mkdirSync(join(abs, '..'), { recursive: true });
      writeFileSync(abs, `---\ntitle: t\n---\nBody of ${node.path}\n`);
    }
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

function buildSubmit(node: string, priority?: string): JobSubmitCommand {
  const cmd = new JobSubmitCommand();
  cmd.action = ACTION_ID;
  cmd.node = node;
  cmd.all = false;
  cmd.runFlag = false;
  cmd.force = false;
  cmd.ttl = undefined;
  cmd.priority = priority;
  cmd.json = true;
  cmd.db = undefined;
  return cmd;
}

function buildRun(o: { all?: boolean; max?: string; json?: boolean } = {}): JobRunCommand {
  const cmd = new JobRunCommand();
  cmd.all = o.all ?? false;
  cmd.max = o.max;
  cmd.json = o.json ?? true;
  cmd.db = undefined;
  return cmd;
}

/** Submit one job for `node` and return the created job row. */
async function submitJob(proj: IProject, node: string, priority?: string): Promise<Job> {
  return withCwd(proj.root, async () => {
    const cap = captureContext();
    const code = await run(buildSubmit(node, priority), cap);
    strictEqual(code, 0, `submit ${node}: ${cap.stderr()}`);
    return JSON.parse(cap.stdout()) as Job;
  });
}

async function runDrain(
  proj: IProject,
  o: { all?: boolean; max?: string; json?: boolean } = {},
): Promise<{ code: number; cap: ICaptured }> {
  const cap = captureContext();
  const code = await withCwd(proj.root, async () => run(buildRun(o), cap));
  return { code, cap };
}

async function getJob(proj: IProject, id: string): Promise<Job | null> {
  const adapter = await openDb(proj.dbPath);
  try {
    return await adapter.jobs.get(id);
  } finally {
    await adapter.close();
  }
}

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-job-run-cli-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

afterEach(() => {
  _setRunnerFactoryForTests(null);
});

describe('sm job run, drain loop with MockRunner', () => {
  it('--all completes both jobs in priority order, writes executions + summaries, drains the queue', async () => {
    const proj = await setupProject([NOTE_A, NOTE_B]);
    const jobA = await submitJob(proj, NOTE_A.path, '1');
    const jobB = await submitJob(proj, NOTE_B.path, '5');

    const mock = new MockRunner({
      reportJson: JSON.stringify(VALID_REPORT),
      tokensIn: 100,
      tokensOut: 20,
      durationMs: 50,
    });
    _setRunnerFactoryForTests(() => mock);

    const { code, cap } = await runDrain(proj, { all: true });
    strictEqual(code, 0, cap.stderr());

    const doc = JSON.parse(cap.stdout()) as IRunEnvelope;
    strictEqual(doc.reaped, 0);
    strictEqual(doc.counts.processed, 2);
    strictEqual(doc.counts.completed, 2);
    strictEqual(doc.counts.failed, 0);
    // Priority order: job B (priority 5) claims before job A (priority 1).
    strictEqual(doc.processed[0]!.jobId, jobB.id);
    strictEqual(doc.processed[1]!.jobId, jobA.id);
    strictEqual(mock.calls.length, 2);
    // The runner receives the rendered content, not a path.
    ok(mock.calls[0]!.jobContent.includes(`Body of ${NOTE_B.path}`), 'content piped');
    ok((mock.calls[0]!.options?.timeoutMs ?? 0) > 0, 'timeout derived from ttl');

    const adapter = await openDb(proj.dbPath);
    try {
      const counts = await adapter.jobs.countByStatus();
      strictEqual(counts.queued, 0);
      strictEqual(counts.running, 0);
      strictEqual(counts.completed, 2);

      const executions = await adapter.db
        .selectFrom('state_executions')
        .selectAll()
        .execute();
      strictEqual(executions.length, 2);
      for (const exec of executions) {
        strictEqual(exec.status, 'completed');
        strictEqual(exec.runner, 'cli');
        strictEqual(exec.exitCode, 0);
        strictEqual(exec.tokensIn, 100);
        strictEqual(exec.tokensOut, 20);
        ok(exec.reportJson!.includes('A short guide'), 'report stored inline');
      }

      // writesSummary write-through: one summary per node.
      for (const node of [NOTE_A, NOTE_B]) {
        const summaries = await adapter.summaries.forNode(node.path);
        strictEqual(summaries.length, 1, `summary for ${node.path}`);
        strictEqual(summaries[0]!.summarizerActionId, ACTION_ID);
      }
    } finally {
      await adapter.close();
    }
  });

  it('an invalid report fails the job as report-invalid (exit 1, no summary)', async () => {
    const proj = await setupProject();
    const job = await submitJob(proj, NOTE_A.path);
    _setRunnerFactoryForTests(() => new MockRunner({ reportJson: '{"nope": true}' }));

    const { code, cap } = await runDrain(proj);
    strictEqual(code, 1, cap.stderr());
    const doc = JSON.parse(cap.stdout()) as IRunEnvelope;
    strictEqual(doc.processed[0]!.status, 'failed');
    strictEqual(doc.processed[0]!.failureReason, 'report-invalid');

    const closed = await getJob(proj, job.id);
    strictEqual(closed!.status, 'failed');
    strictEqual(closed!.failureReason, 'report-invalid');

    const adapter = await openDb(proj.dbPath);
    try {
      strictEqual((await adapter.summaries.forNode(NOTE_A.path)).length, 0, 'no summary');
    } finally {
      await adapter.close();
    }
  });

  it('a non-zero runner exit fails the job as runner-error with the output attempt stored', async () => {
    const proj = await setupProject();
    const job = await submitJob(proj, NOTE_A.path);
    _setRunnerFactoryForTests(
      () => new MockRunner({ reportJson: 'model blew up', exitCode: 3 }),
    );

    const { code, cap } = await runDrain(proj);
    strictEqual(code, 1, cap.stderr());
    const doc = JSON.parse(cap.stdout()) as IRunEnvelope;
    strictEqual(doc.processed[0]!.failureReason, 'runner-error');

    const closed = await getJob(proj, job.id);
    strictEqual(closed!.status, 'failed');
    strictEqual(closed!.failureReason, 'runner-error');

    const adapter = await openDb(proj.dbPath);
    try {
      const exec = await adapter.db
        .selectFrom('state_executions')
        .selectAll()
        .executeTakeFirstOrThrow();
      strictEqual(exec.exitCode, 3);
      strictEqual(exec.reportJson, 'model blew up');
    } finally {
      await adapter.close();
    }
  });

  it('reaps expired running jobs BEFORE claiming (failed / abandoned, never re-run)', async () => {
    const proj = await setupProject([NOTE_A, NOTE_B]);
    const expired = await submitJob(proj, NOTE_A.path);
    const fresh = await submitJob(proj, NOTE_B.path);

    // Seed the expired running job directly: claimed long ago, TTL passed.
    const seed = await openDb(proj.dbPath);
    try {
      await seed.db
        .updateTable('state_jobs')
        .set({
          status: 'running',
          runner: 'cli',
          claimedAt: Date.now() - 10_000,
          expiresAt: Date.now() - 5_000,
        })
        .where('id', '=', expired.id)
        .execute();
    } finally {
      await seed.close();
    }

    const mock = new MockRunner({ reportJson: JSON.stringify(VALID_REPORT) });
    _setRunnerFactoryForTests(() => mock);

    const { code, cap } = await runDrain(proj, { all: true });
    strictEqual(code, 0, cap.stderr());
    const doc = JSON.parse(cap.stdout()) as IRunEnvelope;
    strictEqual(doc.reaped, 1);
    // Only the fresh job was claimed and run; the reaped one never was.
    strictEqual(doc.counts.processed, 1);
    strictEqual(doc.processed[0]!.jobId, fresh.id);
    strictEqual(mock.calls.length, 1);

    const reaped = await getJob(proj, expired.id);
    strictEqual(reaped!.status, 'failed');
    strictEqual(reaped!.failureReason, 'abandoned');
  });

  it('--max 1 stops after one job, leaving the rest queued', async () => {
    const proj = await setupProject([NOTE_A, NOTE_B]);
    await submitJob(proj, NOTE_A.path);
    await submitJob(proj, NOTE_B.path);
    _setRunnerFactoryForTests(() => new MockRunner({ reportJson: JSON.stringify(VALID_REPORT) }));

    const { code, cap } = await runDrain(proj, { max: '1' });
    strictEqual(code, 0, cap.stderr());
    const doc = JSON.parse(cap.stdout()) as IRunEnvelope;
    strictEqual(doc.counts.processed, 1);

    const adapter = await openDb(proj.dbPath);
    try {
      const counts = await adapter.jobs.countByStatus();
      strictEqual(counts.completed, 1);
      strictEqual(counts.queued, 1);
    } finally {
      await adapter.close();
    }
  });

  it('an empty queue exits 0 with the queue-empty note', async () => {
    const proj = await setupProject();
    _setRunnerFactoryForTests(() => new MockRunner());

    const { code, cap } = await runDrain(proj, { json: false });
    strictEqual(code, 0, cap.stderr());
    match(cap.stderr(), /queue empty/);
  });

  it('a missing claude binary fails the claimed job and aborts with exit 2', async () => {
    const proj = await setupProject([NOTE_A, NOTE_B]);
    const first = await submitJob(proj, NOTE_A.path, '5');
    const second = await submitJob(proj, NOTE_B.path, '1');
    _setRunnerFactoryForTests(
      () => new MockRunner({ error: new ClaudeCliNotFoundError('claude') }),
    );

    const { code, cap } = await runDrain(proj, { all: true });
    strictEqual(code, 2, cap.stderr());
    match(cap.stderr(), /claude CLI not found/);

    // The claimed job was closed (failed / runner-error), never stranded
    // in running; the rest of the queue was left untouched.
    const closed = await getJob(proj, first.id);
    strictEqual(closed!.status, 'failed');
    strictEqual(closed!.failureReason, 'runner-error');
    const untouched = await getJob(proj, second.id);
    strictEqual(untouched!.status, 'queued');
  });

  it('--all and --max together are a usage error (exit 2)', async () => {
    const proj = await setupProject();
    _setRunnerFactoryForTests(() => new MockRunner());

    const { code, cap } = await runDrain(proj, { all: true, max: '2' });
    strictEqual(code, 2);
    match(cap.stderr(), /mutually exclusive/);
  });

  it('discards the result when the job is cancelled mid-run (no execution row, drain continues)', async () => {
    const proj = await setupProject([NOTE_A]);
    const job = await submitJob(proj, NOTE_A.path);

    // A runner that cancels the running job BEFORE returning its (valid)
    // report: the record transaction then loses the race, throws the typed
    // JobNotRunningError, and the loop discards the result.
    const cancellingRunner: RunnerPort = {
      async run(): Promise<IRunResult> {
        const adapter = await openDb(proj.dbPath);
        try {
          await adapter.jobs.cancelAllActive(Date.now());
        } finally {
          await adapter.close();
        }
        return {
          reportJson: JSON.stringify(VALID_REPORT),
          tokensIn: 1,
          tokensOut: 1,
          durationMs: 1,
          exitCode: 0,
        };
      },
    };
    _setRunnerFactoryForTests(() => cancellingRunner);

    const { code, cap } = await runDrain(proj, { all: true });
    strictEqual(code, 0, 'a pure-discard drain is not a drain failure');
    match(cap.stderr(), /result discarded/);

    const doc = JSON.parse(cap.stdout()) as IRunEnvelope & {
      counts: { discarded: number };
    };
    strictEqual(doc.counts.processed, 0);
    strictEqual(doc.counts.discarded, 1);

    // The operator's cancellation stands; the rolled-back record left no
    // execution row behind.
    const adapter = await openDb(proj.dbPath);
    try {
      const closed = await adapter.jobs.get(job.id);
      strictEqual(closed!.status, 'cancelled');
      strictEqual((await adapter.history.list({})).length, 0, 'no orphan execution row');
    } finally {
      await adapter.close();
    }
  });
});
