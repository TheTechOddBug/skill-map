/**
 * `sm job prune`, retention GC storage helper + CLI command, DB-only model.
 *
 * Covers:
 *   1. `pruneTerminalJobs`, only deletes terminal jobs older than the
 *      cutoff; preserves running/queued; collects orphaned
 *      `state_job_contents` rows in the same transaction; preserves
 *      content still referenced by a live job.
 *   2. `JobPruneCommand`, end-to-end with a seeded DB:
 *      • empty DB, exit 0, zero counts.
 *      • retention policy applied, terminal jobs deleted and their now
 *        orphaned content collected.
 *      • `--dry-run`, DB untouched.
 *      • `--json` output shape.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strictEqual, ok } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import { SqliteStorageAdapter } from '../../adapters/sqlite/index.js';
import { pruneTerminalJobs } from '../../adapters/sqlite/jobs.js';
import { JobPruneCommand } from '../../../cli/commands/jobs.js';

let tempRoot: string;
let counter = 0;

interface ICapturedContext {
  context: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream };
  stdout: () => string;
  stderr: () => string;
}

function captureContext(): ICapturedContext {
  const outChunks: Buffer[] = [];
  const errChunks: Buffer[] = [];
  const stdout = {
    write(chunk: string | Uint8Array): boolean {
      outChunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk));
      return true;
    },
  } as unknown as NodeJS.WritableStream;
  const stderr = {
    write(chunk: string | Uint8Array): boolean {
      errChunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk));
      return true;
    },
  } as unknown as NodeJS.WritableStream;
  return {
    context: { stdout, stderr },
    stdout: () => Buffer.concat(outChunks).toString('utf8'),
    stderr: () => Buffer.concat(errChunks).toString('utf8'),
  };
}

function freshScope(label: string): string {
  counter += 1;
  // The scope dir itself is created by `initDb` (the adapter mkdirs
  // `<scope>/.skill-map/` on init); this only computes a unique path.
  return join(tempRoot, `${label}-${counter}`);
}

interface ISeedJobOpts {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  finishedAt?: number | null;
  nodeId?: string;
  contentHash?: string;
}

async function seedJob(adapter: SqliteStorageAdapter, opts: ISeedJobOpts): Promise<void> {
  await adapter.db
    .insertInto('state_jobs')
    .values({
      id: opts.id,
      extensionId: 'a-test',
      extensionVersion: '1.0.0',
      extensionKind: 'action',
      nodeId: opts.nodeId ?? `node-${opts.id}`,
      contentHash: opts.contentHash ?? `hash-${opts.id}`,
      nonce: `nonce-${opts.id}`,
      status: opts.status,
      ttlSeconds: 3600,
      createdAt: Date.now(),
      finishedAt: opts.finishedAt ?? null,
    })
    .execute();
}

async function seedContent(adapter: SqliteStorageAdapter, contentHash: string): Promise<void> {
  await adapter.db
    .insertInto('state_job_contents')
    .values({ contentHash, content: `# ${contentHash}`, createdAt: Date.now() })
    .execute();
}

async function contentHashes(adapter: SqliteStorageAdapter): Promise<string[]> {
  const rows = await adapter.db
    .selectFrom('state_job_contents')
    .select('contentHash')
    .orderBy('contentHash')
    .execute();
  return rows.map((r) => r.contentHash);
}

async function initDb(scope: string): Promise<SqliteStorageAdapter> {
  const dbPath = join(scope, '.skill-map', 'skill-map.db');
  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  return adapter;
}

before(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'skill-map-job-prune-'));
});

after(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// pruneTerminalJobs
// ---------------------------------------------------------------------------

describe('pruneTerminalJobs', () => {
  it('returns 0 deletions on an empty table', async () => {
    const scope = freshScope('prune-empty');
    const adapter = await initDb(scope);
    try {
      const result = await pruneTerminalJobs(adapter.db, 'completed', Date.now());
      strictEqual(result.deletedCount, 0);
      strictEqual(result.prunedContents, 0);
    } finally {
      await adapter.close();
    }
  });

  it('deletes only completed jobs older than cutoff', async () => {
    const scope = freshScope('prune-cutoff');
    const adapter = await initDb(scope);
    try {
      const now = Date.now();
      // Old completed, should prune.
      await seedJob(adapter, { id: 'old', status: 'completed', finishedAt: now - 60_000 });
      // Recent completed, should NOT prune.
      await seedJob(adapter, { id: 'fresh', status: 'completed', finishedAt: now - 1_000 });
      // Failed, not in scope for the completed pass.
      await seedJob(adapter, { id: 'failed', status: 'failed', finishedAt: now - 60_000 });
      // Running, never pruned.
      await seedJob(adapter, { id: 'running', status: 'running' });

      const cutoff = now - 30_000;
      const result = await pruneTerminalJobs(adapter.db, 'completed', cutoff);
      strictEqual(result.deletedCount, 1);

      const remaining = await adapter.db.selectFrom('state_jobs').select('id').orderBy('id').execute();
      strictEqual(remaining.map((r) => r.id).join(','), 'failed,fresh,running');
    } finally {
      await adapter.close();
    }
  });

  it('deletes only cancelled jobs older than cutoff', async () => {
    const scope = freshScope('prune-cancelled');
    const adapter = await initDb(scope);
    try {
      const now = Date.now();
      // Old cancelled, should prune.
      await seedJob(adapter, { id: 'old', status: 'cancelled', finishedAt: now - 60_000 });
      // Recent cancelled, should NOT prune.
      await seedJob(adapter, { id: 'fresh', status: 'cancelled', finishedAt: now - 1_000 });
      // Completed, not in scope for the cancelled pass.
      await seedJob(adapter, { id: 'completed', status: 'completed', finishedAt: now - 60_000 });

      const cutoff = now - 30_000;
      const result = await pruneTerminalJobs(adapter.db, 'cancelled', cutoff);
      strictEqual(result.deletedCount, 1);

      const remaining = await adapter.db.selectFrom('state_jobs').select('id').orderBy('id').execute();
      strictEqual(remaining.map((r) => r.id).join(','), 'completed,fresh');
    } finally {
      await adapter.close();
    }
  });

  it('skips rows whose finishedAt is null', async () => {
    const scope = freshScope('prune-null');
    const adapter = await initDb(scope);
    try {
      // Edge case: a "completed" row that somehow has null finishedAt
      // (shouldn't happen via the lifecycle, but defensively guarded).
      await seedJob(adapter, { id: 'orphan', status: 'completed', finishedAt: null });
      const result = await pruneTerminalJobs(adapter.db, 'completed', Date.now());
      strictEqual(result.deletedCount, 0);
    } finally {
      await adapter.close();
    }
  });

  it('collects orphaned state_job_contents and keeps referenced content', async () => {
    const scope = freshScope('prune-content-gc');
    const adapter = await initDb(scope);
    try {
      // `h-keep` is referenced by a live (queued) job; `h-orphan` is
      // referenced by nobody, so the prune sweep must collect it.
      await seedContent(adapter, 'h-keep');
      await seedContent(adapter, 'h-orphan');
      await seedJob(adapter, { id: 'live', status: 'queued', contentHash: 'h-keep' });

      const result = await pruneTerminalJobs(adapter.db, 'completed', Date.now());
      strictEqual(result.deletedCount, 0, 'no terminal jobs to delete');
      strictEqual(result.prunedContents, 1, 'the orphaned content row is collected');

      strictEqual((await contentHashes(adapter)).join(','), 'h-keep');
    } finally {
      await adapter.close();
    }
  });

  it('collects the content a just-pruned terminal job orphaned', async () => {
    const scope = freshScope('prune-content-cascade');
    const adapter = await initDb(scope);
    try {
      const now = Date.now();
      // The completed job's content is referenced ONLY by that job, so
      // deleting the job orphans the content and the same transaction
      // collects it.
      await seedContent(adapter, 'h-expired');
      await seedContent(adapter, 'h-shared');
      await seedJob(adapter, {
        id: 'expired',
        status: 'completed',
        finishedAt: now - 60_000,
        contentHash: 'h-expired',
      });
      // A live job keeps `h-shared` around.
      await seedJob(adapter, { id: 'live', status: 'queued', contentHash: 'h-shared' });

      const result = await pruneTerminalJobs(adapter.db, 'completed', now - 30_000);
      strictEqual(result.deletedCount, 1);
      strictEqual(result.prunedContents, 1);
      strictEqual((await contentHashes(adapter)).join(','), 'h-shared');
    } finally {
      await adapter.close();
    }
  });
});

// ---------------------------------------------------------------------------
// JobPruneCommand (end-to-end)
// ---------------------------------------------------------------------------

interface IRunCmdOpts {
  cwd: string;
  dryRun?: boolean;
  json?: boolean;
}

async function runPrune(opts: IRunCmdOpts): Promise<{ code: number; stdout: string; stderr: string }> {
  const cmd = new JobPruneCommand();
  cmd.dryRun = opts.dryRun ?? false;
  cmd.json = opts.json ?? false;
  // Seed inherited SmCommand flags so the verb does not see the
  // Clipanion Option descriptor objects when it resolves the DB path
  // through `resolveDbPath({ db, ... })`.
  cmd.db = undefined;
  cmd.quiet = false;
  cmd.noColor = false;
  const cap = captureContext();
  cmd.context = cap.context as never;
  const original = process.cwd();
  process.chdir(opts.cwd);
  try {
    const code = await cmd.execute();
    return { code, stdout: cap.stdout(), stderr: cap.stderr() };
  } finally {
    process.chdir(original);
  }
}

describe('JobPruneCommand', () => {
  it('exits 5 (NotFound) with a clear message when the DB is missing', async () => {
    const scope = freshScope('cmd-no-db');
    // Don't initDb, leave the DB absent (but the scope dir must exist).
    const adapter = await initDb(scope);
    await adapter.close();
    rmSync(join(scope, '.skill-map', 'skill-map.db'), { force: true });

    const result = await runPrune({ cwd: scope });
    strictEqual(result.code, 5);
    ok(result.stderr.includes('not found'));
  });

  it('returns zero counts on an empty DB (default config: completed=30d, failed=null)', async () => {
    const scope = freshScope('cmd-empty');
    const adapter = await initDb(scope);
    await adapter.close();

    const result = await runPrune({ cwd: scope, json: true });
    strictEqual(result.code, 0);
    const out = JSON.parse(result.stdout);
    strictEqual(out.dryRun, false);
    strictEqual(out.retention.completed.deleted, 0);
    strictEqual(out.retention.failed.deleted, 0);
    strictEqual(out.retention.cancelled.deleted, 0);
    strictEqual(out.retention.cancelled.policySeconds, 2592000, 'cancelled default mirrors completed (30d)');
    strictEqual(out.prunedContents, 0);
  });

  it('prunes expired cancelled jobs (default cancelled=30d) and collects their orphaned content', async () => {
    const scope = freshScope('cmd-prune-cancelled');
    const adapter = await initDb(scope);

    const now = Date.now();
    await seedContent(adapter, 'h-cancelled');
    // 30d default = 2_592_000s. Push the cancelled job past that boundary.
    await seedJob(adapter, {
      id: 'd-cancelled',
      status: 'cancelled',
      finishedAt: now - 31 * 86_400_000,
      contentHash: 'h-cancelled',
    });
    await adapter.close();

    const result = await runPrune({ cwd: scope, json: true });
    strictEqual(result.code, 0);
    const out = JSON.parse(result.stdout);
    strictEqual(out.retention.cancelled.deleted, 1);
    strictEqual(out.prunedContents, 1, 'the expired cancelled job orphaned its content, collected');

    const adapter2 = await initDb(scope);
    try {
      const remaining = await adapter2.db.selectFrom('state_jobs').select('id').execute();
      strictEqual(remaining.length, 0, 'the cancelled job was pruned');
      strictEqual((await contentHashes(adapter2)).length, 0, 'its content was collected');
    } finally {
      await adapter2.close();
    }
  });

  it('prunes expired completed jobs and collects their orphaned content', async () => {
    const scope = freshScope('cmd-prune-completed');
    const adapter = await initDb(scope);

    const now = Date.now();
    await seedContent(adapter, 'h-expired');
    await seedContent(adapter, 'h-recent');
    // 30d default = 2_592_000s. Push old completed past that boundary.
    await seedJob(adapter, {
      id: 'd-expired',
      status: 'completed',
      finishedAt: now - 31 * 86_400_000,
      contentHash: 'h-expired',
    });
    await seedJob(adapter, {
      id: 'd-recent',
      status: 'completed',
      finishedAt: now - 1 * 86_400_000,
      contentHash: 'h-recent',
    });
    await adapter.close();

    const result = await runPrune({ cwd: scope, json: true });
    strictEqual(result.code, 0);
    const out = JSON.parse(result.stdout);
    strictEqual(out.retention.completed.deleted, 1);
    strictEqual(out.prunedContents, 1, 'the expired job orphaned its content, collected');

    // DB: only the recent row remains, and only its content survives.
    const adapter2 = await initDb(scope);
    try {
      const remaining = await adapter2.db.selectFrom('state_jobs').select('id').execute();
      strictEqual(remaining.length, 1);
      strictEqual(remaining[0]!.id, 'd-recent');
      strictEqual((await contentHashes(adapter2)).join(','), 'h-recent');
    } finally {
      await adapter2.close();
    }
  });

  it('does NOT prune failed jobs by default (policy null)', async () => {
    const scope = freshScope('cmd-failed-default');
    const adapter = await initDb(scope);
    const now = Date.now();
    await seedJob(adapter, {
      id: 'd-old-failure',
      status: 'failed',
      finishedAt: now - 365 * 86_400_000,
    });
    await adapter.close();

    const result = await runPrune({ cwd: scope, json: true });
    strictEqual(result.code, 0);
    const out = JSON.parse(result.stdout);
    strictEqual(out.retention.failed.policySeconds, null);
    strictEqual(out.retention.failed.deleted, 0);
  });

  it('--dry-run leaves the DB untouched', async () => {
    const scope = freshScope('cmd-dry-run');
    const adapter = await initDb(scope);

    const now = Date.now();
    await seedContent(adapter, 'h-old');
    await seedJob(adapter, {
      id: 'd-old',
      status: 'completed',
      finishedAt: now - 31 * 86_400_000,
      contentHash: 'h-old',
    });
    await adapter.close();

    const result = await runPrune({ cwd: scope, dryRun: true, json: true });
    strictEqual(result.code, 0);
    const out = JSON.parse(result.stdout);
    strictEqual(out.dryRun, true);
    strictEqual(out.retention.completed.deleted, 1, 'reports what WOULD be pruned');
    strictEqual(out.prunedContents, 0, 'dry-run does not compute the content sweep');

    const adapter2 = await initDb(scope);
    try {
      const remaining = await adapter2.db.selectFrom('state_jobs').select('id').execute();
      strictEqual(remaining.length, 1, 'row survives dry-run');
      strictEqual((await contentHashes(adapter2)).join(','), 'h-old', 'content survives dry-run');
    } finally {
      await adapter2.close();
    }
  });

  it('pretty output names the policies and counts', async () => {
    const scope = freshScope('cmd-pretty');
    const adapter = await initDb(scope);
    await adapter.close();
    const result = await runPrune({ cwd: scope });
    strictEqual(result.code, 0);
    // M1 wiring: human commentary routes through `printer.info` ->
    // stderr; stdout is reserved for `--json` payloads.
    ok(result.stderr.includes('completed: policy 30d'));
    ok(result.stderr.includes('failed:'));
    ok(result.stderr.includes('cancelled: policy 30d'));
    ok(result.stderr.includes('policy never'));
    ok(result.stderr.includes('content rows:'));
  });
});
