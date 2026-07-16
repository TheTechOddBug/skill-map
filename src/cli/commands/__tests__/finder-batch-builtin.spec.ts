/**
 * The wave-1 finder batch: `core/node-contradiction`,
 * `core/node-incoherence`, `core/node-contraindication`. Same mold as
 * `core/node-redundancy` (see `node-redundancy-builtin.spec.ts`), so the
 * suite is PARAMETERIZED over the three finders instead of cloning the
 * file per extension. Per finder:
 *
 *   - codegen-inlined `promptTemplate` / `reportSchema` byte-/deep-equal
 *     to the authored siblings (and the prompt never mentions the
 *     literal user-content delimiter, the render guard rejects it).
 *   - ships experimental: DISABLED by default (`sm jobs submit` exits 5).
 *   - once enabled, the submit resolves with the frozen
 *     `extensionKind: 'analyzer'`.
 *   - `sm plugins show` renders the Prompt + Report schema sections with
 *     the finder's own type const.
 *   - a foreign finding type fails the record as `report-invalid`
 *     (schema const narrowing).
 *   - the happy-path record lands `state_findings` rows of the finder's
 *     own type.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strictEqual, deepStrictEqual, ok, match, doesNotMatch } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import type { BaseContext } from 'clipanion';

import { JobSubmitCommand, JobClaimCommand } from '../job-queue.js';
import { RecordCommand } from '../record.js';
import { PluginsShowCommand } from '../plugins/show.js';
import { SqliteStorageAdapter } from '../../../kernel/adapters/sqlite/index.js';
import { sha256 } from '../../../kernel/orchestrator/node-build.js';
import { builtIns } from '../../../plugins/built-ins.js';

const NOTE = { path: 'notes/guide.md', kind: 'markdown', provider: 'markdown' };

const HERE = dirname(fileURLToPath(import.meta.url));
const ANALYZERS_ROOT = resolve(HERE, '..', '..', '..', 'plugins', 'core', 'analyzers');

const CLEAN_SAFETY = { injectionDetected: false, contentQuality: 'clean' };

/** The batch under test: extension id, finding type const, prompt opener. */
const FINDERS = [
  {
    id: 'node-contradiction',
    type: 'contradiction',
    opener: 'Judge ONE thing about the document below: internal contradictions.',
  },
  {
    id: 'node-incoherence',
    type: 'incoherence',
    opener: 'Judge ONE thing about the document below: internal incoherence.',
  },
  {
    id: 'node-contraindication',
    type: 'contraindication',
    opener: 'Judge ONE thing about the document below: contraindications.',
  },
] as const;

/** A finding slug none of the three finders may emit. */
const FOREIGN_TYPE = 'redundancy';

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

/** Fresh project with one markdown node; optionally enable one finder. */
async function setupProject(opts: { enable?: string }): Promise<IProject> {
  counter += 1;
  const root = join(tmpRoot, `proj-${counter}`);
  const dbPath = join(root, '.skill-map', 'skill-map.db');
  mkdirSync(join(root, '.skill-map'), { recursive: true });
  if (opts.enable !== undefined) {
    writeFileSync(
      join(root, '.skill-map', 'settings.json'),
      JSON.stringify({
        plugins: { core: { extensions: { [opts.enable]: { enabled: true } } } },
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
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-finder-batch-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

for (const finder of FINDERS) {
  const QUALIFIED = `core/${finder.id}`;
  const ANALYZER_DIR = join(ANALYZERS_ROOT, finder.id);

  describe(`core/${finder.id}, codegen inlining pins`, () => {
    it('the inlined promptTemplate is byte-equal to the authored prompt.md', () => {
      const manifest = builtIns().analyzers.find((a) => a.id === finder.id);
      ok(manifest, 'built-in registered');
      strictEqual(manifest.mode, 'probabilistic');
      strictEqual(manifest.stability, 'experimental');
      strictEqual(manifest.probExpectedDurationSeconds, 60);
      strictEqual(manifest.precondition, undefined, 'universal: no precondition');
      strictEqual(manifest.evaluate, undefined, 'finders carry no evaluate()');
      const promptBytes = readFileSync(join(ANALYZER_DIR, 'prompt.md'), 'utf8');
      strictEqual(manifest.promptTemplate, promptBytes, 'codegen inlined the exact prompt bytes');
      ok(promptBytes.startsWith(finder.opener), 'prompt opener matches the approved skeleton');
      // Delimiter lesson: the template never mentions the literal
      // kernel-owned delimiter (the render guard would reject it).
      doesNotMatch(promptBytes, /<user-content/i);
      ok(
        promptBytes.includes('inside the user-content block'),
        'scope statement uses the prose phrasing',
      );
    });

    it('the inlined reportSchema deep-equals the authored report.schema.json', () => {
      const manifest = builtIns().analyzers.find((a) => a.id === finder.id);
      ok(manifest?.reportSchema);
      const authored = JSON.parse(
        readFileSync(join(ANALYZER_DIR, 'report.schema.json'), 'utf8'),
      ) as Record<string, unknown>;
      deepStrictEqual(manifest.reportSchema, authored);
      strictEqual(
        JSON.stringify(authored).includes(`"const":"${finder.type}"`) ||
          JSON.stringify(authored).includes(`"const": "${finder.type}"`),
        true,
        'schema narrows findings[].type to the finder const',
      );
    });
  });

  describe(`core/${finder.id}, experimental gate`, () => {
    it('ships DISABLED: sm jobs submit does not resolve it by default', async () => {
      const proj = await setupProject({});
      const { code, err } = await submit(proj, finder.id);
      strictEqual(code, 5, 'not in the composed catalog until enabled');
      match(err, /not found/);
    });

    it('enabling it makes the submit resolve with the frozen analyzer kind', async () => {
      const proj = await setupProject({ enable: finder.id });
      const { code, err } = await submit(proj, finder.id);
      strictEqual(code, 0, `submit: ${err}`);

      const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
      await adapter.init();
      try {
        const jobs = await adapter.jobs.list({});
        strictEqual(jobs.length, 1);
        strictEqual(jobs[0]!.extensionId, QUALIFIED);
        strictEqual(jobs[0]!.extensionKind, 'analyzer', 'kind frozen at submit');
      } finally {
        await adapter.close();
      }
    });
  });

  describe(`core/${finder.id}, sm plugins show contract sections`, () => {
    it('renders Prompt + Report schema with the finder const', async () => {
      const proj = await setupProject({});
      const out = await withCwd(proj.root, async () => {
        const cap = captureContext();
        const cmd = new PluginsShowCommand();
        cmd.id = QUALIFIED;
        cmd.pluginDir = undefined;
        cmd.json = false;
        cmd.db = undefined;
        strictEqual(await run(cmd, cap), 0, cap.stderr());
        return cap.stdout();
      });
      match(out, /^  Prompt$/m);
      ok(out.includes(finder.opener), 'prompt opener rendered verbatim');
      match(out, /^  Report schema$/m);
      ok(out.includes(`"const": "${finder.type}"`), 'pretty schema shows the type narrowing');
    });
  });

  describe(`core/${finder.id}, record round trip`, () => {
    it('rejects a foreign finding type as report-invalid (schema const narrowing)', async () => {
      const proj = await setupProject({ enable: finder.id });
      strictEqual((await submit(proj, finder.id)).code, 0);

      const { code, err } = await claimAndRecord(proj, {
        confidence: 0.8,
        safety: CLEAN_SAFETY,
        findings: [{ type: FOREIGN_TYPE, severity: 'warn', message: 'wrong judgment' }],
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

    it('lands state_findings rows of the finder type on the happy path', async () => {
      const proj = await setupProject({ enable: finder.id });
      strictEqual((await submit(proj, finder.id)).code, 0);

      const { code, err } = await claimAndRecord(proj, {
        confidence: 0.85,
        safety: CLEAN_SAFETY,
        findings: [
          {
            type: finder.type,
            severity: 'warn',
            message: `One ${finder.type} judgment`,
            detail: 'quoted spans and the proposed resolution',
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
        strictEqual(rows[0]!.extensionId, QUALIFIED);
        strictEqual(rows[0]!.origin, 'extension');
        strictEqual(rows[0]!.type, finder.type);
        strictEqual(rows[0]!.confidence, 0.7, 'per-finding confidence wins');
      } finally {
        await adapter.close();
      }
    });
  });
}
