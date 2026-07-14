/**
 * `core/node-consolidate`, the FIRST fixer (a probabilistic Action
 * declaring `precondition.analyzerIds`, `spec/job-lifecycle.md` §Findings
 * injection for fixers). End-to-end characterisation through the real CLI
 * verbs plus the codegen inlining pins:
 *
 *   - ships experimental: DISABLED by default, `sm job submit
 *     node-consolidate` does not resolve until the operator enables it.
 *   - once enabled, submitting over a node WITH non-stale `node-redundancy`
 *     findings injects the `## Findings to resolve` section (and the prompt)
 *     into the rendered job content.
 *   - submitting over a node with NO matching findings (none seeded, or only
 *     stale ones) is refused with exit 2.
 *   - `sm plugins show core/node-consolidate` renders the Prompt + Report
 *     schema contract sections.
 *   - a happy-path record round-trip validates the fixer report
 *     (resolved / editsSummary / safety / confidence) against its schema; a
 *     report missing `resolved` fails as report-invalid.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strictEqual, deepStrictEqual, ok, match } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import type { BaseContext } from 'clipanion';

import { JobSubmitCommand, JobClaimCommand } from '../job-queue.js';
import { RecordCommand } from '../record.js';
import { PluginsShowCommand } from '../plugins/show.js';
import { SqliteStorageAdapter } from '../../../kernel/adapters/sqlite/index.js';
import { sha256 } from '../../../kernel/orchestrator/node-build.js';
import { builtIns } from '../../../plugins/built-ins.js';

const FIXER_ID = 'core/node-consolidate';
const FINDER_ID = 'core/node-redundancy';
const NOTE = { path: 'notes/guide.md', kind: 'markdown', provider: 'markdown' };
const BODY_HASH = sha256(`Body of ${NOTE.path}\n`);

const HERE = dirname(fileURLToPath(import.meta.url));
const ACTION_DIR = resolve(HERE, '..', '..', '..', 'plugins', 'core', 'actions', 'node-consolidate');

const CLEAN_SAFETY = { injectionDetected: false, contentQuality: 'clean' };

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

/**
 * Fresh project with one markdown node. `enableFixer` writes the
 * per-extension operational toggle (the fixer ships experimental, so the
 * installed default is DISABLED).
 */
async function setupProject(opts: { enableFixer: boolean }): Promise<IProject> {
  counter += 1;
  const root = join(tmpRoot, `proj-${counter}`);
  const dbPath = join(root, '.skill-map', 'skill-map.db');
  mkdirSync(join(root, '.skill-map'), { recursive: true });
  if (opts.enableFixer) {
    writeFileSync(
      join(root, '.skill-map', 'settings.json'),
      JSON.stringify({
        plugins: { core: { extensions: { 'node-consolidate': { enabled: true } } } },
      }),
    );
  }

  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  try {
    await adapter.db
      .insertInto('scan_nodes')
      .values({
        path: NOTE.path,
        kind: NOTE.kind,
        provider: NOTE.provider,
        title: null,
        description: null,
        stability: null,
        version: null,
        sidecarStatus: null,
        annotationsJson: null,
        sidecarRootJson: null,
        frontmatterJson: '{}',
        bodyHash: BODY_HASH,
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
    const abs = join(root, NOTE.path);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, `---\ntitle: t\n---\nBody of ${NOTE.path}\n`);
  } finally {
    await adapter.close();
  }
  return { root, dbPath };
}

/**
 * Seed one `core/node-redundancy` finding against the node. `stale` stamps
 * a mismatched `body_hash_at_generation` so the read-time staleness JOIN
 * hides it (the fixer must then refuse).
 */
async function seedRedundancyFinding(proj: IProject, opts?: { stale?: boolean }): Promise<void> {
  const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
  await adapter.init();
  try {
    await adapter.db
      .insertInto('state_findings')
      .values({
        nodeId: NOTE.path,
        extensionId: FINDER_ID,
        extensionVersion: '0.1.0',
        origin: 'extension',
        type: 'redundancy',
        severity: 'info',
        message: 'The upload step is stated twice',
        detail: '"Upload it" vs "Upload the artifact"; keep one',
        confidence: 0.7,
        model: null,
        bodyHashAtGeneration: opts?.stale ? 'z'.repeat(64) : BODY_HASH,
        generatedAt: Date.now(),
        jobId: null,
      })
      .execute();
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

async function submit(proj: IProject, extension: string): Promise<{ code: number; err: string }> {
  return withCwd(proj.root, async () => {
    const cap = captureContext();
    const cmd = new JobSubmitCommand();
    cmd.extension = extension;
    cmd.node = NOTE.path;
    cmd.all = false;
    cmd.force = false;
    cmd.ttl = undefined;
    cmd.priority = undefined;
    cmd.json = false;
    cmd.db = undefined;
    const code = await run(cmd, cap);
    return { code, err: cap.stderr() };
  });
}

/** Claim the queued job, then record `report`. Returns the record exit code. */
async function claimAndRecord(proj: IProject, report: object): Promise<{ code: number; err: string }> {
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
    const code = await run(cmd, cap);
    return { code, err: cap.stderr() };
  });
}

/** The rendered content of the single job in the project's queue. */
async function jobContent(proj: IProject): Promise<string> {
  const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
  await adapter.init();
  try {
    const jobs = await adapter.jobs.list({});
    strictEqual(jobs.length, 1, 'exactly one job queued');
    const content = await adapter.jobs.getContent(jobs[0]!.contentHash);
    ok(content, 'content row present');
    return content;
  } finally {
    await adapter.close();
  }
}

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-node-consolidate-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('core/node-consolidate, codegen inlining pins', () => {
  it('is a probabilistic experimental fixer with the node-redundancy precondition', () => {
    const action = builtIns().actions.find((a) => a.id === 'node-consolidate');
    ok(action, 'built-in registered');
    strictEqual(action.pluginId, 'core');
    strictEqual(action.mode, 'probabilistic');
    strictEqual(action.stability, 'experimental');
    strictEqual(action.probExpectedDurationSeconds, 120);
    deepStrictEqual(action.precondition?.analyzerIds, ['core/node-redundancy']);
    // Probabilistic Actions carry NO in-process invoke and NO scan-time project.
    strictEqual(action.invoke, undefined);
    strictEqual(action.project, undefined);
  });

  it('inlines prompt.md byte-equal and report.schema.json deep-equal', () => {
    const action = builtIns().actions.find((a) => a.id === 'node-consolidate');
    ok(action);
    strictEqual(
      action.promptTemplate,
      readFileSync(join(ACTION_DIR, 'prompt.md'), 'utf8'),
      'codegen inlined the exact prompt bytes',
    );
    deepStrictEqual(
      action.reportSchema,
      JSON.parse(readFileSync(join(ACTION_DIR, 'report.schema.json'), 'utf8')),
    );
    // The prompt avoids the literal `<user-content` delimiter (the render
    // guard rejects it) while keeping the `{{userContent}}` placeholder.
    ok(!/<user-content/i.test(action.promptTemplate ?? ''), 'no literal delimiter in the template');
    ok((action.promptTemplate ?? '').includes('{{userContent}}'), 'carries the placeholder');
  });
});

describe('core/node-consolidate, experimental gate', () => {
  it('ships DISABLED: sm job submit does not resolve it by default', async () => {
    const proj = await setupProject({ enableFixer: false });
    await seedRedundancyFinding(proj);
    const { code, err } = await submit(proj, 'node-consolidate');
    strictEqual(code, 5, 'not in the composed catalog until enabled');
    match(err, /not found/);
  });
});

describe('core/node-consolidate, findings injection', () => {
  it('refuses (exit 2) when the node has no matching findings', async () => {
    const proj = await setupProject({ enableFixer: true });
    const { code, err } = await submit(proj, 'node-consolidate');
    strictEqual(code, 2, 'no findings to resolve');
    match(err, /no findings to resolve for core\/node-redundancy on notes\/guide\.md/);
  });

  it('refuses (exit 2) when the only matching finding is stale', async () => {
    const proj = await setupProject({ enableFixer: true });
    await seedRedundancyFinding(proj, { stale: true });
    const { code, err } = await submit(proj, 'node-consolidate');
    strictEqual(code, 2, 'stale findings describe a body that no longer exists');
    match(err, /no findings to resolve/);
  });

  it('injects the ## Findings to resolve section (and the prompt) on a judged node', async () => {
    const proj = await setupProject({ enableFixer: true });
    await seedRedundancyFinding(proj);
    const { code, err } = await submit(proj, 'node-consolidate');
    strictEqual(code, 0, `submit: ${err}`);

    const content = await jobContent(proj);
    // The fixer prompt template rendered.
    match(content, /Resolve the redundancy findings listed in the/);
    // The kernel-authored findings section, before the user-content block.
    match(content, /## Findings to resolve/);
    match(content, /The upload step is stated twice/);
    const blockOpen = `<user-content id="${NOTE.path}">`;
    ok(content.includes(blockOpen), 'user-content block present');
    // The findings section sits OUTSIDE (before) the user-content block.
    // (`<user-content id="...">` also appears in the preamble prose, so
    // anchor on the actual node block, not the bare tag.)
    ok(
      content.indexOf('## Findings to resolve') < content.indexOf(blockOpen),
      'findings render before the user-content block',
    );
  });
});

describe('core/node-consolidate, sm plugins show contract sections', () => {
  it('renders Prompt + Report schema for the built-in fixer', async () => {
    const proj = await setupProject({ enableFixer: false });
    const out = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const cmd = new PluginsShowCommand();
      cmd.id = FIXER_ID;
      cmd.pluginDir = undefined;
      cmd.json = false;
      cmd.db = undefined;
      strictEqual(await run(cmd, cap), 0, cap.stderr());
      return cap.stdout();
    });
    match(out, /^  Prompt$/m);
    match(out, /Resolve the redundancy findings listed in the/);
    match(out, /^  Report schema$/m);
    match(out, /"editsSummary"/, 'pretty schema shows the fixer report fields');
  });
});

describe('core/node-consolidate, record round trip', () => {
  it('validates the fixer report (resolved / editsSummary / safety / confidence)', async () => {
    const proj = await setupProject({ enableFixer: true });
    await seedRedundancyFinding(proj);
    strictEqual((await submit(proj, 'node-consolidate')).code, 0);

    const { code, err } = await claimAndRecord(proj, {
      confidence: 0.9,
      safety: CLEAN_SAFETY,
      resolved: [
        { type: 'redundancy', applied: true, note: 'Collapsed the two upload sentences into one.' },
      ],
      editsSummary: 'Merged the duplicated upload instruction; meaning preserved.',
    });
    strictEqual(code, 0, err);

    const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
    await adapter.init();
    try {
      const jobs = await adapter.jobs.list({});
      strictEqual(jobs[0]!.status, 'completed');
      // A fixer is execution-only: no findings write-through for its own id.
      strictEqual(
        (await adapter.findings.list({ includeStale: true, extensionIds: [FIXER_ID] })).length,
        0,
        'the fixer writes no state_findings rows of its own',
      );
    } finally {
      await adapter.close();
    }
  });

  it('fails a report missing `resolved` as report-invalid', async () => {
    const proj = await setupProject({ enableFixer: true });
    await seedRedundancyFinding(proj);
    strictEqual((await submit(proj, 'node-consolidate')).code, 0);

    const { code, err } = await claimAndRecord(proj, {
      confidence: 0.9,
      safety: CLEAN_SAFETY,
      editsSummary: 'nothing',
    });
    strictEqual(code, 2, 'report-invalid exit');
    match(err, /report failed schema validation/);

    const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
    await adapter.init();
    try {
      const jobs = await adapter.jobs.list({});
      strictEqual(jobs[0]!.status, 'failed');
      strictEqual(jobs[0]!.failureReason, 'report-invalid');
    } finally {
      await adapter.close();
    }
  });
});
