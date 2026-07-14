/**
 * The fixer batch: `core/node-reconcile` and `core/node-clarify`. Same mold
 * as the FIRST fixer `core/node-consolidate` (see
 * `node-consolidate-builtin.spec.ts`), so the common cases are PARAMETERIZED
 * over the two fixers instead of cloning the file per extension. A fixer is
 * a probabilistic Action declaring `precondition.analyzerIds`
 * (`spec/job-lifecycle.md` §Findings injection for fixers); the kernel
 * injects the node's current non-stale findings from the declared finder(s)
 * into a `## Findings to resolve` section at submit, and the draining agent
 * performs the file edit (skill-map never writes the body).
 *
 * Common cases (per fixer):
 *   - codegen-inlined `promptTemplate` / `reportSchema` byte-/deep-equal to
 *     the authored siblings; the prompt never mentions the literal
 *     user-content delimiter, and the report extends `report-base` (NOT the
 *     findings envelope, a fixer is not a finder).
 *   - ships experimental: DISABLED by default (`sm job submit` exits 5).
 *   - once enabled, submitting over a node with NO matching non-stale
 *     findings refuses with exit 2; a stale-only finding also refuses.
 *   - submitting over a node WITH matching findings injects the
 *     `## Findings to resolve` section (and the prompt) into the job content.
 *   - `sm plugins show` renders the Prompt + Report schema sections.
 *   - a happy-path record round-trip validates the fixer report
 *     (resolved / editsSummary / safety / confidence) and writes NO
 *     `state_findings` of the fixer's own id; an `applied: false`
 *     escape-hatch entry (author decision / missing info) ALSO validates; a
 *     report missing `resolved` fails as report-invalid.
 *
 * Distinctive to `core/node-reconcile` (serves TWO finders): seeding BOTH a
 * `core/node-contradiction` and a `core/node-contraindication` finding on the
 * same node injects BOTH into the one section (the multi-`analyzerIds`
 * selection), while a foreign finding type on the same node is NOT injected.
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
const BODY_HASH = sha256(`Body of ${NOTE.path}\n`);

const HERE = dirname(fileURLToPath(import.meta.url));
const ACTIONS_ROOT = resolve(HERE, '..', '..', '..', 'plugins', 'core', 'actions');

const CLEAN_SAFETY = { injectionDetected: false, contentQuality: 'clean' };

const REPORT_BASE_REF = 'https://skill-map.ai/spec/v0/report-base.schema.json';
const FINDINGS_ENVELOPE_FRAGMENT = 'https://skill-map.ai/spec/v0/findings/';

/**
 * The batch under test. `analyzerIds` is the fixer's declared precondition;
 * `seed` is the single finding used by the common (one-finding) cases,
 * addressed at the FIRST declared finder.
 */
const FIXERS = [
  {
    id: 'node-reconcile',
    opener: 'Resolve the contradiction and contraindication findings listed in the',
    analyzerIds: ['core/node-contradiction', 'core/node-contraindication'],
    seed: {
      extensionId: 'core/node-contradiction',
      type: 'contradiction',
      message: 'Dev and prod install steps conflict',
      detail: '"install with --dev" vs "install with --prod"; separate by environment',
    },
  },
  {
    id: 'node-clarify',
    opener: 'Resolve the incoherence findings listed in the "## Findings to resolve"',
    analyzerIds: ['core/node-incoherence'],
    seed: {
      extensionId: 'core/node-incoherence',
      type: 'incoherence',
      message: 'A step assumes context never stated',
      detail: '"as explained above" with no such explanation; add the missing content',
    },
  },
] as const;

interface ISeed {
  extensionId: string;
  type: string;
  message: string;
  detail: string;
}

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
 * Fresh project with one markdown node. `enable` writes the per-extension
 * operational toggle for the qualified fixer id (each fixer ships
 * experimental, so the installed default is DISABLED).
 */
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
 * Seed one finding against the node. `stale` stamps a mismatched
 * `body_hash_at_generation` so the read-time staleness JOIN hides it (the
 * fixer must then refuse). The `extensionId` decides which finder's lane the
 * finding lands in, so the fixer's `analyzerIds` selection can be exercised.
 */
async function seedFinding(proj: IProject, seed: ISeed, opts?: { stale?: boolean }): Promise<void> {
  const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
  await adapter.init();
  try {
    await adapter.db
      .insertInto('state_findings')
      .values({
        nodeId: NOTE.path,
        extensionId: seed.extensionId,
        extensionVersion: '0.1.0',
        origin: 'extension',
        type: seed.type,
        severity: 'warn',
        message: seed.message,
        detail: seed.detail,
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
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-fixer-batch-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

for (const fixer of FIXERS) {
  const QUALIFIED = `core/${fixer.id}`;
  const ACTION_DIR = join(ACTIONS_ROOT, fixer.id);

  describe(`core/${fixer.id}, codegen inlining pins`, () => {
    it('is a probabilistic experimental fixer with the declared analyzerIds precondition', () => {
      const action = builtIns().actions.find((a) => a.id === fixer.id);
      ok(action, 'built-in registered');
      strictEqual(action.pluginId, 'core');
      strictEqual(action.mode, 'probabilistic');
      strictEqual(action.stability, 'experimental');
      strictEqual(action.probExpectedDurationSeconds, 120);
      deepStrictEqual(action.precondition?.analyzerIds, [...fixer.analyzerIds]);
      // Probabilistic Actions carry NO in-process invoke and NO scan-time project.
      strictEqual(action.invoke, undefined);
      strictEqual(action.project, undefined);
    });

    it('inlines prompt.md byte-equal and report.schema.json deep-equal', () => {
      const action = builtIns().actions.find((a) => a.id === fixer.id);
      ok(action);
      const promptBytes = readFileSync(join(ACTION_DIR, 'prompt.md'), 'utf8');
      strictEqual(action.promptTemplate, promptBytes, 'codegen inlined the exact prompt bytes');
      ok(promptBytes.startsWith(fixer.opener), 'prompt opener matches the approved skeleton');
      deepStrictEqual(
        action.reportSchema,
        JSON.parse(readFileSync(join(ACTION_DIR, 'report.schema.json'), 'utf8')),
      );
      // The prompt avoids the literal `<user-content` delimiter (the render
      // guard rejects it) while keeping the `{{userContent}}` placeholder.
      doesNotMatch(action.promptTemplate ?? '', /<user-content/i);
      ok((action.promptTemplate ?? '').includes('{{userContent}}'), 'carries the placeholder');
    });

    it('the report schema extends report-base, NOT the findings envelope (a fixer is not a finder)', () => {
      const action = builtIns().actions.find((a) => a.id === fixer.id);
      ok(action?.reportSchema);
      const schema = action.reportSchema as {
        allOf?: Array<{ $ref?: string }>;
        required?: string[];
      };
      ok(
        (schema.allOf ?? []).some((s) => s.$ref === REPORT_BASE_REF),
        'reportSchema $refs report-base for the confidence + safety fields',
      );
      const serialized = JSON.stringify(action.reportSchema);
      strictEqual(
        serialized.includes(FINDINGS_ENVELOPE_FRAGMENT),
        false,
        'a fixer report must NOT extend the findings envelope',
      );
      // Execution-only shape: resolved + editsSummary are the required fields.
      deepStrictEqual([...(schema.required ?? [])].sort(), ['editsSummary', 'resolved']);
    });
  });

  describe(`core/${fixer.id}, experimental gate`, () => {
    it('ships DISABLED: sm job submit does not resolve it by default', async () => {
      const proj = await setupProject({});
      await seedFinding(proj, fixer.seed);
      const { code, err } = await submit(proj, fixer.id);
      strictEqual(code, 5, 'not in the composed catalog until enabled');
      match(err, /not found/);
    });
  });

  describe(`core/${fixer.id}, findings injection`, () => {
    it('refuses (exit 2) when the node has no matching findings', async () => {
      const proj = await setupProject({ enable: fixer.id });
      const { code, err } = await submit(proj, fixer.id);
      strictEqual(code, 2, 'no findings to resolve');
      match(err, /no findings to resolve/);
    });

    it('refuses (exit 2) when the only matching finding is stale', async () => {
      const proj = await setupProject({ enable: fixer.id });
      await seedFinding(proj, fixer.seed, { stale: true });
      const { code, err } = await submit(proj, fixer.id);
      strictEqual(code, 2, 'stale findings describe a body that no longer exists');
      match(err, /no findings to resolve/);
    });

    it('injects the ## Findings to resolve section (and the prompt) on a judged node', async () => {
      const proj = await setupProject({ enable: fixer.id });
      await seedFinding(proj, fixer.seed);
      const { code, err } = await submit(proj, fixer.id);
      strictEqual(code, 0, `submit: ${err}`);

      const content = await jobContent(proj);
      // The fixer prompt template rendered.
      ok(content.includes(fixer.opener), 'prompt opener rendered');
      // The kernel-authored findings section, before the user-content block.
      match(content, /## Findings to resolve/);
      ok(content.includes(fixer.seed.message), 'the seeded finding message is injected');
      ok(content.includes(`"type": "${fixer.seed.type}"`), 'the finding type is projected');
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

  describe(`core/${fixer.id}, sm plugins show contract sections`, () => {
    it('renders Prompt + Report schema for the built-in fixer', async () => {
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
      ok(out.includes(fixer.opener), 'prompt opener rendered verbatim');
      match(out, /^  Report schema$/m);
      match(out, /"editsSummary"/, 'pretty schema shows the fixer report fields');
    });
  });

  describe(`core/${fixer.id}, record round trip`, () => {
    it('validates the fixer report (resolved / editsSummary / safety / confidence)', async () => {
      const proj = await setupProject({ enable: fixer.id });
      await seedFinding(proj, fixer.seed);
      strictEqual((await submit(proj, fixer.id)).code, 0);

      const { code, err } = await claimAndRecord(proj, {
        confidence: 0.9,
        safety: CLEAN_SAFETY,
        resolved: [
          { type: fixer.seed.type, applied: true, note: 'Edited the flagged spans; meaning preserved.' },
        ],
        editsSummary: 'Applied the proposed fix to the node body.',
      });
      strictEqual(code, 0, err);

      const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
      await adapter.init();
      try {
        const jobs = await adapter.jobs.list({});
        strictEqual(jobs[0]!.status, 'completed');
        // A fixer is execution-only: no findings write-through for its own id.
        strictEqual(
          (await adapter.findings.list({ includeStale: true, extensionIds: [QUALIFIED] })).length,
          0,
          'the fixer writes no state_findings rows of its own',
        );
      } finally {
        await adapter.close();
      }
    });

    it('validates an `applied: false` escape-hatch entry (declined with a note)', async () => {
      const proj = await setupProject({ enable: fixer.id });
      await seedFinding(proj, fixer.seed);
      strictEqual((await submit(proj, fixer.id)).code, 0);

      const { code, err } = await claimAndRecord(proj, {
        confidence: 0.4,
        safety: CLEAN_SAFETY,
        resolved: [
          {
            type: fixer.seed.type,
            applied: false,
            note: 'Needs an author decision; left the document untouched.',
          },
        ],
        editsSummary: '',
      });
      strictEqual(code, 0, err);

      const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
      await adapter.init();
      try {
        const jobs = await adapter.jobs.list({});
        strictEqual(jobs[0]!.status, 'completed', 'a declined finding is a valid report, not a failure');
      } finally {
        await adapter.close();
      }
    });

    it('fails a report missing `resolved` as report-invalid', async () => {
      const proj = await setupProject({ enable: fixer.id });
      await seedFinding(proj, fixer.seed);
      strictEqual((await submit(proj, fixer.id)).code, 0);

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
}

// Distinctive to `core/node-reconcile`: it serves TWO finders, so the
// `analyzerIds` array must select findings from BOTH lanes into the one
// section, and only those lanes.
describe('core/node-reconcile, multi-analyzerIds selection', () => {
  const CONTRADICTION: ISeed = {
    extensionId: 'core/node-contradiction',
    type: 'contradiction',
    message: 'Dev and prod install steps conflict',
    detail: 'keep one, or split by environment',
  };
  const CONTRAINDICATION: ISeed = {
    extensionId: 'core/node-contraindication',
    type: 'contraindication',
    message: 'Retry and idempotency guidance are jointly risky',
    detail: 'add the missing guard so the combination is safe',
  };
  // A finding from a finder OUTSIDE node-reconcile's analyzerIds.
  const FOREIGN: ISeed = {
    extensionId: 'core/node-redundancy',
    type: 'redundancy',
    message: 'The upload step is stated twice',
    detail: 'collapse into one',
  };

  it('injects findings from BOTH declared finders but not a foreign type', async () => {
    const proj = await setupProject({ enable: 'node-reconcile' });
    await seedFinding(proj, CONTRADICTION);
    await seedFinding(proj, CONTRAINDICATION);
    await seedFinding(proj, FOREIGN);

    const { code, err } = await submit(proj, 'node-reconcile');
    strictEqual(code, 0, `submit: ${err}`);

    const content = await jobContent(proj);
    match(content, /## Findings to resolve/);
    // Both declared-finder lanes land in the one section.
    ok(content.includes(CONTRADICTION.message), 'contradiction finding injected');
    ok(content.includes(CONTRAINDICATION.message), 'contraindication finding injected');
    ok(content.includes('"type": "contradiction"'), 'contradiction type projected');
    ok(content.includes('"type": "contraindication"'), 'contraindication type projected');
    // The foreign redundancy finding (outside the analyzerIds) is excluded.
    doesNotMatch(content, /The upload step is stated twice/);
    doesNotMatch(content, /"type": "redundancy"/);
  });
});
