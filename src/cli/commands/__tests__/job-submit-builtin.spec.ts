/**
 * Integration tests for `sm job submit` against the FIRST probabilistic
 * BUILT-IN Action, `core/markdown-summarizer`. Mirrors
 * `job-submit-cli.spec.ts` but exercises the built-in path: no on-disk
 * plugin, no trust row, no source directory. The prompt template comes from
 * the manifest field the built-ins codegen inlined from the action's sibling
 * `prompt.md`, and submit falls back to it when `dirByAction` has no entry.
 *
 * Coverage:
 *   - submit -n against a `markdown` node -> exit 0, queued job + content
 *     row persisted with the canonical preamble + `<user-content>` block.
 *   - submit --all -> fans out to every non-virtual node (the summarizer
 *     is universal, no precondition; virtual nodes stay excluded).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strictEqual, ok, match } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import type { BaseContext } from 'clipanion';

import { JobSubmitCommand } from '../job-queue.js';
import { SqliteStorageAdapter } from '../../../kernel/adapters/sqlite/index.js';
import { sha256 } from '../../../kernel/orchestrator/node-build.js';
import { loadCanonicalPreamble } from '../../../kernel/jobs/index.js';

const ACTION_ID = 'core/markdown-summarizer';

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
 * Build a temp project: init the default project DB, insert the given nodes,
 * and write a real body file for every non-virtual node so the render can
 * read it off disk. No plugin copy / trust row: the action is a built-in.
 */
async function setupProject(
  nodes: { path: string; kind: string; provider: string; virtual?: boolean }[],
): Promise<IProject> {
  counter += 1;
  const root = join(tmpRoot, `proj-${counter}`);
  const dbPath = join(root, '.skill-map', 'skill-map.db');
  mkdirSync(join(root, '.skill-map'), { recursive: true });

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
  } finally {
    await adapter.close();
  }
  return { root, dbPath };
}

interface ISubmitOverrides {
  action: string;
  node?: string;
  all?: boolean;
  json?: boolean;
}

function buildSubmit(overrides: ISubmitOverrides): JobSubmitCommand {
  const cmd = new JobSubmitCommand();
  cmd.extension = overrides.action;
  cmd.node = overrides.node;
  cmd.all = overrides.all ?? false;
  cmd.force = false;
  cmd.ttl = undefined;
  cmd.priority = undefined;
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

const NOTE = { path: 'notes/guide.md', kind: 'markdown', provider: 'markdown' };

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-job-builtin-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('sm job submit (built-in probabilistic action)', () => {
  it('enqueues core/markdown-summarizer -n -> exit 0, job + rendered content persisted', async () => {
    const proj = await setupProject([NOTE]);
    const code = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const cmd = buildSubmit({ action: ACTION_ID, node: NOTE.path });
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
      strictEqual(job.extensionId, ACTION_ID);
      strictEqual(job.nodeId, NOTE.path);
      const content = await adapter.db
        .selectFrom('state_job_contents')
        .selectAll()
        .where('contentHash', '=', job.contentHash)
        .executeTakeFirst();
      ok(content, 'content row persisted');
      // The canonical preamble lands verbatim (built-in prompt.md was inlined
      // by the codegen, so submit resolves the template from the manifest).
      ok(content.content.includes(loadCanonicalPreamble()), 'preamble present verbatim');
      ok(content.content.includes(`<user-content id="${NOTE.path}">`), 'user-content block present');
    } finally {
      await adapter.close();
    }
  });

  it('--all fans out to every non-virtual node regardless of kind (universal summarizer)', async () => {
    const AGENT = { path: '.claude/agents/bar.md', kind: 'agent', provider: 'claude' };
    const proj = await setupProject([
      NOTE,
      AGENT,
      { path: 'notes/virtual.md', kind: 'markdown', provider: 'markdown', virtual: true },
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
      strictEqual(jobs.length, 2, 'both non-virtual nodes matched; the virtual node stays excluded');
      const nodeIds = jobs.map((j) => j.nodeId).sort();
      strictEqual(nodeIds[0], AGENT.path);
      strictEqual(nodeIds[1], NOTE.path);
    } finally {
      await adapter.close();
    }
  });
});
