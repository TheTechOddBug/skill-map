/**
 * End-to-end test for the opt-in `core/auto-fix` hook wiring (Decision
 * #144). Proves the finder -> fixer chain runs automatically INSIDE
 * `sm record`: recording a completed finder job dispatches `job.completed`
 * to the enabled hooks, and `core/auto-fix` resolves the inverse of Modelo B
 * (`spec/architecture.md` §Modelo B · Auto-fix) and queues each matching
 * fixer for the node, RENDERED with the findings-to-resolve section injected
 * (the shared `submitFixerJob` helper, not a bare row).
 *
 * Fixtures: `prob-finder` (a probabilistic finder) + `prob-fixer` (a
 * probabilistic fixer declaring `precondition.analyzerIds:
 * ['prob-finder/quality-check']`). Runs against a real project DB (never
 * `:memory:`, see feedback_sqlite_in_memory_workaround).
 *
 * Coverage:
 *   - enabled + matching fixer: a fixer job appears in state_jobs for the
 *     node, its content carrying the `## Findings to resolve` section.
 *   - the fixer job is superseded when the finder re-runs with a changed
 *     finding set (the shared supersede rule).
 *   - a finder that found nothing queues nothing (no-findings refusal
 *     swallowed).
 *   - auto-fix DISABLED queues nothing (the default).
 *   - a finder with no matching fixer queues nothing.
 *
 * Plus the PER-JOB auto-fix chain (`spec/job-lifecycle.md` §Auto-fix chain
 * (per-job)), the second, hook-independent entry point:
 *   - a finder submitted `--auto-fix` chains ALL matching fixers on record
 *     EVEN WHEN the global `core/auto-fix` hook is disabled.
 *   - hook enabled AND the job flagged: the two entry points dedupe to
 *     exactly one fixer job per `(fixer, node)`.
 */

import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strictEqual, ok, match, deepStrictEqual } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import type { BaseContext } from 'clipanion';

import { JobSubmitCommand, JobClaimCommand } from '../job-queue.js';
import { RecordCommand } from '../record.js';
import { SqliteStorageAdapter } from '../../../kernel/adapters/sqlite/index.js';
import { sha256 } from '../../../kernel/orchestrator/node-build.js';
import type { Job } from '../../../kernel/types.js';
import { installAgentSkill } from '../../../core/agent-skill/engine.js';

const FINDER_FIXTURE = fileURLToPath(new URL('./fixtures/prob-finder', import.meta.url));
const FINDER_PLUGIN_ID = 'prob-finder';
const FINDER_ID = 'prob-finder/quality-check';

const FIXER_FIXTURE = fileURLToPath(new URL('./fixtures/prob-fixer', import.meta.url));
const FIXER_PLUGIN_ID = 'prob-fixer';
const FIXER_ID = 'prob-fixer/apply-fix';

// A SECOND fixer for the same finder, materialised by copying the prob-fixer
// fixture under a distinct plugin id (its action dir stays `apply-fix`, so
// the qualified id is `prob-fixer2/apply-fix`; `analyzerIds` still names the
// finder). Proves the per-job chain queues ALL matching fixers, not just one.
const FIXER2_PLUGIN_ID = 'prob-fixer2';
const FIXER2_ID = 'prob-fixer2/apply-fix';

const SKILL = { path: '.claude/skills/foo/SKILL.md', kind: 'skill', provider: 'claude' };
const CLEAN_SAFETY = { injectionDetected: false, contentQuality: 'clean' };

const REPORT_WITH_FINDINGS = {
  confidence: 0.9,
  safety: CLEAN_SAFETY,
  findings: [
    { type: 'contradiction', severity: 'warn', message: 'Step 2 contradicts step 5', confidence: 0.7 },
    { type: 'redundancy', severity: 'info', message: 'Repeats the intro' },
  ],
};
const REPORT_ONE_FINDING = {
  confidence: 0.8,
  safety: CLEAN_SAFETY,
  findings: [{ type: 'contradiction', severity: 'warn', message: 'Step 2 contradicts step 5' }],
};
const REPORT_EMPTY = { confidence: 0.9, safety: CLEAN_SAFETY, findings: [] };

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
    stdin: { isTTY: false },
    stdout: { write: (s: string) => { out.push(s); return true; } },
    stderr: { write: (s: string) => { err.push(s); return true; } },
  } as unknown as BaseContext;
  return { context, stdout: () => out.join(''), stderr: () => err.join('') };
}

async function insertNode(adapter: SqliteStorageAdapter): Promise<void> {
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
}

interface IProject {
  root: string;
  dbPath: string;
}

async function setupProject(opts: {
  enableAutoFix: boolean;
  includeFixer: boolean;
  secondFixer?: boolean;
}): Promise<IProject> {
  counter += 1;
  const root = join(tmpRoot, `proj-${counter}`);
  const dbPath = join(root, '.skill-map', 'skill-map.db');
  mkdirSync(join(root, '.skill-map', 'plugins'), { recursive: true });
  // Processing-agent gate (spec/job-lifecycle.md §Submit): submits refuse
  // unless the processing skill is installed; materialise the canonical copy.
  installAgentSkill(root, '.claude/skills');
  cpSync(FINDER_FIXTURE, join(root, '.skill-map', 'plugins', FINDER_PLUGIN_ID), { recursive: true });
  if (opts.includeFixer) {
    cpSync(FIXER_FIXTURE, join(root, '.skill-map', 'plugins', FIXER_PLUGIN_ID), { recursive: true });
  }
  if (opts.secondFixer) {
    cpSync(FIXER_FIXTURE, join(root, '.skill-map', 'plugins', FIXER2_PLUGIN_ID), { recursive: true });
  }
  if (opts.enableAutoFix) {
    // Enable the experimental (ships-disabled) core/auto-fix hook.
    writeFileSync(
      join(root, '.skill-map', 'settings.json'),
      JSON.stringify({ plugins: { core: { extensions: { 'auto-fix': { enabled: true } } } } }),
    );
  }

  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  try {
    await insertNode(adapter);
    const abs = join(root, SKILL.path);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, `---\ntitle: t\n---\nBody of ${SKILL.path}\n`);
    await adapter.trust.set(FINDER_PLUGIN_ID, true);
    if (opts.includeFixer) await adapter.trust.set(FIXER_PLUGIN_ID, true);
    if (opts.secondFixer) await adapter.trust.set(FIXER2_PLUGIN_ID, true);
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

function buildSubmit(extension: string, autoFix = false): JobSubmitCommand {
  const cmd = new JobSubmitCommand();
  cmd.extension = extension;
  cmd.node = SKILL.path;
  cmd.all = false;
  cmd.force = false;
  cmd.ttl = undefined;
  cmd.priority = undefined;
  cmd.json = false;
  cmd.autoFix = autoFix;
  cmd.db = undefined;
  return cmd;
}

function buildRecord(o: { id: string; nonce: string }): RecordCommand {
  const cmd = new RecordCommand();
  cmd.id = o.id;
  cmd.nonce = o.nonce;
  cmd.status = 'completed';
  cmd.report = 'report.json';
  cmd.error = undefined;
  cmd.tokensIn = undefined;
  cmd.tokensOut = undefined;
  cmd.durationMs = undefined;
  cmd.model = undefined;
  cmd.json = false;
  cmd.db = undefined;
  return cmd;
}

/** Submit + claim + record one finder job with `report` (optionally --auto-fix). */
async function recordFinder(proj: IProject, report: object, autoFix = false): Promise<void> {
  const claim = await withCwd(proj.root, async () => {
    const submitCode = await run(buildSubmit(FINDER_ID, autoFix), captureContext());
    strictEqual(submitCode, 0);
    const cap = captureContext();
    const claimCmd = new JobClaimCommand();
    // Filter to the finder: a prior record may have left an auto-fix fixer
    // job queued, and an unfiltered claim would grab it instead.
    claimCmd.filter = FINDER_ID;
    claimCmd.json = true;
    claimCmd.wait = false;
    claimCmd.db = undefined;
    await run(claimCmd, cap);
    return JSON.parse(cap.stdout()) as { id: string; nonce: string };
  });
  writeFileSync(join(proj.root, 'report.json'), JSON.stringify(report));
  const cap = captureContext();
  const code = await withCwd(proj.root, async () => run(buildRecord(claim), cap));
  strictEqual(code, 0, `record: ${cap.stderr()}`);
}

async function fixerJobs(proj: IProject): Promise<Job[]> {
  const adapter = await openDb(proj.dbPath);
  try {
    return await adapter.jobs.list({ extensionId: FIXER_ID });
  } finally {
    await adapter.close();
  }
}

/** Every queued/terminal Action job (both fixer plugins), newest-first. */
async function actionJobs(proj: IProject): Promise<Job[]> {
  const adapter = await openDb(proj.dbPath);
  try {
    return (await adapter.jobs.list({})).filter((j) => j.extensionKind === 'action');
  } finally {
    await adapter.close();
  }
}

async function jobContent(proj: IProject, contentHash: string): Promise<string> {
  const adapter = await openDb(proj.dbPath);
  try {
    return (await adapter.jobs.getContent(contentHash)) ?? '';
  } finally {
    await adapter.close();
  }
}

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-auto-fix-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('core/auto-fix chain (sm record dispatches job.completed)', () => {
  it('queues the matching fixer, rendered with the findings-to-resolve section', async () => {
    const proj = await setupProject({ enableAutoFix: true, includeFixer: true });
    await recordFinder(proj, REPORT_WITH_FINDINGS);

    const jobs = await fixerJobs(proj);
    strictEqual(jobs.length, 1, 'exactly one fixer job queued by the hook');
    const fixer = jobs[0]!;
    strictEqual(fixer.extensionId, FIXER_ID);
    strictEqual(fixer.nodeId, SKILL.path);
    strictEqual(fixer.status, 'queued');
    strictEqual(fixer.extensionKind, 'action');

    // The job is a REAL rendered fixer job: the findings-injection section
    // and the finder's messages are in the content, not a bare row.
    const content = await jobContent(proj, fixer.contentHash);
    match(content, /## Findings to resolve/, 'findings-to-resolve section injected');
    match(content, /Step 2 contradicts step 5/, 'the finder message rode into the fixer content');
    match(content, /Repeats the intro/);
  });

  it('supersedes the queued fixer when the finder re-runs with a changed finding set', async () => {
    const proj = await setupProject({ enableAutoFix: true, includeFixer: true });
    await recordFinder(proj, REPORT_WITH_FINDINGS);
    const first = (await fixerJobs(proj))[0]!;

    // Re-run the finder with a DIFFERENT finding set: the fixer's injected
    // section (and content hash) change, so the queued sibling is superseded.
    await recordFinder(proj, REPORT_ONE_FINDING);

    const jobs = await fixerJobs(proj);
    const byStatus = (s: string): Job[] => jobs.filter((j) => j.status === s);
    strictEqual(byStatus('cancelled').length, 1, 'the stale queued fixer was superseded');
    strictEqual(byStatus('queued').length, 1, 'a fresh fixer sits queued');
    strictEqual(byStatus('cancelled')[0]!.id, first.id, 'the ORIGINAL job is the one cancelled');
  });

  it('queues nothing when the finder found nothing (no-findings refusal swallowed)', async () => {
    const proj = await setupProject({ enableAutoFix: true, includeFixer: true });
    await recordFinder(proj, REPORT_EMPTY);
    strictEqual((await fixerJobs(proj)).length, 0);
  });

  it('queues nothing when auto-fix is DISABLED (the default)', async () => {
    const proj = await setupProject({ enableAutoFix: false, includeFixer: true });
    await recordFinder(proj, REPORT_WITH_FINDINGS);
    strictEqual((await fixerJobs(proj)).length, 0);
  });

  it('queues nothing when no fixer serves the finder', async () => {
    const proj = await setupProject({ enableAutoFix: true, includeFixer: false });
    await recordFinder(proj, REPORT_WITH_FINDINGS);
    // No fixer plugin present: the finder still records, nothing chains.
    const adapter = await openDb(proj.dbPath);
    try {
      const all = await adapter.jobs.list({});
      ok(all.every((j) => j.extensionKind !== 'action'), 'no fixer/action job was queued');
    } finally {
      await adapter.close();
    }
  });
});

describe('per-job auto-fix chain (state_jobs.auto_fix, hook-independent)', () => {
  it('chains ALL matching fixers on record with the global hook DISABLED', async () => {
    // Hook OFF (the default) + two fixers serving the finder. The per-job
    // branch fires purely off the frozen auto_fix flag.
    const proj = await setupProject({
      enableAutoFix: false,
      includeFixer: true,
      secondFixer: true,
    });
    await recordFinder(proj, REPORT_WITH_FINDINGS, /* autoFix */ true);

    const actions = await actionJobs(proj);
    const ids = actions.map((j) => j.extensionId).sort();
    strictEqual(actions.length, 2, 'both matching fixers were chained by the per-job flag');
    deepStrictEqual(ids, [FIXER_ID, FIXER2_ID].sort());
    // Every chained job is a real queued fixer for the node.
    ok(actions.every((j) => j.status === 'queued' && j.nodeId === SKILL.path));
    // The finder job itself froze the flag; the fixers never chain (auto_fix=0).
    ok(actions.every((j) => j.autoFix === false), 'a fixer job never carries auto_fix');
  });

  it('does not double-submit when the hook is ALSO enabled', async () => {
    // Both entry points resolve the same fixer; the record drain dedupes by
    // (fixerId, nodeId), so exactly one fixer job lands.
    const proj = await setupProject({ enableAutoFix: true, includeFixer: true });
    await recordFinder(proj, REPORT_WITH_FINDINGS, /* autoFix */ true);

    const jobs = await fixerJobs(proj);
    strictEqual(jobs.length, 1, 'the two entry points collapse to one fixer job');
    strictEqual(jobs[0]!.status, 'queued');
  });

  it('freezes auto_fix on the finder job and leaves it off without the flag', async () => {
    const proj = await setupProject({ enableAutoFix: false, includeFixer: true });
    await recordFinder(proj, REPORT_EMPTY, /* autoFix */ true);
    const adapter = await openDb(proj.dbPath);
    try {
      const finder = (await adapter.jobs.list({ extensionId: FINDER_ID }))[0]!;
      strictEqual(finder.autoFix, true, 'the finder submit froze auto_fix');
      strictEqual(finder.extensionKind, 'analyzer');
    } finally {
      await adapter.close();
    }
  });
});
