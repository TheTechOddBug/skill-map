/**
 * `sm jobs submit` FIXER supersede (`spec/job-lifecycle.md` §Findings
 * injection for fixers · Supersede). A fixer submit that finds a stale queued
 * sibling for the same `(fixer, node)` pair, one whose finding set changed
 * since it was queued (a DIFFERENT rendered content hash), CANCELS it and
 * enqueues the newer job in ONE transaction, instead of both piling up and
 * wasting an agent pass on findings already resolved. Exercised through the
 * real CLI verbs against `core/node-consolidate` (the first fixer, findings
 * from `core/node-redundancy`).
 *
 * Coverage:
 *   - happy path: a changed finding set cancels the stale queued sibling
 *     (status `cancelled`, no failureReason, finishedAt stamped) and enqueues
 *     the new job; the superseded id rides a human-mode stderr advisory.
 *   - an IDENTICAL resubmit (same content hash) keeps the plain exit-3
 *     duplicate refusal; nothing is superseded.
 *   - a RUNNING job for the pair is NEVER superseded: the submit refuses with
 *     exit 3 naming it, and the running job is left untouched.
 *   - `--all` applies the rule per node independently.
 *   - `--json` stays the plain new Job on stdout (no supersede field, no
 *     advisory); the supersession still happens.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strictEqual, ok, match, doesNotMatch } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import type { BaseContext } from 'clipanion';

import { JobSubmitCommand, JobClaimCommand } from '../job-queue.js';
import { SqliteStorageAdapter } from '../../../kernel/adapters/sqlite/index.js';
import type { Job } from '../../../kernel/types.js';
import { sha256 } from '../../../kernel/orchestrator/node-build.js';
import { installAgentSkill } from '../../../core/agent-skill/engine.js';

const FIXER_ID = 'core/node-consolidate';
const FINDER_ID = 'core/node-redundancy';

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

function bodyFor(path: string): string {
  return `Body of ${path}\n`;
}

interface IProject {
  root: string;
  dbPath: string;
}

/**
 * Fresh project with `paths` markdown nodes and `core/node-consolidate`
 * enabled (the fixer ships experimental, so the installed default is
 * DISABLED). Each node gets a real body file so the submit-time drift
 * verification can read it off disk.
 */
async function setupProject(paths: string[]): Promise<IProject> {
  counter += 1;
  const root = join(tmpRoot, `proj-${counter}`);
  const dbPath = join(root, '.skill-map', 'skill-map.db');
  mkdirSync(join(root, '.skill-map'), { recursive: true });
  // Processing-agent gate (spec/job-lifecycle.md §Submit): submits refuse
  // unless the processing skill is installed; materialise the canonical copy.
  installAgentSkill(root, '.claude/skills');
  writeFileSync(
    join(root, '.skill-map', 'settings.json'),
    JSON.stringify({
      plugins: { core: { extensions: { 'node-consolidate': { enabled: true } } } },
    }),
  );

  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  try {
    for (const path of paths) {
      await adapter.db
        .insertInto('scan_nodes')
        .values({
          path,
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
          bodyHash: sha256(bodyFor(path)),
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
      const abs = join(root, path);
      mkdirSync(join(abs, '..'), { recursive: true });
      writeFileSync(abs, `---\ntitle: t\n---\n${bodyFor(path)}`);
    }
  } finally {
    await adapter.close();
  }
  return { root, dbPath };
}

/** Seed one fresh `core/node-redundancy` finding on `nodeId`. */
async function seedFinding(proj: IProject, nodeId: string, message: string): Promise<number> {
  const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
  await adapter.init();
  try {
    const row = await adapter.db
      .insertInto('state_findings')
      .values({
        nodeId,
        extensionId: FINDER_ID,
        extensionVersion: '0.1.0',
        origin: 'extension',
        type: 'redundancy',
        severity: 'info',
        message,
        detail: 'keep one',
        confidence: 0.7,
        model: null,
        bodyHashAtGeneration: sha256(bodyFor(nodeId)),
        generatedAt: Date.now(),
        jobId: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
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

interface ISubmitResult {
  code: number;
  out: string;
  err: string;
}

async function submit(
  proj: IProject,
  opts: { node?: string; all?: boolean; json?: boolean },
): Promise<ISubmitResult> {
  return withCwd(proj.root, async () => {
    const cap = captureContext();
    const cmd = new JobSubmitCommand();
    cmd.extension = 'node-consolidate';
    cmd.node = opts.node;
    cmd.all = opts.all ?? false;
    cmd.force = false;
    cmd.ttl = undefined;
    cmd.priority = undefined;
    cmd.json = opts.json ?? false;
    cmd.db = undefined;
    const code = await run(cmd, cap);
    return { code, out: cap.stdout(), err: cap.stderr() };
  });
}

/** Claim the next queued job (moves it to `running`) and return its id. */
async function claim(proj: IProject): Promise<string> {
  return withCwd(proj.root, async () => {
    const cap = captureContext();
    const cmd = new JobClaimCommand();
    cmd.filter = undefined;
    cmd.json = true;
    cmd.db = undefined;
    strictEqual(await run(cmd, cap), 0, cap.stderr());
    return (JSON.parse(cap.stdout()) as { id: string }).id;
  });
}

/** Every job row (any status), newest-first. */
async function listJobs(proj: IProject): Promise<Job[]> {
  const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
  await adapter.init();
  try {
    return await adapter.jobs.list({});
  } finally {
    await adapter.close();
  }
}

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-supersede-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

const NOTE = 'notes/guide.md';

describe('sm jobs submit, fixer supersede', () => {
  it('cancels the stale queued sibling and enqueues the new job (one transaction)', async () => {
    const proj = await setupProject([NOTE]);
    await seedFinding(proj, NOTE, 'The upload step is stated twice');

    const first = await submit(proj, { node: NOTE });
    strictEqual(first.code, 0, first.err);
    const firstId = first.out.trim();

    // A re-judge added a second finding: the re-rendered content hash differs,
    // so this submit supersedes the now-stale queued job.
    await seedFinding(proj, NOTE, 'The retry policy is stated twice');
    const second = await submit(proj, { node: NOTE });
    strictEqual(second.code, 0, second.err);
    const secondId = second.out.trim();

    ok(secondId && secondId !== firstId, 'a distinct new job id');
    match(second.err, new RegExp(`superseded queued job ${firstId}`), 'the superseded id rides stderr');

    const jobs = await listJobs(proj);
    strictEqual(jobs.length, 2, 'the stale job is not deleted, it is cancelled');
    const cancelled = jobs.find((j) => j.id === firstId);
    const created = jobs.find((j) => j.id === secondId);
    strictEqual(cancelled?.status, 'cancelled', 'the stale queued sibling is cancelled');
    strictEqual(cancelled?.failureReason, null, 'a cancellation records no failure reason');
    ok(typeof cancelled?.finishedAt === 'number' && cancelled.finishedAt > 0, 'finishedAt stamped');
    strictEqual(created?.status, 'queued', 'the new job is queued');
    strictEqual(jobs.filter((j) => j.status === 'queued').length, 1, 'exactly one live job remains');
  });

  it('keeps the plain exit-3 duplicate refusal for an identical resubmit', async () => {
    const proj = await setupProject([NOTE]);
    await seedFinding(proj, NOTE, 'The upload step is stated twice');

    const first = await submit(proj, { node: NOTE });
    strictEqual(first.code, 0, first.err);
    const firstId = first.out.trim();

    // Same finding set → identical content hash → still a plain duplicate.
    const second = await submit(proj, { node: NOTE });
    strictEqual(second.code, 3, 'identical request refuses with exit 3');
    ok(second.err.includes(firstId), 'names the existing job');
    doesNotMatch(second.err, /superseded/, 'an identical request is not a supersession');

    const jobs = await listJobs(proj);
    strictEqual(jobs.length, 1, 'no second job, and nothing cancelled');
    strictEqual(jobs[0]!.status, 'queued');
  });

  it('never supersedes a RUNNING job: refuses with exit 3 naming it', async () => {
    const proj = await setupProject([NOTE]);
    await seedFinding(proj, NOTE, 'The upload step is stated twice');

    const first = await submit(proj, { node: NOTE });
    strictEqual(first.code, 0, first.err);
    const firstId = first.out.trim();

    // An agent claimed the job: it is now running.
    const claimedId = await claim(proj);
    strictEqual(claimedId, firstId);

    // A changed finding set would supersede a QUEUED sibling, but a running
    // job holds the claim and is off-limits.
    await seedFinding(proj, NOTE, 'The retry policy is stated twice');
    const second = await submit(proj, { node: NOTE });
    strictEqual(second.code, 3, 'a running job is never superseded');
    ok(second.err.includes(firstId), 'names the running job');
    doesNotMatch(second.err, /superseded/, 'nothing was superseded');

    const jobs = await listJobs(proj);
    strictEqual(jobs.length, 1, 'no new job enqueued');
    strictEqual(jobs[0]!.status, 'running', 'the running job is left untouched');
  });

  it('applies the rule per node under --all', async () => {
    const A = 'notes/a.md';
    const B = 'notes/b.md';
    const proj = await setupProject([A, B]);
    await seedFinding(proj, A, 'A: upload stated twice');
    await seedFinding(proj, B, 'B: upload stated twice');

    const first = await submit(proj, { all: true });
    strictEqual(first.code, 0, first.err);
    const firstByNode = new Map(
      (await listJobs(proj)).map((j) => [j.nodeId, j.id] as const),
    );

    // Each node gets a fresh finding, so each per-node fan-out submit renders a
    // new hash and supersedes its own stale queued sibling, independently.
    await seedFinding(proj, A, 'A: retry stated twice');
    await seedFinding(proj, B, 'B: retry stated twice');
    const second = await submit(proj, { all: true });
    strictEqual(second.code, 0, second.err);
    match(second.err, new RegExp(`superseded queued job ${firstByNode.get(A)}`), 'A superseded');
    match(second.err, new RegExp(`superseded queued job ${firstByNode.get(B)}`), 'B superseded');

    const jobs = await listJobs(proj);
    strictEqual(jobs.length, 4, 'two cancelled + two queued');
    strictEqual(jobs.filter((j) => j.status === 'cancelled').length, 2);
    strictEqual(jobs.filter((j) => j.status === 'queued').length, 2, 'one live job per node');
  });

  it('--json stays the plain new Job on stdout; the supersession is silent there', async () => {
    const proj = await setupProject([NOTE]);
    await seedFinding(proj, NOTE, 'The upload step is stated twice');
    const first = await submit(proj, { node: NOTE });
    const firstId = first.out.trim();

    await seedFinding(proj, NOTE, 'The retry policy is stated twice');
    const second = await submit(proj, { node: NOTE, json: true });
    strictEqual(second.code, 0, second.err);

    const job = JSON.parse(second.out) as Job & { supersededJobId?: unknown };
    strictEqual(job.status, 'queued', 'a plain Job envelope');
    strictEqual(job.nodeId, NOTE);
    ok(!('supersededJobId' in job), '--json carries no extra supersede field');
    doesNotMatch(second.err, /superseded/, 'no human advisory in --json mode');

    // The supersession still happened under the hood.
    const jobs = await listJobs(proj);
    strictEqual(jobs.find((j) => j.id === firstId)?.status, 'cancelled');
    strictEqual(jobs.filter((j) => j.status === 'queued').length, 1);
  });
});
