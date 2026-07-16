/**
 * `core/node-redundancy`, the FIRST probabilistic built-in Analyzer
 * (Step 11 wave 1). End-to-end characterisation through the real CLI
 * verbs plus the codegen inlining pins:
 *
 *   - ships experimental: DISABLED by default, `sm jobs submit
 *     node-redundancy` does not resolve until the operator enables it.
 *   - once enabled, the submit resolves with the frozen
 *     `extensionKind: 'analyzer'`.
 *   - `sm plugins show core/node-redundancy` renders the Prompt +
 *     Report schema contract sections.
 *   - the codegen-inlined `promptTemplate` / `reportSchema` are
 *     byte-/deep-equal to the authored sibling files.
 *   - the report schema narrows `findings[].type` to the `redundancy`
 *     const: a foreign slug fails the record as `report-invalid`.
 *   - the happy-path record lands `state_findings` rows of type
 *     `redundancy`.
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

const FINDER_ID = 'core/node-redundancy';
const NOTE = { path: 'notes/guide.md', kind: 'markdown', provider: 'markdown' };

const HERE = dirname(fileURLToPath(import.meta.url));
const ANALYZER_DIR = resolve(HERE, '..', '..', '..', 'plugins', 'core', 'analyzers', 'node-redundancy');

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
 * Fresh project with one markdown node. `enableFinder` writes the
 * per-extension operational toggle to `settings.json` (the finder ships
 * experimental, so the installed default is DISABLED).
 */
async function setupProject(opts: { enableFinder: boolean }): Promise<IProject> {
  counter += 1;
  const root = join(tmpRoot, `proj-${counter}`);
  const dbPath = join(root, '.skill-map', 'skill-map.db');
  mkdirSync(join(root, '.skill-map'), { recursive: true });
  if (opts.enableFinder) {
    writeFileSync(
      join(root, '.skill-map', 'settings.json'),
      JSON.stringify({
        plugins: { core: { extensions: { 'node-redundancy': { enabled: true } } } },
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
        bodyHash: sha256(`Body of ${NOTE.path}\n`),
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

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-node-redundancy-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('core/node-redundancy, codegen inlining pins', () => {
  it('the inlined promptTemplate is byte-equal to the authored prompt.md', () => {
    const finder = builtIns().analyzers.find((a) => a.id === 'node-redundancy');
    ok(finder, 'built-in registered');
    strictEqual(finder.mode, 'probabilistic');
    strictEqual(finder.stability, 'experimental');
    strictEqual(finder.probExpectedDurationSeconds, 60);
    strictEqual(
      finder.promptTemplate,
      readFileSync(join(ANALYZER_DIR, 'prompt.md'), 'utf8'),
      'codegen inlined the exact prompt bytes',
    );
  });

  it('the inlined reportSchema deep-equals the authored report.schema.json', () => {
    const finder = builtIns().analyzers.find((a) => a.id === 'node-redundancy');
    ok(finder?.reportSchema);
    deepStrictEqual(
      finder.reportSchema,
      JSON.parse(readFileSync(join(ANALYZER_DIR, 'report.schema.json'), 'utf8')),
    );
  });
});

describe('core/node-redundancy, experimental gate', () => {
  it('ships DISABLED: sm jobs submit does not resolve it by default', async () => {
    const proj = await setupProject({ enableFinder: false });
    const { code, err } = await submit(proj, 'node-redundancy');
    strictEqual(code, 5, 'not in the composed catalog until enabled');
    match(err, /not found/);
  });

  it('enabling it makes the submit resolve with the frozen analyzer kind', async () => {
    const proj = await setupProject({ enableFinder: true });
    const { code, err } = await submit(proj, 'node-redundancy');
    strictEqual(code, 0, `submit: ${err}`);

    const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
    await adapter.init();
    try {
      const jobs = await adapter.jobs.list({});
      strictEqual(jobs.length, 1);
      strictEqual(jobs[0]!.extensionId, FINDER_ID);
      strictEqual(jobs[0]!.extensionKind, 'analyzer', 'kind frozen at submit');
    } finally {
      await adapter.close();
    }
  });
});

describe('core/node-redundancy, sm plugins show contract sections', () => {
  it('renders Prompt + Report schema for the built-in finder', async () => {
    const proj = await setupProject({ enableFinder: false });
    const out = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const cmd = new PluginsShowCommand();
      cmd.id = FINDER_ID;
      cmd.pluginDir = undefined;
      cmd.json = false;
      cmd.db = undefined;
      strictEqual(await run(cmd, cap), 0, cap.stderr());
      return cap.stdout();
    });
    match(out, /^  Prompt$/m);
    match(out, /Judge ONE thing about the document below: internal redundancy\./);
    match(out, /^  Report schema$/m);
    match(out, /"const": "redundancy"/, 'pretty schema shows the type narrowing');
  });
});

describe('core/node-redundancy, record round trip', () => {
  it('rejects a foreign finding type as report-invalid (schema const narrowing)', async () => {
    const proj = await setupProject({ enableFinder: true });
    strictEqual((await submit(proj, 'node-redundancy')).code, 0);

    const { code, err } = await claimAndRecord(proj, {
      confidence: 0.8,
      safety: CLEAN_SAFETY,
      findings: [{ type: 'contradiction', severity: 'warn', message: 'wrong judgment' }],
    });
    strictEqual(code, 2, 'report-invalid exit');
    match(err, /report failed schema validation/);

    const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
    await adapter.init();
    try {
      const jobs = await adapter.jobs.list({});
      strictEqual(jobs[0]!.status, 'failed');
      strictEqual(jobs[0]!.failureReason, 'report-invalid');
      strictEqual(
        (await adapter.findings.list({ includeStale: true })).length,
        0,
        'nothing written',
      );
    } finally {
      await adapter.close();
    }
  });

  it('lands state_findings rows of type redundancy on the happy path', async () => {
    const proj = await setupProject({ enableFinder: true });
    strictEqual((await submit(proj, 'node-redundancy')).code, 0);

    const { code, err } = await claimAndRecord(proj, {
      confidence: 0.85,
      safety: CLEAN_SAFETY,
      findings: [
        {
          type: 'redundancy',
          severity: 'info',
          message: 'The upload step is stated twice',
          detail: '"Upload it" vs "Upload the artifact"; keep one',
          confidence: 0.7,
        },
      ],
    });
    strictEqual(code, 0, err);

    const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
    await adapter.init();
    try {
      const rows = await adapter.findings.list({ nodeId: NOTE.path });
      strictEqual(rows.length, 1);
      strictEqual(rows[0]!.extensionId, FINDER_ID);
      strictEqual(rows[0]!.origin, 'extension');
      strictEqual(rows[0]!.type, 'redundancy');
      strictEqual(rows[0]!.confidence, 0.7, 'per-finding confidence wins');
    } finally {
      await adapter.close();
    }
  });
});
