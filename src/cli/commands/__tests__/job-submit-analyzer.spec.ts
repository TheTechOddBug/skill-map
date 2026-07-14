/**
 * End-to-end tests for the kind-agnostic submit target resolution
 * (`spec/cli-contract.md` §Jobs, Submit target resolution) through the
 * real `sm job submit` verb:
 *
 *   - a probabilistic finder Analyzer submits like an Action (bare and
 *     qualified ids), TTL derived from ITS probExpectedDurationSeconds.
 *   - a plugin shipping BOTH kinds under one extension id (`prob-dual`
 *     fixture): the unprefixed forms refuse with exit 2 and an advisory
 *     naming `action:<id>` / `analyzer:<id>`; the prefixed forms are
 *     ALWAYS accepted, also when unambiguous.
 *   - the deterministic refusal keeps the conformance-pinned phrase.
 */

import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { strictEqual, ok, match } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import type { BaseContext } from 'clipanion';

import { JobSubmitCommand, JobClaimCommand } from '../job-queue.js';
import { RecordCommand } from '../record.js';
import { SqliteStorageAdapter } from '../../../kernel/adapters/sqlite/index.js';
import { sha256 } from '../../../kernel/orchestrator/node-build.js';
import type { IFindingRecord } from '../../../kernel/types/storage.js';

const FINDER_FIXTURE = fileURLToPath(new URL('./fixtures/prob-finder', import.meta.url));
const DUAL_FIXTURE = fileURLToPath(new URL('./fixtures/prob-dual', import.meta.url));

const SKILL = { path: '.claude/skills/foo/SKILL.md', kind: 'skill', provider: 'claude' };

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

interface IProject {
  root: string;
  dbPath: string;
}

async function setupProject(): Promise<IProject> {
  counter += 1;
  const root = join(tmpRoot, `proj-${counter}`);
  const dbPath = join(root, '.skill-map', 'skill-map.db');
  mkdirSync(join(root, '.skill-map', 'plugins'), { recursive: true });
  cpSync(FINDER_FIXTURE, join(root, '.skill-map', 'plugins', 'prob-finder'), { recursive: true });
  cpSync(DUAL_FIXTURE, join(root, '.skill-map', 'plugins', 'prob-dual'), { recursive: true });

  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  try {
    await adapter.db
      .insertInto('scan_nodes')
      .values({
        path: SKILL.path,
        kind: SKILL.kind,
        provider: SKILL.provider,
        title: null,
        description: null,
        stability: null,
        version: null,
        sidecarStatus: null,
        annotationsJson: null,
        sidecarRootJson: null,
        frontmatterJson: '{}',
        bodyHash: sha256(`Body of ${SKILL.path}\n`),
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
    const abs = join(root, SKILL.path);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, `---\ntitle: t\n---\nBody of ${SKILL.path}\n`);
    await adapter.trust.set('prob-finder', true);
    await adapter.trust.set('prob-dual', true);
  } finally {
    await adapter.close();
  }
  return { root, dbPath };
}

function buildSubmit(extension: string): JobSubmitCommand {
  const cmd = new JobSubmitCommand();
  cmd.extension = extension;
  cmd.node = SKILL.path;
  cmd.all = false;
  cmd.force = false;
  cmd.ttl = undefined;
  cmd.priority = undefined;
  cmd.json = false;
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

async function submit(proj: IProject, extension: string): Promise<{ code: number; out: string; err: string }> {
  return withCwd(proj.root, async () => {
    const cap = captureContext();
    const code = await run(buildSubmit(extension), cap);
    return { code, out: cap.stdout(), err: cap.stderr() };
  });
}

async function lastJob(
  proj: IProject,
): Promise<{ extensionId: string; extensionKind: string; ttlSeconds: number | null }> {
  const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
  await adapter.init();
  try {
    const jobs = await adapter.jobs.list({});
    ok(jobs.length > 0, 'a job was enqueued');
    return {
      extensionId: jobs[0]!.extensionId,
      extensionKind: jobs[0]!.extensionKind,
      ttlSeconds: jobs[0]!.ttlSeconds,
    };
  } finally {
    await adapter.close();
  }
}

/** Claim the queued job, then record `report` for it. Returns the exit code. */
async function claimAndRecord(proj: IProject, report: object): Promise<number> {
  const { id, nonce } = await withCwd(proj.root, async () => {
    const cap = captureContext();
    const claim = new JobClaimCommand();
    claim.filter = undefined;
    claim.json = true;
    claim.db = undefined;
    await run(claim, cap);
    return JSON.parse(cap.stdout()) as { id: string; nonce: string };
  });
  writeFileSync(join(proj.root, 'report.json'), JSON.stringify(report));
  return withCwd(proj.root, async () => {
    const cap = captureContext();
    const cmd = new RecordCommand();
    cmd.id = id;
    cmd.nonce = nonce;
    cmd.status = 'completed';
    cmd.report = 'report.json';
    cmd.error = undefined;
    cmd.tokensIn = undefined;
    cmd.tokensOut = undefined;
    cmd.durationMs = undefined;
    cmd.model = undefined;
    cmd.json = true;
    cmd.db = undefined;
    return run(cmd, cap);
  });
}

async function findingsFor(proj: IProject): Promise<IFindingRecord[]> {
  const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
  await adapter.init();
  try {
    return await adapter.findings.list({ nodeId: SKILL.path, includeStale: true });
  } finally {
    await adapter.close();
  }
}

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-job-analyzer-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('sm job submit resolves probabilistic Analyzers', () => {
  it('enqueues a finder by qualified id; no TTL absent every operator source', async () => {
    const proj = await setupProject();
    const { code, out } = await submit(proj, 'prob-finder/quality-check');
    strictEqual(code, 0);
    match(out, /^d-\d{8}-\d{6}-[0-9a-f]{4}\n$/);
    const job = await lastJob(proj);
    strictEqual(job.extensionId, 'prob-finder/quality-check');
    strictEqual(job.extensionKind, 'analyzer', 'resolved kind frozen on the row');
    // Opt-in TTL (Decision #139): probExpectedDurationSeconds is
    // advisory only, so with no flag / config source the job never
    // expires.
    strictEqual(job.ttlSeconds, null);
  });

  it('enqueues a finder by bare id (suffix matching)', async () => {
    const proj = await setupProject();
    const { code } = await submit(proj, 'quality-check');
    strictEqual(code, 0);
    strictEqual((await lastJob(proj)).extensionId, 'prob-finder/quality-check');
  });

  it('the analyzer: prefix is accepted on an unambiguous id too', async () => {
    const proj = await setupProject();
    const { code } = await submit(proj, 'analyzer:prob-finder/quality-check');
    strictEqual(code, 0);
    strictEqual((await lastJob(proj)).extensionId, 'prob-finder/quality-check');
  });

  it('keeps the pinned deterministic refusal (exit 2, conformance phrase)', async () => {
    const proj = await setupProject();
    const { code, err } = await submit(proj, 'core/node-set-tags');
    strictEqual(code, 2);
    match(err, /only probabilistic extensions are queued/);
    match(err, /deterministic actions run in-process/);
  });

  it('still exits 5 when nothing matches at all', async () => {
    const proj = await setupProject();
    const { code, err } = await submit(proj, 'no/such-extension');
    strictEqual(code, 5);
    match(err, /not found/);
  });
});

describe('dual extension id (prob-dual ships action + analyzer as `judge`)', () => {
  it('the unprefixed bare form refuses with exit 2 and the disambiguating advisory', async () => {
    const proj = await setupProject();
    const { code, err } = await submit(proj, 'judge');
    strictEqual(code, 2);
    match(err, /matches both a probabilistic action and a probabilistic analyzer/);
    match(err, /action:prob-dual\/judge/);
    match(err, /analyzer:prob-dual\/judge/);
  });

  it('the unprefixed qualified form refuses too (the id itself is dual)', async () => {
    const proj = await setupProject();
    const { code, err } = await submit(proj, 'prob-dual/judge');
    strictEqual(code, 2);
    match(err, /action:prob-dual\/judge/);
  });

  it('action:prob-dual/judge is always accepted and enqueues the action half', async () => {
    const proj = await setupProject();
    const { code } = await submit(proj, 'action:prob-dual/judge');
    strictEqual(code, 0);
    const job = await lastJob(proj);
    strictEqual(job.extensionId, 'prob-dual/judge');
    strictEqual(job.extensionKind, 'action', 'the action half froze kind=action');
    strictEqual(job.ttlSeconds, null, 'no operator source, no TTL');
  });

  it('analyzer:prob-dual/judge is always accepted and enqueues the analyzer half', async () => {
    const proj = await setupProject();
    const { code } = await submit(proj, 'analyzer:prob-dual/judge');
    strictEqual(code, 0);
    const job = await lastJob(proj);
    strictEqual(job.extensionId, 'prob-dual/judge');
    strictEqual(job.extensionKind, 'analyzer', 'the analyzer half froze kind=analyzer');
    strictEqual(job.ttlSeconds, null, 'no operator source, no TTL');
  });
});

describe('dual-id round trip routes on the FROZEN extensionKind', () => {
  // The two halves ship INCOMPATIBLE report schemas on purpose: the
  // action requires `verdict`, the analyzer's findings envelope requires
  // `findings`. Each report below validates ONLY against its own half,
  // so a completed record proves the stored kind (not the id) picked the
  // schema and the write-through lane.
  const ANALYZER_REPORT = {
    confidence: 0.8,
    safety: { injectionDetected: false, contentQuality: 'clean' },
    findings: [{ type: 'contradiction', severity: 'warn', message: 'dual finder row' }],
  };
  const ACTION_REPORT = {
    verdict: 'looks fine',
    confidence: 0.9,
    safety: { injectionDetected: false, contentQuality: 'clean' },
  };

  it('analyzer:prob-dual/judge validates against the ANALYZER schema and lands findings', async () => {
    const proj = await setupProject();
    strictEqual((await submit(proj, 'analyzer:prob-dual/judge')).code, 0);
    strictEqual(
      await claimAndRecord(proj, ANALYZER_REPORT),
      0,
      'findings report accepted by the analyzer schema (the action schema would reject it)',
    );

    const rows = await findingsFor(proj);
    strictEqual(rows.length, 1);
    strictEqual(rows[0]!.extensionId, 'prob-dual/judge');
    strictEqual(rows[0]!.origin, 'extension');
    strictEqual(rows[0]!.type, 'contradiction');
  });

  it('action:prob-dual/judge validates against the ACTION schema, no finder lane', async () => {
    const proj = await setupProject();
    strictEqual((await submit(proj, 'action:prob-dual/judge')).code, 0);
    strictEqual(
      await claimAndRecord(proj, ACTION_REPORT),
      0,
      'verdict report accepted by the action schema (the analyzer schema would reject it)',
    );

    strictEqual((await findingsFor(proj)).length, 0, 'clean action record writes no findings');
    const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
    await adapter.init();
    try {
      const executions = await adapter.history.list({});
      strictEqual(executions.length, 1);
      strictEqual(executions[0]!.status, 'completed');
      ok(executions[0]!.reportPath!.includes('looks fine'), 'report stored on history');
    } finally {
      await adapter.close();
    }
  });

  it('the cross-schema mismatch is refused as report-invalid (routing is kind-strict)', async () => {
    const proj = await setupProject();
    strictEqual((await submit(proj, 'action:prob-dual/judge')).code, 0);
    // A findings-shaped report against the ACTION job: the action schema
    // requires `verdict`, so the kind-strict routing must reject it.
    strictEqual(await claimAndRecord(proj, ANALYZER_REPORT), 2, 'report-invalid, exit 2');

    const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
    await adapter.init();
    try {
      const jobs = await adapter.jobs.list({});
      strictEqual(jobs[0]!.status, 'failed');
      strictEqual(jobs[0]!.failureReason, 'report-invalid');
    } finally {
      await adapter.close();
    }
    strictEqual((await findingsFor(proj)).length, 0, 'nothing written');
  });
});
