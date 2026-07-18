/**
 * `core/ai-redundancy-action`, the FIRST fixer (a probabilistic Action
 * declaring `precondition.analyzerIds`, `spec/job-lifecycle.md` §Findings
 * injection for fixers). End-to-end characterisation through the real CLI
 * verbs plus the codegen inlining pins:
 *
 *   - ships experimental: DISABLED by default, `sm jobs submit
 *     ai-redundancy-action` does not resolve until the operator enables it.
 *   - once enabled, submitting over a node WITH `ai-redundancy-analyzer` findings
 *     injects the `## Findings to resolve` section (and the prompt) into
 *     the rendered job content, each entry flagged with its `stale`.
 *   - a STALE-only finding set still submits (staleness is node-level, so a
 *     sibling fixer's edit stales judgments whose defects are still there);
 *     only a node with NO matching findings at all is refused with exit 2.
 *   - `sm plugins show core/ai-redundancy-action` renders the Prompt + Report
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
import type { IFindingRecord } from '../../../kernel/types/storage.js';
import { sha256 } from '../../../kernel/orchestrator/node-build.js';
import { builtIns } from '../../../plugins/built-ins.js';
import { installAgentSkill } from '../../../core/agent-skill/engine.js';

const FIXER_ID = 'core/ai-redundancy-action';
const FINDER_ID = 'core/ai-redundancy-analyzer';
const NOTE = { path: 'notes/guide.md', kind: 'markdown', provider: 'markdown' };
const BODY_HASH = sha256(`Body of ${NOTE.path}\n`);

const HERE = dirname(fileURLToPath(import.meta.url));
const ACTION_DIR = resolve(HERE, '..', '..', '..', 'plugins', 'core', 'actions', 'ai-redundancy-action');

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
  // Processing-agent gate (spec/job-lifecycle.md §Submit): submits refuse
  // unless the processing skill is installed; materialise the canonical copy.
  installAgentSkill(root, '.claude/skills');
  if (opts.enableFixer) {
    writeFileSync(
      join(root, '.skill-map', 'settings.json'),
      JSON.stringify({
        plugins: { core: { extensions: { 'ai-redundancy-action': { enabled: true } } } },
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
 * Seed one `core/ai-redundancy-analyzer` finding against the node and return its
 * autoincrement `id`: what the fixer echoes back in `resolved[]`, and what
 * the resolution stamps key on. `stale` stamps a mismatched
 * `body_hash_at_generation` so the read-time staleness JOIN flags the row
 * (the fixer still injects it, marked `"stale": true`); `extensionId` /
 * `nodeId` override the row's scope so the record-path guards can be
 * exercised.
 */
async function seedRedundancyFinding(
  proj: IProject,
  opts?: { stale?: boolean; extensionId?: string; nodeId?: string; message?: string },
): Promise<number> {
  const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
  await adapter.init();
  try {
    const row = await adapter.db
      .insertInto('state_findings')
      .values({
        nodeId: opts?.nodeId ?? NOTE.path,
        extensionId: opts?.extensionId ?? FINDER_ID,
        extensionVersion: '0.1.0',
        origin: 'extension',
        type: 'redundancy',
        severity: 'info',
        message: opts?.message ?? 'The upload step is stated twice',
        detail: '"Upload it" vs "Upload the artifact"; keep one',
        confidence: 0.7,
        model: null,
        bodyHashAtGeneration: opts?.stale ? 'z'.repeat(64) : BODY_HASH,
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

/** The stored finding row by id (resolution stamps included), or null. */
async function readFinding(proj: IProject, id: number): Promise<IFindingRecord | null> {
  const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
  await adapter.init();
  try {
    const all = await adapter.findings.list({ includeStale: true });
    return all.find((f) => f.id === id) ?? null;
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
    claim.wait = false;
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
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-ai-redundancy-action-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('core/ai-redundancy-action, codegen inlining pins', () => {
  it('is a probabilistic experimental fixer with the ai-redundancy-analyzer precondition', () => {
    const action = builtIns().actions.find((a) => a.id === 'ai-redundancy-action');
    ok(action, 'built-in registered');
    strictEqual(action.pluginId, 'core');
    strictEqual(action.mode, 'probabilistic');
    strictEqual(action.stability, 'experimental');
    strictEqual(action.probExpectedDurationSeconds, 120);
    deepStrictEqual(action.precondition?.analyzerIds, ['core/ai-redundancy-analyzer']);
    // Probabilistic Actions carry NO in-process invoke and NO scan-time project.
    strictEqual(action.invoke, undefined);
    strictEqual(action.project, undefined);
  });

  it('inlines prompt.md byte-equal and report.schema.json deep-equal', () => {
    const action = builtIns().actions.find((a) => a.id === 'ai-redundancy-action');
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
    // The stale-verification instruction rides the template: without it the
    // agent would act on a flagged finding without checking the body first.
    // (Byte-identity across all three fixers is pinned in
    // `fixer-batch-builtin.spec.ts`.)
    ok(
      (action.promptTemplate ?? '').includes('A finding marked `"stale": true`'),
      'the prompt instructs the agent to verify a stale finding before acting',
    );
    ok((action.promptTemplate ?? '').includes('{{userContent}}'), 'carries the placeholder');
  });
});

describe('core/ai-redundancy-action, experimental gate', () => {
  it('ships DISABLED: sm jobs submit does not resolve it by default', async () => {
    const proj = await setupProject({ enableFixer: false });
    await seedRedundancyFinding(proj);
    const { code, err } = await submit(proj, 'ai-redundancy-action');
    strictEqual(code, 5, 'not in the composed catalog until enabled');
    match(err, /not found/);
  });
});

describe('core/ai-redundancy-action, findings injection', () => {
  it('refuses (exit 2) when the node has no matching findings', async () => {
    const proj = await setupProject({ enableFixer: true });
    const { code, err } = await submit(proj, 'ai-redundancy-action');
    strictEqual(code, 2, 'no findings to resolve');
    match(err, /no findings to resolve for core\/ai-redundancy-analyzer on notes\/guide\.md/);
  });

  it('refuses (exit 2) when only a finder outside its analyzerIds judged the node', async () => {
    // Staleness relaxed, the lane filters did NOT: a node whose only rows
    // belong to another finder is still a never-judged node for THIS fixer.
    // (The kernel-safety-lane half of that guard is pinned at unit level in
    // `kernel/jobs/__tests__/findings-injection.spec.ts`; this seeder only
    // writes `origin: 'extension'` rows.)
    const proj = await setupProject({ enableFixer: true });
    await seedRedundancyFinding(proj, { extensionId: 'core/ai-incoherence-analyzer' });
    const { code, err } = await submit(proj, 'ai-redundancy-action');
    strictEqual(code, 2, 'no ai-redundancy-analyzer finding to resolve');
    match(err, /no findings to resolve for core\/ai-redundancy-analyzer on notes\/guide\.md/);
  });

  it('SUBMITS when the only matching finding is stale, flagging it for verification', async () => {
    // The live scenario this behaviour exists for: fixer 1 edited one
    // section, which staled EVERY finding on the node (staleness is
    // node-level), including this one about an untouched section whose
    // defect is still verbatim present. Refusing here would discard a valid
    // judgment and force a re-detection between every fix.
    const proj = await setupProject({ enableFixer: true });
    const id = await seedRedundancyFinding(proj, { stale: true });
    const { code, err } = await submit(proj, 'ai-redundancy-action');
    strictEqual(code, 0, `a stale finding is still a finding to resolve: ${err}`);

    const content = await jobContent(proj);
    match(content, /## Findings to resolve/);
    ok(content.includes(`"id": ${id}`), 'the stale finding is injected');
    ok(content.includes('"stale": true'), 'flagged so the agent verifies it against the body');
    // The prompt carries the matching instruction (see the codegen pin).
    match(content, /A finding marked `"stale": true` was judged against an earlier version/);
  });

  it('flags a fresh finding `"stale": false`', async () => {
    const proj = await setupProject({ enableFixer: true });
    await seedRedundancyFinding(proj);
    strictEqual((await submit(proj, 'ai-redundancy-action')).code, 0);
    const content = await jobContent(proj);
    ok(content.includes('"stale": false'), 'a fresh judgment needs no re-verification');
  });

  it('injects a MIXED set (fresh + stale) in deterministic id order', async () => {
    const proj = await setupProject({ enableFixer: true });
    const freshId = await seedRedundancyFinding(proj, { message: 'A fresh judgment' });
    const staleId = await seedRedundancyFinding(proj, {
      stale: true,
      message: 'Judged before the last edit',
    });
    strictEqual((await submit(proj, 'ai-redundancy-action')).code, 0);

    const content = await jobContent(proj);
    ok(content.includes('A fresh judgment'), 'fresh finding injected');
    ok(content.includes('Judged before the last edit'), 'stale finding injected alongside it');
    ok(
      content.indexOf(`"id": ${freshId}`) < content.indexOf(`"id": ${staleId}`),
      'id ascending, so the rendered bytes reproduce',
    );
    ok(content.includes('"stale": false') && content.includes('"stale": true'), 'each flagged on its own');
  });

  it('injects the ## Findings to resolve section (and the prompt) on a judged node', async () => {
    const proj = await setupProject({ enableFixer: true });
    const id = await seedRedundancyFinding(proj);
    const { code, err } = await submit(proj, 'ai-redundancy-action');
    strictEqual(code, 0, `submit: ${err}`);

    const content = await jobContent(proj);
    // The fixer prompt template rendered.
    match(content, /Resolve the redundancy findings listed in the/);
    // The kernel-authored findings section, before the user-content block.
    match(content, /## Findings to resolve/);
    match(content, /The upload step is stated twice/);
    // The `id` rides the projection and the prompt asks for it back: that
    // round trip is what lets the record path stamp this row.
    ok(content.includes(`"id": ${id}`), 'the finding id is projected');
    match(
      content,
      /copied\s+verbatim, a .state. of .fixed./,
      'the prompt asks for the id and its lifecycle state back',
    );
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

describe('core/ai-redundancy-action, sm plugins show contract sections', () => {
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

describe('core/ai-redundancy-action, record round trip', () => {
  it('validates the fixer report (resolved / editsSummary / safety / confidence)', async () => {
    const proj = await setupProject({ enableFixer: true });
    const id = await seedRedundancyFinding(proj);
    strictEqual((await submit(proj, 'ai-redundancy-action')).code, 0);

    const { code, err } = await claimAndRecord(proj, {
      confidence: 0.9,
      safety: CLEAN_SAFETY,
      resolved: [
        { id, type: 'redundancy', state: 'fixed', by: 'fixer', note: 'Collapsed the two upload sentences into one.' },
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

  it('rejects a resolved[] entry without an `id` as report-invalid', async () => {
    // The id is what ties the claim to a finding; an entry without one is
    // unattributable, so the schema requires it.
    const proj = await setupProject({ enableFixer: true });
    await seedRedundancyFinding(proj);
    strictEqual((await submit(proj, 'ai-redundancy-action')).code, 0);

    const { code, err } = await claimAndRecord(proj, {
      confidence: 0.9,
      safety: CLEAN_SAFETY,
      resolved: [{ type: 'redundancy', state: 'fixed', by: 'fixer', note: 'no id echoed' }],
      editsSummary: 'x',
    });
    strictEqual(code, 2, 'report-invalid exit');
    match(err, /report failed schema validation/);
  });

  it('rejects a `fixed` entry that omits `by` as report-invalid', async () => {
    // Decision #143: `by` (the deciding actor) is REQUIRED when state is
    // `fixed` (schema `if/then`). An entry that omits it must fail cleanly,
    // never stamp a coerced actor.
    const proj = await setupProject({ enableFixer: true });
    const id = await seedRedundancyFinding(proj);
    strictEqual((await submit(proj, 'ai-redundancy-action')).code, 0);

    const { code, err } = await claimAndRecord(proj, {
      confidence: 0.9,
      safety: CLEAN_SAFETY,
      resolved: [{ id, state: 'fixed', note: 'fixed but no actor declared' }],
      editsSummary: 'x',
    });
    strictEqual(code, 2, 'report-invalid exit: `by` is required when fixed');
    match(err, /report failed schema validation/);
    strictEqual((await readFinding(proj, id))?.resolution, null, 'no coerced state landed');
  });

  it('rejects the OLD `applied` boolean shape (no `state`) as report-invalid', async () => {
    // The lifecycle refactor (Decision #142) replaced the `applied` boolean
    // with a required `state` enum: an agent still emitting the old shape
    // must fail cleanly, not stamp a coerced state.
    const proj = await setupProject({ enableFixer: true });
    const id = await seedRedundancyFinding(proj);
    strictEqual((await submit(proj, 'ai-redundancy-action')).code, 0);

    const { code, err } = await claimAndRecord(proj, {
      confidence: 0.9,
      safety: CLEAN_SAFETY,
      resolved: [{ id, applied: true, note: 'old boolean shape, no state field' }],
      editsSummary: 'x',
    });
    strictEqual(code, 2, 'report-invalid exit: state is required');
    match(err, /report failed schema validation/);
    // Nothing was stamped: the row is still open.
    strictEqual((await readFinding(proj, id))?.resolution, null, 'no coerced state landed');
  });

  it('rejects an out-of-enum `state` value as report-invalid', async () => {
    const proj = await setupProject({ enableFixer: true });
    const id = await seedRedundancyFinding(proj);
    strictEqual((await submit(proj, 'ai-redundancy-action')).code, 0);

    const { code, err } = await claimAndRecord(proj, {
      confidence: 0.9,
      safety: CLEAN_SAFETY,
      resolved: [{ id, state: 'applied', note: 'not one of fixed / human-decision' }],
      editsSummary: 'x',
    });
    strictEqual(code, 2, 'report-invalid exit: state is a closed enum');
    match(err, /report failed schema validation/);
  });

  it('fails a report missing `resolved` as report-invalid', async () => {
    const proj = await setupProject({ enableFixer: true });
    await seedRedundancyFinding(proj);
    strictEqual((await submit(proj, 'ai-redundancy-action')).code, 0);

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

/**
 * The resolution stamps (`spec/db-schema.md` §state_findings, "Finding
 * lifecycle state"): a real record round-trip must land the fixer's
 * declared STATE + deciding ACTOR ON the finding it addressed, and the
 * scope guards must skip anything outside the fixer's own lane WITHOUT
 * failing the job (its edits already hit the disk; a storage-scope mismatch
 * is not the processing agent's error to bounce on).
 */
describe('core/ai-redundancy-action, fixer resolution stamps', () => {
  it('stamps `fixed` + actor `fixer` onto the finding the report named', async () => {
    const proj = await setupProject({ enableFixer: true });
    const id = await seedRedundancyFinding(proj);
    strictEqual((await submit(proj, 'ai-redundancy-action')).code, 0);

    const { code, err } = await claimAndRecord(proj, {
      confidence: 0.9,
      safety: CLEAN_SAFETY,
      resolved: [{ id, state: 'fixed', by: 'fixer', note: 'Collapsed the two upload sentences into one.' }],
      editsSummary: 'Merged the duplicated upload instruction.',
    });
    strictEqual(code, 0, err);

    const row = await readFinding(proj, id);
    ok(row, 'the finding survives: a fixed state never deletes it');
    strictEqual(row.resolution, 'fixed');
    strictEqual(row.resolutionActor, 'fixer', 'a zero-interaction fix is attributed to the fixer');
    strictEqual(row.resolutionNote, 'Collapsed the two upload sentences into one.');
    strictEqual(row.resolutionBy, FIXER_ID, 'attributed to the fixer\'s qualified id');
    ok(typeof row.resolutionAt === 'number' && row.resolutionAt > 0, 'stamped with a time');
  });

  it('stamps actor `human` on a fixed entry that declares `by: human`', async () => {
    // Any user interaction (an approval, a choice among options, an operator
    // edit) makes a fixed row `human` even when the agent's tools typed it.
    const proj = await setupProject({ enableFixer: true });
    const id = await seedRedundancyFinding(proj);
    strictEqual((await submit(proj, 'ai-redundancy-action')).code, 0);

    const { code, err } = await claimAndRecord(proj, {
      confidence: 0.9,
      safety: CLEAN_SAFETY,
      resolved: [{ id, state: 'fixed', by: 'human', note: 'Operator approved the collapse.' }],
      editsSummary: 'Applied the approved edit.',
    });
    strictEqual(code, 0, err);

    const row = await readFinding(proj, id);
    strictEqual(row?.resolution, 'fixed');
    strictEqual(row?.resolutionActor, 'human', 'a user-interaction fix is attributed to the human');
    strictEqual(row?.resolutionBy, FIXER_ID, 'the fixer that ran is still recorded');
  });

  it('stamps `human-decision` with the note verbatim (the author\'s TODO), actor NULL', async () => {
    const proj = await setupProject({ enableFixer: true });
    const id = await seedRedundancyFinding(proj);
    strictEqual((await submit(proj, 'ai-redundancy-action')).code, 0);

    const note = 'Both phrasings carry a distinct scope; only the author can pick one.';
    const { code, err } = await claimAndRecord(proj, {
      confidence: 0.4,
      safety: CLEAN_SAFETY,
      resolved: [{ id, state: 'human-decision', note }],
      editsSummary: '',
    });
    strictEqual(code, 0, err);

    const row = await readFinding(proj, id);
    ok(row);
    strictEqual(row.resolution, 'human-decision');
    strictEqual(row.resolutionActor, null, 'a human-decision is undecided: no actor');
    strictEqual(row.resolutionNote, note, 'the note is stored verbatim, never reworded');
    strictEqual(row.resolutionBy, FIXER_ID);
  });

  it('stamps a MIXED report per entry (one fixed, one human-decision)', async () => {
    const proj = await setupProject({ enableFixer: true });
    const fixedId = await seedRedundancyFinding(proj, { message: 'Upload stated twice' });
    const pending = await seedRedundancyFinding(proj, { message: 'Retry policy stated twice' });
    strictEqual((await submit(proj, 'ai-redundancy-action')).code, 0);

    const { code, err } = await claimAndRecord(proj, {
      confidence: 0.8,
      safety: CLEAN_SAFETY,
      resolved: [
        { id: fixedId, state: 'fixed', by: 'fixer', note: 'Collapsed into one statement.' },
        { id: pending, state: 'human-decision', note: 'The two retry limits conflict; your call.' },
      ],
      editsSummary: 'Collapsed the upload duplication only.',
    });
    strictEqual(code, 0, err);

    const fixedRow = await readFinding(proj, fixedId);
    const pendingRow = await readFinding(proj, pending);
    strictEqual(fixedRow?.resolution, 'fixed');
    strictEqual(fixedRow?.resolutionActor, 'fixer');
    strictEqual(fixedRow?.resolutionNote, 'Collapsed into one statement.');
    strictEqual(pendingRow?.resolution, 'human-decision');
    strictEqual(pendingRow?.resolutionActor, null);
    strictEqual(pendingRow?.resolutionNote, 'The two retry limits conflict; your call.');
  });

  it('leaves an unaddressed finding unstamped (resolution stays null)', async () => {
    const proj = await setupProject({ enableFixer: true });
    const addressed = await seedRedundancyFinding(proj, { message: 'Upload stated twice' });
    const ignored = await seedRedundancyFinding(proj, { message: 'Retry policy stated twice' });
    strictEqual((await submit(proj, 'ai-redundancy-action')).code, 0);

    strictEqual(
      (
        await claimAndRecord(proj, {
          confidence: 0.8,
          safety: CLEAN_SAFETY,
          resolved: [{ id: addressed, state: 'fixed', by: 'fixer', note: 'Collapsed it.' }],
          editsSummary: 'One edit.',
        })
      ).code,
      0,
    );

    strictEqual((await readFinding(proj, addressed))?.resolution, 'fixed');
    strictEqual((await readFinding(proj, ignored))?.resolution, null, 'never touched');
  });

  it('SKIPS an unknown id silently (a benign race: the finder re-ran)', async () => {
    const proj = await setupProject({ enableFixer: true });
    const id = await seedRedundancyFinding(proj);
    strictEqual((await submit(proj, 'ai-redundancy-action')).code, 0);

    const { code, err } = await claimAndRecord(proj, {
      confidence: 0.9,
      safety: CLEAN_SAFETY,
      resolved: [
        { id: 999_999, state: 'fixed', by: 'fixer', note: 'resolves a finding that no longer exists' },
        { id, state: 'fixed', by: 'fixer', note: 'this one is real' },
      ],
      editsSummary: 'Edited.',
    });
    // The job still completes: the fixer's edits already landed on disk.
    strictEqual(code, 0, err);
    strictEqual((await readFinding(proj, id))?.resolutionNote, 'this one is real');
  });

  it('SKIPS a finding on ANOTHER node (defensive scope)', async () => {
    const proj = await setupProject({ enableFixer: true });
    const own = await seedRedundancyFinding(proj);
    // A same-finder finding, but on a node this job does not target.
    const foreign = await seedRedundancyFinding(proj, { nodeId: 'notes/other.md' });
    strictEqual((await submit(proj, 'ai-redundancy-action')).code, 0);

    const { code, err } = await claimAndRecord(proj, {
      confidence: 0.9,
      safety: CLEAN_SAFETY,
      resolved: [
        { id: own, state: 'fixed', by: 'fixer', note: 'in scope' },
        { id: foreign, state: 'fixed', by: 'fixer', note: 'out of scope: another node' },
      ],
      editsSummary: 'Edited.',
    });
    strictEqual(code, 0, err);
    strictEqual((await readFinding(proj, own))?.resolution, 'fixed');
    strictEqual(
      (await readFinding(proj, foreign))?.resolution,
      null,
      'a fixer can never stamp a finding outside the job\'s node',
    );
  });

  it('SKIPS a finding from a finder outside its analyzerIds (defensive scope)', async () => {
    const proj = await setupProject({ enableFixer: true });
    const own = await seedRedundancyFinding(proj);
    // Same node, but judged by a finder ai-redundancy-action does not serve.
    const foreign = await seedRedundancyFinding(proj, {
      extensionId: 'core/ai-contradiction-analyzer',
      message: 'Dev and prod steps conflict',
    });
    strictEqual((await submit(proj, 'ai-redundancy-action')).code, 0);

    const { code, err } = await claimAndRecord(proj, {
      confidence: 0.9,
      safety: CLEAN_SAFETY,
      resolved: [
        { id: own, state: 'fixed', by: 'fixer', note: 'in scope' },
        { id: foreign, state: 'fixed', by: 'fixer', note: 'out of scope: another finder' },
      ],
      editsSummary: 'Edited.',
    });
    strictEqual(code, 0, err);
    strictEqual((await readFinding(proj, own))?.resolution, 'fixed');
    strictEqual(
      (await readFinding(proj, foreign))?.resolution,
      null,
      'a fixer can never stamp findings from a finder it does not declare',
    );
  });
});
