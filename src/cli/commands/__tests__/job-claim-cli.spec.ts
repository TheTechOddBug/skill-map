/**
 * End-to-end tests for `sm jobs claim / status / cancel / fail` (Step 10
 * Phase C) against a real project DB. Unlike `sm jobs submit`, these verbs
 * never touch the plugin runtime, they only read / write `state_jobs`
 * through the storage port, so the harness seeds queued jobs directly via
 * `adapter.jobs.submit` (no fixture plugin, no scan).
 *
 * Coverage:
 *   - claim: prints the highest-priority id (plain), returns
 *     { id, nonce, content } (--json), exits 1 on an empty queue,
 *     scopes by --filter, and silently reaps expired running jobs to
 *     failed / abandoned before claiming (job-lifecycle §Reap).
 *   - status: counts (plain + --json), single-job line, missing id -> 5.
 *   - cancel: queued -> exit 0 (terminal `cancelled` state, no reason),
 *     terminal -> 2, missing -> 5, --all count, and the neither / both
 *     usage errors -> 2.
 *   - fail: queued -> exit 0 (failed / user-failed), terminal -> 2,
 *     missing -> 5, --all count, and the neither / both usage errors -> 2.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strictEqual, ok, match } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import type { BaseContext } from 'clipanion';

import { JobClaimCommand, JobStatusCommand, JobCancelCommand, JobFailCommand } from '../job-queue.js';
import { SqliteStorageAdapter } from '../../../kernel/adapters/sqlite/index.js';
import type { IJobSubmitRow } from '../../../kernel/types/storage.js';

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

interface ISeedJob {
  id: string;
  extensionId?: string;
  nodeId: string;
  contentHash: string;
  priority?: number;
  createdAt?: number;
}

/** Fresh project dir with a migrated DB seeded with the given queued jobs. */
async function setupProject(jobs: ISeedJob[]): Promise<{ root: string; dbPath: string }> {
  counter += 1;
  const root = join(tmpRoot, `proj-${counter}`);
  const dbPath = join(root, '.skill-map', 'skill-map.db');
  mkdirSync(join(root, '.skill-map'), { recursive: true });

  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  try {
    for (const j of jobs) {
      const row: IJobSubmitRow = {
        id: j.id,
        extensionId: j.extensionId ?? 'core/skill-summarizer',
        extensionVersion: '1.0.0',
        extensionKind: 'action',
        nodeId: j.nodeId,
        contentHash: j.contentHash,
        nonce: `nonce-${j.id}`,
        priority: j.priority ?? 0,
        status: 'queued',
        ttlSeconds: 3600,
        createdAt: j.createdAt ?? Date.now(),
      };
      await adapter.jobs.submit(row, {
        contentHash: row.contentHash,
        content: `RENDERED ${j.id}`,
        createdAt: row.createdAt,
      });
    }
  } finally {
    await adapter.close();
  }
  return { root, dbPath };
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

function buildClaim(overrides: { filter?: string; json?: boolean } = {}): JobClaimCommand {
  const cmd = new JobClaimCommand();
  cmd.filter = overrides.filter;
  cmd.json = overrides.json ?? false;
  cmd.db = undefined;
  return cmd;
}

function buildStatus(overrides: { id?: string; json?: boolean } = {}): JobStatusCommand {
  const cmd = new JobStatusCommand();
  cmd.id = overrides.id;
  cmd.json = overrides.json ?? false;
  cmd.db = undefined;
  return cmd;
}

function buildCancel(overrides: { id?: string; all?: boolean; json?: boolean } = {}): JobCancelCommand {
  const cmd = new JobCancelCommand();
  cmd.id = overrides.id;
  cmd.all = overrides.all ?? false;
  cmd.json = overrides.json ?? false;
  cmd.db = undefined;
  return cmd;
}

function buildFail(overrides: { id?: string; all?: boolean; json?: boolean } = {}): JobFailCommand {
  const cmd = new JobFailCommand();
  cmd.id = overrides.id;
  cmd.all = overrides.all ?? false;
  cmd.json = overrides.json ?? false;
  cmd.db = undefined;
  return cmd;
}

async function openDb(dbPath: string): Promise<SqliteStorageAdapter> {
  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  return adapter;
}

const A = { id: 'd-20260101-000000-0001', nodeId: 'a.md', contentHash: '1'.repeat(64) };
const B = { id: 'd-20260101-000000-0002', nodeId: 'b.md', contentHash: '2'.repeat(64) };

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-job-claim-cli-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('sm jobs claim', () => {
  it('prints the highest-priority queued id and marks it running', async () => {
    const proj = await setupProject([
      { ...A, priority: 0, createdAt: 1_700_000_000_000 },
      { ...B, priority: 5, createdAt: 1_700_000_000_010 },
    ]);
    const code = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const c = await run(buildClaim(), cap);
      strictEqual(cap.stdout(), `${B.id}\n`, 'the priority-5 job wins');
      return c;
    });
    strictEqual(code, 0);

    const adapter = await openDb(proj.dbPath);
    try {
      const job = await adapter.jobs.get(B.id);
      ok(job);
      strictEqual(job.status, 'running');
      strictEqual(job.runner, 'agent');
    } finally {
      await adapter.close();
    }
  });

  it('returns { id, nonce, content } in --json mode', async () => {
    const proj = await setupProject([A]);
    const code = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const c = await run(buildClaim({ json: true }), cap);
      const parsed = JSON.parse(cap.stdout());
      strictEqual(parsed.id, A.id);
      strictEqual(parsed.nonce, `nonce-${A.id}`);
      ok(typeof parsed.content === 'string' && parsed.content.includes(A.id), 'content is the rendered blob');
      return c;
    });
    strictEqual(code, 0);
  });

  it('exits 1 with no stdout on an empty queue', async () => {
    const proj = await setupProject([]);
    const code = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const c = await run(buildClaim(), cap);
      strictEqual(cap.stdout(), '');
      return c;
    });
    strictEqual(code, 1);
  });

  it('scopes the claim to --filter <action>', async () => {
    const proj = await setupProject([
      { ...A, extensionId: 'core/skill-summarizer' },
      { ...B, extensionId: 'core/other-action' },
    ]);
    const claimed = await withCwd(proj.root, async () => {
      const cap = captureContext();
      await run(buildClaim({ filter: 'core/other-action' }), cap);
      return cap.stdout().trim();
    });
    strictEqual(claimed, B.id, 'only the matching action id was claimed');
  });

  it('silently reaps expired running jobs to failed / abandoned before claiming', async () => {
    const proj = await setupProject([
      { ...A, createdAt: 1_700_000_000_000 },
      { ...B, createdAt: 1_700_000_000_010 },
    ]);
    // Claim A (oldest) and force its TTL into the past: an abandoned agent.
    const seed = await openDb(proj.dbPath);
    try {
      const claim = await seed.jobs.claim('agent', Date.now());
      ok(claim);
      strictEqual(claim.id, A.id);
      await seed.db
        .updateTable('state_jobs')
        .set({ expiresAt: Date.now() - 1_000 })
        .where('id', '=', A.id)
        .execute();
    } finally {
      await seed.close();
    }

    const code = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const c = await run(buildClaim(), cap);
      // The reap is silent: stdout carries ONLY the new claim.
      strictEqual(cap.stdout(), `${B.id}\n`);
      strictEqual(cap.stderr(), '');
      return c;
    });
    strictEqual(code, 0);

    const adapter = await openDb(proj.dbPath);
    try {
      const reaped = await adapter.jobs.get(A.id);
      ok(reaped);
      strictEqual(reaped.status, 'failed');
      strictEqual(reaped.failureReason, 'abandoned');
    } finally {
      await adapter.close();
    }
  });

  it('accepts a bare action id in --filter (matches the qualified id by suffix)', async () => {
    const proj = await setupProject([
      { ...A, extensionId: 'core/skill-summarizer' },
      { ...B, extensionId: 'core/other-action' },
    ]);
    const claimed = await withCwd(proj.root, async () => {
      const cap = captureContext();
      await run(buildClaim({ filter: 'other-action' }), cap);
      return cap.stdout().trim();
    });
    strictEqual(claimed, B.id, 'bare id claimed the qualified-id job');
  });

  it('marks a claimed job with a missing content row failed / job-file-missing and exits 2', async () => {
    // Seed a queued job, then delete its content row out-of-band (the
    // DB-corruption-only state, spec §Atomicity edge cases).
    const proj = await setupProject([A]);
    const seed = await openDb(proj.dbPath);
    try {
      await seed.db
        .deleteFrom('state_job_contents')
        .where('contentHash', '=', A.contentHash)
        .execute();
    } finally {
      await seed.close();
    }

    const code = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const c = await run(buildClaim(), cap);
      strictEqual(cap.stdout(), '', 'the claim is never handed out');
      match(cap.stderr(), /no stored content/);
      return c;
    });
    strictEqual(code, 2, 'never exit 0 with a null content');

    const adapter = await openDb(proj.dbPath);
    try {
      const job = await adapter.jobs.get(A.id);
      ok(job);
      strictEqual(job.status, 'failed');
      strictEqual(job.failureReason, 'job-file-missing');
      const execs = await adapter.history.list({});
      strictEqual(execs.length, 1, 'the corruption is documented in an execution row');
      strictEqual(execs[0]!.jobId, A.id);
      strictEqual(execs[0]!.failureReason, 'job-file-missing');
    } finally {
      await adapter.close();
    }
  });

  it('missing content row in --json mode also exits 2 with no stdout envelope', async () => {
    const proj = await setupProject([A]);
    const seed = await openDb(proj.dbPath);
    try {
      await seed.db
        .deleteFrom('state_job_contents')
        .where('contentHash', '=', A.contentHash)
        .execute();
    } finally {
      await seed.close();
    }

    const code = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const c = await run(buildClaim({ json: true }), cap);
      strictEqual(cap.stdout(), '', 'no {id, nonce, content: null} envelope');
      match(cap.stderr(), /job-file-missing/);
      return c;
    });
    strictEqual(code, 2);
  });
});

describe('sm jobs status', () => {
  it('reports counts (plain + --json)', async () => {
    const proj = await setupProject([A, B]);
    // Claim one so a running row exists.
    await withCwd(proj.root, async () => run(buildClaim(), captureContext()));

    await withCwd(proj.root, async () => {
      const cap = captureContext();
      const c = await run(buildStatus({ json: true }), cap);
      strictEqual(c, 0);
      const counts = JSON.parse(cap.stdout());
      strictEqual(counts.queued, 1);
      strictEqual(counts.running, 1);
      strictEqual(counts.completed, 0);
      strictEqual(counts.failed, 0);
    });

    await withCwd(proj.root, async () => {
      const cap = captureContext();
      await run(buildStatus(), cap);
      match(cap.stdout(), /queued\s+1/);
      match(cap.stdout(), /running\s+1/);
    });
  });

  it('reports a single job status and exits 5 for a missing id', async () => {
    const proj = await setupProject([A]);
    await withCwd(proj.root, async () => {
      const cap = captureContext();
      const c = await run(buildStatus({ id: A.id, json: true }), cap);
      strictEqual(c, 0);
      const parsed = JSON.parse(cap.stdout());
      strictEqual(parsed.id, A.id);
      strictEqual(parsed.status, 'queued');
    });

    const missing = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const c = await run(buildStatus({ id: 'd-20990101-000000-ffff' }), cap);
      match(cap.stderr(), /not found/);
      return c;
    });
    strictEqual(missing, 5);
  });
});

describe('sm jobs cancel', () => {
  it('cancels a queued job -> exit 0, terminal cancelled state (no reason)', async () => {
    const proj = await setupProject([A]);
    const code = await withCwd(proj.root, async () => run(buildCancel({ id: A.id }), captureContext()));
    strictEqual(code, 0);

    const adapter = await openDb(proj.dbPath);
    try {
      const job = await adapter.jobs.get(A.id);
      ok(job);
      strictEqual(job.status, 'cancelled');
      strictEqual(job.failureReason ?? null, null);
    } finally {
      await adapter.close();
    }
  });

  it('refuses a terminal job with exit 2 and a missing id with exit 5', async () => {
    const proj = await setupProject([A]);
    // Drive A to terminal out-of-band.
    const adapter = await openDb(proj.dbPath);
    try {
      await adapter.db
        .updateTable('state_jobs')
        .set({ status: 'completed', finishedAt: Date.now() })
        .where('id', '=', A.id)
        .execute();
    } finally {
      await adapter.close();
    }

    const terminal = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const c = await run(buildCancel({ id: A.id }), cap);
      match(cap.stderr(), /already terminal/);
      return c;
    });
    strictEqual(terminal, 2);

    const missing = await withCwd(proj.root, async () =>
      run(buildCancel({ id: 'd-20990101-000000-ffff' }), captureContext()),
    );
    strictEqual(missing, 5);
  });

  it('--all cancels every active job and reports the count', async () => {
    const proj = await setupProject([A, B]);
    const code = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const c = await run(buildCancel({ all: true, json: true }), cap);
      strictEqual(JSON.parse(cap.stdout()).cancelled, 2);
      return c;
    });
    strictEqual(code, 0);

    const adapter = await openDb(proj.dbPath);
    try {
      const counts = await adapter.jobs.countByStatus();
      strictEqual(counts.cancelled, 2);
      strictEqual(counts.failed, 0);
      strictEqual(counts.queued, 0);
    } finally {
      await adapter.close();
    }
  });

  it('rejects neither-target and both-target invocations with exit 2', async () => {
    const proj = await setupProject([A]);
    const neither = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const c = await run(buildCancel(), cap);
      match(cap.stderr(), /<job.id> or --all/);
      return c;
    });
    strictEqual(neither, 2);

    const both = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const c = await run(buildCancel({ id: A.id, all: true }), cap);
      match(cap.stderr(), /not both/);
      return c;
    });
    strictEqual(both, 2);
  });
});

describe('sm jobs fail', () => {
  it('fails a queued job -> exit 0, failed / user-failed', async () => {
    const proj = await setupProject([A]);
    const code = await withCwd(proj.root, async () => run(buildFail({ id: A.id }), captureContext()));
    strictEqual(code, 0);

    const adapter = await openDb(proj.dbPath);
    try {
      const job = await adapter.jobs.get(A.id);
      ok(job);
      strictEqual(job.status, 'failed');
      strictEqual(job.failureReason, 'user-failed');
    } finally {
      await adapter.close();
    }
  });

  it('refuses a terminal job with exit 2 and a missing id with exit 5', async () => {
    const proj = await setupProject([A]);
    // Drive A to terminal (cancelled) out-of-band.
    const adapter = await openDb(proj.dbPath);
    try {
      await adapter.db
        .updateTable('state_jobs')
        .set({ status: 'cancelled', finishedAt: Date.now() })
        .where('id', '=', A.id)
        .execute();
    } finally {
      await adapter.close();
    }

    const terminal = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const c = await run(buildFail({ id: A.id }), cap);
      match(cap.stderr(), /already terminal/);
      return c;
    });
    strictEqual(terminal, 2);

    const missing = await withCwd(proj.root, async () =>
      run(buildFail({ id: 'd-20990101-000000-ffff' }), captureContext()),
    );
    strictEqual(missing, 5);
  });

  it('--all fails every active job and reports the count', async () => {
    const proj = await setupProject([A, B]);
    const code = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const c = await run(buildFail({ all: true, json: true }), cap);
      strictEqual(JSON.parse(cap.stdout()).failed, 2);
      return c;
    });
    strictEqual(code, 0);

    const adapter = await openDb(proj.dbPath);
    try {
      const counts = await adapter.jobs.countByStatus();
      strictEqual(counts.failed, 2);
      strictEqual(counts.cancelled, 0);
      strictEqual(counts.queued, 0);
    } finally {
      await adapter.close();
    }
  });

  it('rejects neither-target and both-target invocations with exit 2', async () => {
    const proj = await setupProject([A]);
    const neither = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const c = await run(buildFail(), cap);
      match(cap.stderr(), /<job.id> or --all/);
      return c;
    });
    strictEqual(neither, 2);

    const both = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const c = await run(buildFail({ id: A.id, all: true }), cap);
      match(cap.stderr(), /not both/);
      return c;
    });
    strictEqual(both, 2);
  });
});
