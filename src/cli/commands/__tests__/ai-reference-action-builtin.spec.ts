/**
 * `core/ai-reference-action`, the FIRST deterministic-analyzer fixer (a
 * probabilistic Action declaring `precondition.analyzerIds` that reference a
 * DETERMINISTIC analyzer, `spec/job-lifecycle.md` §Findings injection for
 * fixers, the deterministic case). Unlike the finder-paired fixers its
 * submit-time trigger is `core/reference-broken`'s `scan_issues` rows injected
 * as a `## Issues to resolve` section (NOT `state_findings` / `## Findings to
 * resolve`), and its report keys each entry on the broken `target` string (an
 * Issue carries no stable id): nothing is stamped at record, the fix's
 * evidence is the next scan clearing the Issue. End-to-end through the real
 * CLI verbs plus the codegen inlining pins:
 *
 *   - ships EXPERIMENTAL: DISABLED by default, `sm jobs submit
 *     ai-reference-action` refuses (exit 5) until the operator opts in.
 *   - enabling + submitting over a node WITH a `core/reference-broken` Issue
 *     injects the `## Issues to resolve` section (with the broken target) and
 *     queues (exit 0).
 *   - submitting over a node with NO reference-broken Issue refuses (exit 2,
 *     the content-agnostic no-findings gate).
 *   - a happy-path record round-trip validates the fixer report
 *     (resolved keyed on target / editsSummary / safety / confidence); a
 *     report keyed on a finding `id` (no `target`) or a `fixed` entry missing
 *     `by` fails as report-invalid, and the job closes WITHOUT stamping.
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
import { SqliteStorageAdapter } from '../../../kernel/adapters/sqlite/index.js';
import { sha256 } from '../../../kernel/orchestrator/node-build.js';
import { builtIns } from '../../../plugins/built-ins.js';
import { installAgentSkill } from '../../../core/agent-skill/engine.js';

const FIXER_ID = 'core/ai-reference-action';
const ANALYZER_ID_SHORT = 'reference-broken';
const BROKEN_TARGET = 'docs/missing.md';
const NOTE = { path: 'notes/guide.md', kind: 'markdown', provider: 'markdown' };
const BODY_HASH = sha256(`Body of ${NOTE.path}\n`);

const HERE = dirname(fileURLToPath(import.meta.url));
const ACTION_DIR = resolve(HERE, '..', '..', '..', 'plugins', 'core', 'actions', 'ai-reference-action');

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
 * Fresh project with one markdown node. The fixer ships EXPERIMENTAL
 * (disabled by default), so `enableFixer` writes an explicit enable toggle to
 * fold it into the composed catalog.
 */
async function setupProject(opts: { enableFixer?: boolean }): Promise<IProject> {
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
        plugins: { core: { extensions: { 'ai-reference-action': { enabled: true } } } },
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
 * Seed one `core/reference-broken` Issue against the node, mirroring how the
 * scan persists it: the analyzerId is stored SHORT (`reference-broken`), the
 * node scope rides `node_ids_json`, and the `data` payload is the rule's own
 * `{ target, kind, trigger }` (see `plugins/core/analyzers/reference-broken`).
 * `analyzerId` / `nodeId` overrides exercise the selection guards.
 */
async function seedReferenceBrokenIssue(
  proj: IProject,
  opts?: { analyzerId?: string; nodeId?: string; target?: string; kind?: string },
): Promise<void> {
  const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
  await adapter.init();
  try {
    const target = opts?.target ?? BROKEN_TARGET;
    const kind = opts?.kind ?? 'references';
    await adapter.db
      .insertInto('scan_issues')
      .values({
        analyzerId: opts?.analyzerId ?? ANALYZER_ID_SHORT,
        severity: 'error',
        nodeIdsJson: JSON.stringify([opts?.nodeId ?? NOTE.path]),
        linkIndicesJson: null,
        message: `references arrow points at "${target}" which is not in the scan`,
        detail: null,
        fixJson: null,
        dataJson: JSON.stringify({ target, kind, trigger: null }),
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
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-ai-reference-action-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('core/ai-reference-action, codegen inlining pins', () => {
  it('is a probabilistic experimental fixer with the reference-broken precondition', () => {
    const action = builtIns().actions.find((a) => a.id === 'ai-reference-action');
    ok(action, 'built-in registered');
    strictEqual(action.pluginId, 'core');
    strictEqual(action.mode, 'probabilistic');
    strictEqual(action.stability, 'experimental');
    strictEqual(action.probExpectedDurationSeconds, 120);
    deepStrictEqual(action.precondition?.analyzerIds, ['core/reference-broken']);
    // Probabilistic Actions carry NO in-process invoke and NO scan-time project.
    strictEqual(action.invoke, undefined);
    strictEqual(action.project, undefined);
  });

  it('inlines prompt.md byte-equal and report.schema.json deep-equal', () => {
    const action = builtIns().actions.find((a) => a.id === 'ai-reference-action');
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
    // The prompt drives the `## Issues to resolve` section and avoids the
    // literal `<user-content` delimiter (the render guard rejects it) while
    // keeping the `{{userContent}}` placeholder.
    ok(!/<user-content/i.test(action.promptTemplate ?? ''), 'no literal delimiter in the template');
    ok((action.promptTemplate ?? '').includes('## Issues to resolve'), 'template references the injected section');
    ok((action.promptTemplate ?? '').includes('{{userContent}}'), 'carries the placeholder');
  });
});

describe('core/ai-reference-action, experimental, disabled by default', () => {
  it('ships DISABLED: sm jobs submit refuses (exit 5) until opted in', async () => {
    const proj = await setupProject({ enableFixer: false });
    await seedReferenceBrokenIssue(proj);
    const { code, err } = await submit(proj, 'ai-reference-action');
    strictEqual(code, 5, 'an experimental fixer is not in the composed catalog');
    match(err, /not found/);
  });

  it('enabling it folds the fixer into the composed catalog (submit resolves)', async () => {
    const proj = await setupProject({ enableFixer: true });
    await seedReferenceBrokenIssue(proj);
    const { code, err } = await submit(proj, 'ai-reference-action');
    strictEqual(code, 0, `submit: ${err}`);

    const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
    await adapter.init();
    try {
      const jobs = await adapter.jobs.list({});
      strictEqual(jobs.length, 1);
      strictEqual(jobs[0]!.extensionId, FIXER_ID);
      strictEqual(jobs[0]!.extensionKind, 'action', 'kind frozen at submit');
    } finally {
      await adapter.close();
    }
  });
});

describe('core/ai-reference-action, issue injection', () => {
  it('refuses (exit 2) when the node has no reference-broken Issue', async () => {
    const proj = await setupProject({ enableFixer: true });
    const { code, err } = await submit(proj, 'ai-reference-action');
    strictEqual(code, 2, 'no issues to resolve');
    match(err, /no findings to resolve for core\/reference-broken on notes\/guide\.md/);
  });

  it('refuses (exit 2) when only another analyzer flagged the node', async () => {
    // A node whose only Issue belongs to a different analyzer is still a
    // never-flagged node for THIS fixer (the analyzer-id match filters it out).
    const proj = await setupProject({ enableFixer: true });
    await seedReferenceBrokenIssue(proj, { analyzerId: 'schema-violation' });
    const { code, err } = await submit(proj, 'ai-reference-action');
    strictEqual(code, 2, 'no reference-broken issue to resolve');
    match(err, /no findings to resolve for core\/reference-broken on notes\/guide\.md/);
  });

  it('injects the ## Issues to resolve section (with the broken target) on a flagged node', async () => {
    const proj = await setupProject({ enableFixer: true });
    await seedReferenceBrokenIssue(proj);
    const { code, err } = await submit(proj, 'ai-reference-action');
    strictEqual(code, 0, `submit: ${err}`);

    const content = await jobContent(proj);
    // The fixer prompt template rendered.
    match(content, /Resolve the broken references listed in the/);
    // The kernel-authored ISSUES section (not the findings one).
    match(content, /## Issues to resolve/);
    ok(!content.includes('## Findings to resolve'), 'a deterministic-analyzer fixer injects Issues, not findings');
    // The broken target rides the projection (keyed on `target`, no id).
    ok(content.includes(`"target": "${BROKEN_TARGET}"`), 'the broken target is projected');
    ok(content.includes('"severity": "error"'), 'the issue severity rides the projection');
    const blockOpen = `<user-content id="${NOTE.path}">`;
    ok(content.includes(blockOpen), 'user-content block present');
    // The issues section sits OUTSIDE (before) the user-content block.
    ok(
      content.indexOf('## Issues to resolve') < content.indexOf(blockOpen),
      'issues render before the user-content block',
    );
  });

  it('injects multiple broken targets in deterministic order', async () => {
    const proj = await setupProject({ enableFixer: true });
    await seedReferenceBrokenIssue(proj, { target: 'docs/zeta.md' });
    await seedReferenceBrokenIssue(proj, { target: 'docs/alpha.md' });
    strictEqual((await submit(proj, 'ai-reference-action')).code, 0);

    const content = await jobContent(proj);
    ok(content.includes('"target": "docs/alpha.md"'), 'alpha injected');
    ok(content.includes('"target": "docs/zeta.md"'), 'zeta injected');
    ok(
      content.indexOf('docs/alpha.md') < content.indexOf('docs/zeta.md'),
      'targets sorted so the rendered bytes reproduce',
    );
  });
});

describe('core/ai-reference-action, record round trip', () => {
  it('validates a well-formed report keyed on target (fixed / by / editsSummary)', async () => {
    const proj = await setupProject({ enableFixer: true });
    await seedReferenceBrokenIssue(proj);
    strictEqual((await submit(proj, 'ai-reference-action')).code, 0);

    const { code, err } = await claimAndRecord(proj, {
      confidence: 0.9,
      safety: CLEAN_SAFETY,
      resolved: [
        { target: BROKEN_TARGET, kind: 'references', state: 'fixed', by: 'fixer', note: 'Repointed to docs/guide.md.' },
      ],
      editsSummary: 'Repointed the broken docs link to its real path.',
    });
    strictEqual(code, 0, err);

    const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
    await adapter.init();
    try {
      const jobs = await adapter.jobs.list({});
      strictEqual(jobs[0]!.status, 'completed');
      // A deterministic-analyzer fixer stamps NOTHING: no finding id to key on,
      // the fix's evidence is the next scan clearing the Issue.
      strictEqual(
        (await adapter.findings.list({ includeStale: true })).length,
        0,
        'the reference fixer writes no state_findings rows',
      );
    } finally {
      await adapter.close();
    }
  });

  it('records a human-decision (out-of-project target) without stamping', async () => {
    const proj = await setupProject({ enableFixer: true });
    await seedReferenceBrokenIssue(proj);
    strictEqual((await submit(proj, 'ai-reference-action')).code, 0);

    const { code, err } = await claimAndRecord(proj, {
      confidence: 0.4,
      safety: CLEAN_SAFETY,
      resolved: [
        {
          target: BROKEN_TARGET,
          state: 'human-decision',
          note: 'The only match is ~/other-repo/docs/missing.md, outside the project; may I search there?',
        },
      ],
      editsSummary: '',
    });
    strictEqual(code, 0, err);

    const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
    await adapter.init();
    try {
      const jobs = await adapter.jobs.list({});
      strictEqual(jobs[0]!.status, 'completed');
    } finally {
      await adapter.close();
    }
  });

  it('rejects a report keyed on a finding `id` (no `target`) as report-invalid', async () => {
    // The reference report keys on the broken `target`, never a finding id
    // (Issues carry no stable identity). A report echoing an `id` instead of
    // a `target` is missing a required field and must fail cleanly.
    const proj = await setupProject({ enableFixer: true });
    await seedReferenceBrokenIssue(proj);
    strictEqual((await submit(proj, 'ai-reference-action')).code, 0);

    const { code, err } = await claimAndRecord(proj, {
      confidence: 0.9,
      safety: CLEAN_SAFETY,
      resolved: [{ id: 7, state: 'fixed', by: 'fixer', note: 'keyed on an id, not a target' }],
      editsSummary: 'x',
    });
    strictEqual(code, 2, 'report-invalid exit: target is required');
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

  it('rejects a `fixed` entry that omits `by` as report-invalid', async () => {
    const proj = await setupProject({ enableFixer: true });
    await seedReferenceBrokenIssue(proj);
    strictEqual((await submit(proj, 'ai-reference-action')).code, 0);

    const { code, err } = await claimAndRecord(proj, {
      confidence: 0.9,
      safety: CLEAN_SAFETY,
      resolved: [{ target: BROKEN_TARGET, state: 'fixed', note: 'fixed but no actor declared' }],
      editsSummary: 'x',
    });
    strictEqual(code, 2, 'report-invalid exit: `by` is required when fixed');
    match(err, /report failed schema validation/);
  });

  it('fails a report missing `resolved` as report-invalid', async () => {
    const proj = await setupProject({ enableFixer: true });
    await seedReferenceBrokenIssue(proj);
    strictEqual((await submit(proj, 'ai-reference-action')).code, 0);

    const { code, err } = await claimAndRecord(proj, {
      confidence: 0.9,
      safety: CLEAN_SAFETY,
      editsSummary: 'nothing',
    });
    strictEqual(code, 2, 'report-invalid exit');
    match(err, /report failed schema validation/);
  });
});
