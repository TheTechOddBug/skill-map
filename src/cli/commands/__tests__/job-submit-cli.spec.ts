/**
 * End-to-end tests for `sm job submit / list / show` against a real
 * project (a scanned DB + a trusted project-local plugin shipping one
 * probabilistic action). Mirrors the `check-include-prob.spec.ts` cwd +
 * trust scaffolding.
 *
 * Coverage:
 *   - submit -n success -> exit 0, queued job + content row persisted.
 *   - submit a deterministic (built-in) action -> exit 2.
 *   - submit --ttl 0 -> exit 2.
 *   - action not found -> exit 5; node not found -> exit 5.
 *   - duplicate resubmit -> exit 3 (existing id reported).
 *   - submit --all -> exit 0, one job per matching non-virtual node only.
 *   - list filters; show detail + exit 5 on a missing id.
 */

import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { strictEqual, ok, match } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import type { BaseContext } from 'clipanion';

import { JobSubmitCommand, JobListCommand, JobShowCommand } from '../job-queue.js';
import { SqliteStorageAdapter } from '../../../kernel/adapters/sqlite/index.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/prob-summarizer', import.meta.url));
const PLUGIN_ID = 'prob-summarizer';
const ACTION_ID = 'prob-summarizer/skill-echo';

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
  opts: { path: string; kind: string; provider: string; virtual?: boolean },
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
      bodyHash: 'b'.repeat(64),
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
      virtual: opts.virtual ? 1 : 0,
      derivedFromJson: null,
    })
    .execute();
}

interface IProject {
  root: string;
  dbPath: string;
}

/**
 * Build a temp project: copy the fixture plugin under `.skill-map/plugins`,
 * init the default project DB, insert the given nodes, trust the plugin,
 * and write a real body file for every non-virtual node so the render can
 * read it off disk.
 */
async function setupProject(
  nodes: { path: string; kind: string; provider: string; virtual?: boolean }[],
): Promise<IProject> {
  counter += 1;
  const root = join(tmpRoot, `proj-${counter}`);
  const dbPath = join(root, '.skill-map', 'skill-map.db');
  mkdirSync(join(root, '.skill-map', 'plugins'), { recursive: true });
  cpSync(FIXTURE, join(root, '.skill-map', 'plugins', PLUGIN_ID), { recursive: true });

  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  try {
    for (const node of nodes) {
      await insertNode(adapter, node);
      if (!node.virtual) {
        const abs = join(root, node.path);
        mkdirSync(join(abs, '..'), { recursive: true });
        writeFileSync(abs, `---\ntitle: t\n---\nBody of ${node.path}\n`);
      }
    }
    await adapter.trust.set(PLUGIN_ID, true);
  } finally {
    await adapter.close();
  }
  return { root, dbPath };
}

interface ISubmitOverrides {
  action: string;
  node?: string;
  all?: boolean;
  runFlag?: boolean;
  force?: boolean;
  ttl?: string;
  priority?: string;
  json?: boolean;
}

function buildSubmit(overrides: ISubmitOverrides): JobSubmitCommand {
  const cmd = new JobSubmitCommand();
  cmd.action = overrides.action;
  cmd.node = overrides.node;
  cmd.all = overrides.all ?? false;
  cmd.runFlag = overrides.runFlag ?? false;
  cmd.force = overrides.force ?? false;
  cmd.ttl = overrides.ttl;
  cmd.priority = overrides.priority;
  cmd.json = overrides.json ?? false;
  cmd.db = undefined;
  return cmd;
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

async function countJobs(dbPath: string): Promise<number> {
  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  try {
    const jobs = await adapter.jobs.list({});
    return jobs.length;
  } finally {
    await adapter.close();
  }
}

const SKILL = { path: '.claude/skills/foo/SKILL.md', kind: 'skill', provider: 'claude' };

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-job-cli-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('sm job submit -n', () => {
  it('enqueues a probabilistic action -> exit 0, job + content persisted', async () => {
    const proj = await setupProject([SKILL]);
    const code = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const cmd = buildSubmit({ action: ACTION_ID, node: SKILL.path });
      const c = await run(cmd, cap);
      match(cap.stdout(), /^d-\d{8}-\d{6}-[0-9a-f]{4}\n$/);
      return c;
    });
    strictEqual(code, 0);

    const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
    await adapter.init();
    try {
      const jobs = await adapter.jobs.list({});
      strictEqual(jobs.length, 1);
      const job = jobs[0];
      ok(job);
      strictEqual(job.status, 'queued');
      strictEqual(job.actionId, ACTION_ID);
      strictEqual(job.nodeId, SKILL.path);
      const content = await adapter.db
        .selectFrom('state_job_contents')
        .selectAll()
        .where('contentHash', '=', job.contentHash)
        .executeTakeFirst();
      ok(content, 'content row persisted');
      ok(content.content.startsWith('You are operating inside skill-map'));
      ok(content.content.includes(`<user-content id="${SKILL.path}">`));
    } finally {
      await adapter.close();
    }
  });

  it('refuses a deterministic (built-in) action with exit 2', async () => {
    const proj = await setupProject([SKILL]);
    const code = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const cmd = buildSubmit({ action: 'core/node-set-tags', node: SKILL.path });
      const c = await run(cmd, cap);
      match(cap.stderr(), /only probabilistic actions are queued/);
      return c;
    });
    strictEqual(code, 2);
    strictEqual(await countJobs(proj.dbPath), 0);
  });

  it('rejects --ttl 0 with exit 2', async () => {
    const proj = await setupProject([SKILL]);
    const code = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const cmd = buildSubmit({ action: ACTION_ID, node: SKILL.path, ttl: '0' });
      return run(cmd, cap);
    });
    strictEqual(code, 2);
    strictEqual(await countJobs(proj.dbPath), 0);
  });

  it('exits 5 when the action is not found', async () => {
    const proj = await setupProject([SKILL]);
    const code = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const cmd = buildSubmit({ action: 'no/such-action', node: SKILL.path });
      const c = await run(cmd, cap);
      match(cap.stderr(), /not found/);
      return c;
    });
    strictEqual(code, 5);
  });

  it('exits 5 when the node is not in the scan', async () => {
    const proj = await setupProject([SKILL]);
    const code = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const cmd = buildSubmit({ action: ACTION_ID, node: '.claude/skills/missing/SKILL.md' });
      return run(cmd, cap);
    });
    strictEqual(code, 5);
  });

  it('refuses an active duplicate with exit 3 and prints the existing id', async () => {
    const proj = await setupProject([SKILL]);
    const first = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const cmd = buildSubmit({ action: ACTION_ID, node: SKILL.path });
      return { code: await run(cmd, cap), id: cap.stdout().trim() };
    });
    strictEqual(first.code, 0);

    const second = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const cmd = buildSubmit({ action: ACTION_ID, node: SKILL.path });
      const c = await run(cmd, cap);
      ok(cap.stderr().includes(first.id), 'reports the existing job id');
      return c;
    });
    strictEqual(second, 3);
    strictEqual(await countJobs(proj.dbPath), 1, 'no second job created');
  });
});

describe('sm job submit --all', () => {
  it('fans out to matching non-virtual nodes only', async () => {
    const proj = await setupProject([
      SKILL,
      { path: '.claude/agents/bar.md', kind: 'agent', provider: 'claude' },
      { path: '.claude/skills/virt/SKILL.md', kind: 'skill', provider: 'claude', virtual: true },
    ]);
    const code = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const cmd = buildSubmit({ action: ACTION_ID, all: true });
      return run(cmd, cap);
    });
    strictEqual(code, 0);

    const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
    await adapter.init();
    try {
      const jobs = await adapter.jobs.list({});
      strictEqual(jobs.length, 1, 'only the non-virtual claude/skill node matched');
      const job = jobs[0];
      ok(job);
      strictEqual(job.nodeId, SKILL.path);
    } finally {
      await adapter.close();
    }
  });
});

describe('sm job list / show', () => {
  it('lists jobs (JSON) and shows detail; missing id exits 5', async () => {
    const proj = await setupProject([SKILL]);
    const submitted = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const cmd = buildSubmit({ action: ACTION_ID, node: SKILL.path });
      await run(cmd, cap);
      return cap.stdout().trim();
    });

    // list --json
    const listCode = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const cmd = new JobListCommand();
      cmd.json = true;
      cmd.status = undefined;
      cmd.action = undefined;
      cmd.node = undefined;
      cmd.db = undefined;
      const c = await run(cmd, cap);
      const parsed = JSON.parse(cap.stdout());
      strictEqual(parsed.length, 1);
      strictEqual(parsed[0].id, submitted);
      return c;
    });
    strictEqual(listCode, 0);

    // list filter that matches nothing
    await withCwd(proj.root, async () => {
      const cap = captureContext();
      const cmd = new JobListCommand();
      cmd.json = true;
      cmd.status = 'running';
      cmd.action = undefined;
      cmd.node = undefined;
      cmd.db = undefined;
      await run(cmd, cap);
      strictEqual(JSON.parse(cap.stdout()).length, 0);
    });

    // show <id> --json
    const showCode = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const cmd = new JobShowCommand();
      cmd.id = submitted;
      cmd.json = true;
      cmd.db = undefined;
      const c = await run(cmd, cap);
      const job = JSON.parse(cap.stdout());
      strictEqual(job.id, submitted);
      strictEqual(job.status, 'queued');
      return c;
    });
    strictEqual(showCode, 0);

    // show missing -> exit 5
    const missingCode = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const cmd = new JobShowCommand();
      cmd.id = 'd-20990101-000000-ffff';
      cmd.json = false;
      cmd.db = undefined;
      return run(cmd, cap);
    });
    strictEqual(missingCode, 5);
  });
});
