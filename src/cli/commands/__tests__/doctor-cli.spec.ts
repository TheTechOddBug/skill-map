/**
 * `sm doctor` CLI characterisation (`spec/cli-contract.md` §sm doctor).
 *
 * Coverage:
 *   - fresh healthy project -> every check ok, exit 0, --json envelope.
 *   - orphaned `state_job_contents` row (GC straggler) -> warn, exit 1.
 *   - `state_jobs` row missing its content row (corruption) -> error, exit 2.
 *   - provider marker on disk with zero matched nodes -> warn row.
 *   - jobs-overdue: running job past its extension's advisory estimate
 *     warns naming `sm jobs fail` / `sm jobs cancel`; a fresh claim stays
 *     ok; an unresolvable extension is skipped; never mutates state.
 */

import { strictEqual, ok } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import type { BaseContext } from 'clipanion';

import { SqliteStorageAdapter } from '../../../kernel/adapters/sqlite/index.js';
import { sha256 } from '../../../kernel/orchestrator/node-build.js';
import { DoctorCommand } from '../doctor.js';

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

async function run(
  cmd: { context: BaseContext; execute(): Promise<number> },
  cap: ICaptured,
): Promise<number> {
  cmd.context = cap.context;
  return cmd.execute();
}

async function withCwd<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const prev = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(prev);
  }
}

interface IProject {
  root: string;
  dbPath: string;
}

/** Init a fresh project DB under a temp root (schema fully migrated). */
async function setupProject(): Promise<IProject> {
  counter += 1;
  const root = join(tmpRoot, `proj-${counter}`);
  const dbPath = join(root, '.skill-map', 'skill-map.db');
  mkdirSync(join(root, '.skill-map'), { recursive: true });
  // core/ai-summarizer-action ships experimental (disabled by default); the
  // jobs-overdue check resolves its advisory estimate, so opt it back in.
  writeFileSync(
    join(root, '.skill-map', 'settings.json'),
    JSON.stringify({ plugins: { core: { extensions: { 'ai-summarizer-action': { enabled: true } } } } }),
  );
  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  await adapter.close();
  return { root, dbPath };
}

function buildDoctor(): DoctorCommand {
  const cmd = new DoctorCommand();
  cmd.json = false;
  cmd.db = undefined;
  return cmd;
}

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'sm-doctor-cli-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('sm doctor', () => {
  it('healthy fresh project: every check ok, exit 0, --json envelope', async () => {
    const proj = await setupProject();
    const code = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const cmd = buildDoctor();
      cmd.json = true;
      const c = await run(cmd, cap);
      const doc = JSON.parse(cap.stdout()) as {
        ok: boolean;
        kind: string;
        checks: Array<{ id: string; status: string; message: string }>;
      };
      strictEqual(doc.ok, true);
      strictEqual(doc.kind, 'doctor');
      strictEqual(doc.checks.length, 9, 'includes the trust-scope check');
      ok(doc.checks.every((c2) => c2.status === 'ok'), 'all checks ok');
      return c;
    });
    strictEqual(code, 0);
  });

  it('human mode renders one glyph row per check plus the summary', async () => {
    const proj = await setupProject();
    await withCwd(proj.root, async () => {
      const cap = captureContext();
      const code = await run(buildDoctor(), cap);
      strictEqual(code, 0);
      const out = cap.stdout();
      ok(out.includes('db integrity'), 'db label');
      ok(out.includes('plugins'), 'plugins label');
      ok(out.includes('All checks green.'), 'summary line');
    });
  });

  it('GC straggler content row -> job gc warns, exit 1', async () => {
    const proj = await setupProject();
    const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
    await adapter.init();
    try {
      await adapter.db
        .insertInto('state_job_contents')
        .values({ contentHash: 'a'.repeat(64), content: 'orphaned', createdAt: Date.now() })
        .execute();
    } finally {
      await adapter.close();
    }

    const code = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const cmd = buildDoctor();
      cmd.json = true;
      const c = await run(cmd, cap);
      const doc = JSON.parse(cap.stdout()) as {
        ok: boolean;
        checks: Array<{ id: string; status: string }>;
      };
      strictEqual(doc.ok, false);
      strictEqual(doc.checks.find((c2) => c2.id === 'job-gc')?.status, 'warn');
      return c;
    });
    strictEqual(code, 1);
  });

  it('job with a missing content row -> corruption error, exit 2', async () => {
    const proj = await setupProject();
    const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
    await adapter.init();
    try {
      await adapter.jobs.submit(
        {
          id: 'd-20990101-000000-aaaa',
          extensionId: 'core/ai-summarizer-action',
          extensionVersion: '0.0.0',
          extensionKind: 'action',
          nodeId: 'notes.md',
          contentHash: sha256('content'),
          nonce: 'f'.repeat(32),
          priority: 0,
          status: 'queued',
          ttlSeconds: 60,
          createdAt: Date.now(),
        },
        { contentHash: sha256('content'), content: 'content', createdAt: Date.now() },
      );
      await adapter.db.deleteFrom('state_job_contents').execute();
    } finally {
      await adapter.close();
    }

    const code = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const cmd = buildDoctor();
      cmd.json = true;
      const c = await run(cmd, cap);
      const doc = JSON.parse(cap.stdout()) as {
        checks: Array<{ id: string; status: string }>;
      };
      strictEqual(doc.checks.find((c2) => c2.id === 'job-contents')?.status, 'error');
      return c;
    });
    strictEqual(code, 2);
  });

  it('provider marker on disk with zero matched nodes -> warn row, exit 1', async () => {
    const proj = await setupProject();
    // A `.claude/` marker with no claude-classified nodes; the scan holds
    // one markdown-provider node so the "no scan yet" skip does not fire.
    mkdirSync(join(proj.root, '.claude'), { recursive: true });
    writeFileSync(join(proj.root, 'notes.md'), '# notes\n');
    const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
    await adapter.init();
    try {
      await adapter.db
        .insertInto('scan_nodes')
        .values({
          path: 'notes.md',
          kind: 'markdown',
          provider: 'markdown',
          title: null,
          description: null,
          stability: null,
          version: null,
          sidecarStatus: null,
          annotationsJson: null,
          sidecarRootJson: null,
          frontmatterJson: '{}',
          bodyHash: sha256('# notes\n'),
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
    } finally {
      await adapter.close();
    }

    const code = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const cmd = buildDoctor();
      cmd.json = true;
      const c = await run(cmd, cap);
      const doc = JSON.parse(cap.stdout()) as {
        checks: Array<{ id: string; status: string; message: string }>;
      };
      const providerWarns = doc.checks.filter(
        (c2) => c2.id === 'providers' && c2.status === 'warn',
      );
      ok(
        providerWarns.some((c2) => c2.message.includes('claude')),
        'claude marker warning surfaced',
      );
      return c;
    });
    strictEqual(code, 1);
  });
});


describe('sm doctor, jobs-overdue', () => {
  /**
   * Seed one job for `extension` and force it into `running` with the
   * given claim timestamp (direct row update; the check reads rows, so
   * the claim mechanics are irrelevant here).
   */
  async function seedRunning(
    proj: IProject,
    opts: { extensionId: string; extensionKind: 'action' | 'analyzer'; claimedAt: number },
  ): Promise<string> {
    const id = 'd-20260101-000000-0001';
    const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
    await adapter.init();
    try {
      await adapter.jobs.submit(
        {
          id,
          extensionId: opts.extensionId,
          extensionVersion: '0.0.0',
          extensionKind: opts.extensionKind,
          nodeId: 'notes.md',
          contentHash: sha256('overdue'),
          nonce: 'f'.repeat(32),
          priority: 0,
          status: 'queued',
          ttlSeconds: null,
          createdAt: opts.claimedAt,
        },
        { contentHash: sha256('overdue'), content: 'overdue', createdAt: opts.claimedAt },
      );
      await adapter.db
        .updateTable('state_jobs')
        .set({ status: 'running', runner: 'agent', claimedAt: opts.claimedAt })
        .where('id', '=', id)
        .execute();
    } finally {
      await adapter.close();
    }
    return id;
  }

  async function doctorChecks(
    proj: IProject,
  ): Promise<{ code: number; checks: Array<{ id: string; status: string; message: string }> }> {
    return withCwd(proj.root, async () => {
      const cap = captureContext();
      const cmd = buildDoctor();
      cmd.json = true;
      const code = await run(cmd, cap);
      const doc = JSON.parse(cap.stdout()) as {
        checks: Array<{ id: string; status: string; message: string }>;
      };
      return { code, checks: doc.checks };
    });
  }

  it('warns per running job past the advisory estimate, naming the resolving verbs', async () => {
    const proj = await setupProject();
    // core/ai-summarizer-action advises 120s; claimed 10 minutes ago.
    const id = await seedRunning(proj, {
      extensionId: 'core/ai-summarizer-action',
      extensionKind: 'action',
      claimedAt: Date.now() - 10 * 60 * 1000,
    });

    const { code, checks } = await doctorChecks(proj);
    strictEqual(code, 1, 'advisory warn, exit 1');
    const row = checks.find((c) => c.id === 'jobs-overdue');
    ok(row);
    strictEqual(row.status, 'warn');
    ok(row.message.includes(id), 'message names the job id');
    ok(row.message.includes(`sm jobs fail ${id}`), 'names sm jobs fail');
    ok(row.message.includes(`sm jobs cancel ${id}`), 'names sm jobs cancel');

    // Advisory only: the job is untouched.
    const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
    await adapter.init();
    try {
      strictEqual((await adapter.jobs.get(id))!.status, 'running', 'never mutates state');
    } finally {
      await adapter.close();
    }
  });

  it('a fresh claim inside the estimate stays ok', async () => {
    const proj = await setupProject();
    await seedRunning(proj, {
      extensionId: 'core/ai-summarizer-action',
      extensionKind: 'action',
      claimedAt: Date.now(),
    });

    const { checks } = await doctorChecks(proj);
    strictEqual(checks.find((c) => c.id === 'jobs-overdue')?.status, 'ok');
  });

  it('a job whose extension is no longer loadable is skipped (ok row)', async () => {
    const proj = await setupProject();
    await seedRunning(proj, {
      extensionId: 'gone-plugin/gone-finder',
      extensionKind: 'analyzer',
      claimedAt: Date.now() - 10 * 60 * 1000,
    });

    const { code, checks } = await doctorChecks(proj);
    strictEqual(checks.find((c) => c.id === 'jobs-overdue')?.status, 'ok');
    strictEqual(code, 0);
  });
});
