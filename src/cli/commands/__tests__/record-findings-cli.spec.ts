/**
 * End-to-end tests for the `state_findings` write-through wired through
 * the real CLI verbs: `sm job submit analyzer -> sm job claim -> sm
 * record --status completed` with a schema-valid finder report lands the
 * finder-lane rows, the kernel safety lane covers Action AND Analyzer
 * reports, and `sm show` renders the Findings section. Runs against a
 * real project DB (never `:memory:`,
 * see feedback_sqlite_in_memory_workaround).
 *
 * The routing signal is the extension KIND (`spec/job-lifecycle.md`
 * §Record, findings write-through): a probabilistic Analyzer's validated
 * report is findings by definition, while an Action's report only feeds
 * the kernel safety lane. Fixtures: `prob-finder` (one probabilistic
 * analyzer) and `prob-summarizer` (probabilistic actions, reused for the
 * action-side safety lane).
 *
 * Coverage:
 *   - finder lane: one origin='extension' row per findings[] entry,
 *     per-entry confidence fallback, body_hash + job_id stamped.
 *   - empty findings[] ERASES the pair's previous rows (clean verdict).
 *   - reserved slug in findings[] -> job failed / report-invalid, exit 2,
 *     nothing written.
 *   - safety lane for an ANALYZER report (kernel rows ride along).
 *   - safety lane for an ACTION report (kernel rows only, no extension
 *     lane; a later clean record erases them).
 *   - node deleted between submit and record -> whole write skipped,
 *     previous rows kept.
 *   - `sm show` renders the Findings section ((stale) marked) and its
 *     --json document carries the findings array.
 */

import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strictEqual, deepStrictEqual, ok, match, doesNotMatch } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import type { BaseContext } from 'clipanion';

import { JobSubmitCommand, JobClaimCommand } from '../job-queue.js';
import { RecordCommand } from '../record.js';
import { ShowCommand } from '../show.js';
import { HistoryCommand } from '../history.js';
import { SqliteStorageAdapter } from '../../../kernel/adapters/sqlite/index.js';
import { stampFindingResolutions } from '../../../kernel/adapters/sqlite/findings.js';
import { sha256 } from '../../../kernel/orchestrator/node-build.js';
import type { IFindingRecord } from '../../../kernel/types/storage.js';

const FINDER_FIXTURE = fileURLToPath(new URL('./fixtures/prob-finder', import.meta.url));
const FINDER_PLUGIN_ID = 'prob-finder';
const FINDER_ID = 'prob-finder/quality-check';

const ACTION_FIXTURE = fileURLToPath(new URL('./fixtures/prob-summarizer', import.meta.url));
const ACTION_PLUGIN_ID = 'prob-summarizer';
const ACTION_ID = 'prob-summarizer/skill-echo';

const SKILL = { path: '.claude/skills/foo/SKILL.md', kind: 'skill', provider: 'claude' };

const CLEAN_SAFETY = { injectionDetected: false, contentQuality: 'clean' };

const FINDER_REPORT = {
  confidence: 0.9,
  safety: CLEAN_SAFETY,
  findings: [
    { type: 'contradiction', severity: 'warn', message: 'Step 2 contradicts step 5', confidence: 0.7 },
    { type: 'redundancy', severity: 'info', message: 'Repeats the intro', detail: 'lines 3-9' },
  ],
};

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
      // Real hash of the written body: submit verifies disk vs scan.
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

async function setupProject(): Promise<IProject> {
  counter += 1;
  const root = join(tmpRoot, `proj-${counter}`);
  const dbPath = join(root, '.skill-map', 'skill-map.db');
  mkdirSync(join(root, '.skill-map', 'plugins'), { recursive: true });
  cpSync(FINDER_FIXTURE, join(root, '.skill-map', 'plugins', FINDER_PLUGIN_ID), { recursive: true });
  cpSync(ACTION_FIXTURE, join(root, '.skill-map', 'plugins', ACTION_PLUGIN_ID), { recursive: true });

  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  try {
    await insertNode(adapter);
    const abs = join(root, SKILL.path);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, `---\ntitle: t\n---\nBody of ${SKILL.path}\n`);
    await adapter.trust.set(FINDER_PLUGIN_ID, true);
    await adapter.trust.set(ACTION_PLUGIN_ID, true);
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

function buildRecord(o: { id: string; nonce: string; model?: string }): RecordCommand {
  const cmd = new RecordCommand();
  cmd.id = o.id;
  cmd.nonce = o.nonce;
  cmd.status = 'completed';
  cmd.report = 'report.json';
  cmd.error = undefined;
  cmd.tokensIn = undefined;
  cmd.tokensOut = undefined;
  cmd.durationMs = undefined;
  cmd.model = o.model;
  cmd.json = true;
  cmd.db = undefined;
  return cmd;
}

/** Submit + claim one job for `extension`; returns the record credentials. */
async function submitAndClaim(
  proj: IProject,
  extension: string,
): Promise<{ id: string; nonce: string }> {
  const submitCap = captureContext();
  const submitCode = await withCwd(proj.root, async () => run(buildSubmit(extension), submitCap));
  strictEqual(submitCode, 0, `submit: ${submitCap.stderr()}`);
  return withCwd(proj.root, async () => {
    const cap = captureContext();
    const claim = new JobClaimCommand();
    claim.filter = undefined;
    claim.json = true;
    claim.db = undefined;
    await run(claim, cap);
    return JSON.parse(cap.stdout()) as { id: string; nonce: string };
  });
}

/** Full loop: submit + claim + record `report` for `extension`. */
async function runFullLoop(
  proj: IProject,
  extension: string,
  report: object,
  model?: string,
): Promise<{ code: number; stderr: string; jobId: string }> {
  const { id, nonce } = await submitAndClaim(proj, extension);
  writeFileSync(join(proj.root, 'report.json'), JSON.stringify(report));
  const cap = captureContext();
  const code = await withCwd(proj.root, async () =>
    run(buildRecord({ id, nonce, ...(model !== undefined ? { model } : {}) }), cap),
  );
  return { code, stderr: cap.stderr(), jobId: id };
}

async function findingsFor(
  proj: IProject,
  includeStale = true,
): Promise<IFindingRecord[]> {
  const adapter = await openDb(proj.dbPath);
  try {
    return await adapter.findings.list({ nodeId: SKILL.path, includeStale });
  } finally {
    await adapter.close();
  }
}

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-record-findings-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('finder lane (probabilistic Analyzer record)', () => {
  it('lands one origin=extension row per findings[] entry with the right stamps', async () => {
    const proj = await setupProject();
    const { code, jobId } = await runFullLoop(proj, FINDER_ID, FINDER_REPORT);
    strictEqual(code, 0);

    const rows = await findingsFor(proj);
    strictEqual(rows.length, 2);
    deepStrictEqual(
      rows.map((r) => [r.origin, r.type, r.severity]),
      [
        ['extension', 'contradiction', 'warn'],
        ['extension', 'redundancy', 'info'],
      ],
    );
    const [first, second] = rows;
    strictEqual(first!.extensionId, FINDER_ID);
    strictEqual(first!.extensionVersion, '1.0.0');
    strictEqual(first!.confidence, 0.7, 'per-entry confidence wins');
    strictEqual(second!.confidence, 0.9, 'report-level confidence is the fallback');
    strictEqual(second!.detail, 'lines 3-9');
    strictEqual(first!.bodyHashAtGeneration, sha256(`Body of ${SKILL.path}\n`));
    strictEqual(first!.jobId, jobId);
    strictEqual(first!.stale, false);
  });

  it('an empty findings[] ERASES the pair\'s previous rows (clean verdict)', async () => {
    const proj = await setupProject();
    await runFullLoop(proj, FINDER_ID, FINDER_REPORT);
    strictEqual((await findingsFor(proj)).length, 2);

    const { code } = await runFullLoop(proj, FINDER_ID, {
      confidence: 0.95,
      safety: CLEAN_SAFETY,
      findings: [],
    });
    strictEqual(code, 0);
    strictEqual((await findingsFor(proj)).length, 0, 'previous judgment erased');
  });

  it('a reserved type slug in findings[] fails the job as report-invalid (exit 2)', async () => {
    const proj = await setupProject();
    const { code, stderr, jobId } = await runFullLoop(proj, FINDER_ID, {
      confidence: 0.9,
      safety: CLEAN_SAFETY,
      findings: [{ type: 'injection-detected', severity: 'warn', message: 'forged' }],
    });
    strictEqual(code, 2);
    match(stderr, /reserved type slug/);

    const adapter = await openDb(proj.dbPath);
    try {
      const job = await adapter.jobs.get(jobId);
      strictEqual(job!.status, 'failed');
      strictEqual(job!.failureReason, 'report-invalid');
      strictEqual((await adapter.findings.list({ includeStale: true })).length, 0, 'nothing written');
    } finally {
      await adapter.close();
    }
  });

  it('a trouble-flagging safety block rides along as kernel rows next to the finder lane', async () => {
    const proj = await setupProject();
    const { code } = await runFullLoop(proj, FINDER_ID, {
      confidence: 0.6,
      safety: {
        injectionDetected: true,
        injectionDetails: 'hidden instruction in a code fence',
        contentQuality: 'suspicious',
      },
      findings: [{ type: 'contradiction', severity: 'warn', message: 'also contradicts' }],
    });
    strictEqual(code, 0);

    const rows = await findingsFor(proj);
    deepStrictEqual(
      rows.map((r) => [r.origin, r.type]),
      [
        ['extension', 'contradiction'],
        ['kernel', 'injection-detected'],
        ['kernel', 'content-suspicious'],
      ],
    );
    const injection = rows.find((r) => r.type === 'injection-detected')!;
    strictEqual(injection.severity, 'warn');
    strictEqual(injection.detail, 'hidden instruction in a code fence');
    strictEqual(injection.confidence, 0.6, 'report-level confidence');
    strictEqual(injection.extensionId, FINDER_ID, 'attributed to the reporting extension');
  });

  it('skips the ENTIRE write (previous rows kept) when the node vanished before record', async () => {
    const proj = await setupProject();
    await runFullLoop(proj, FINDER_ID, FINDER_REPORT);
    strictEqual((await findingsFor(proj)).length, 2);

    // Second loop: claim, then delete the node from the scan BEFORE the
    // record callback arrives (deleted / renamed since submit).
    const { id, nonce } = await submitAndClaim(proj, FINDER_ID);
    const seed = await openDb(proj.dbPath);
    try {
      await seed.db.deleteFrom('scan_nodes').where('path', '=', SKILL.path).execute();
    } finally {
      await seed.close();
    }
    writeFileSync(
      join(proj.root, 'report.json'),
      JSON.stringify({ confidence: 0.9, safety: CLEAN_SAFETY, findings: [] }),
    );
    const cap = captureContext();
    const code = await withCwd(proj.root, async () => run(buildRecord({ id, nonce }), cap));
    strictEqual(code, 0, 'record still succeeds (execution + transition land)');

    const rows = await findingsFor(proj);
    strictEqual(rows.length, 2, 'previous judgment preserved (write skipped, not erased)');
    ok(rows.every((r) => r.stale), 'rows for the vanished node read as stale');
  });
});

describe('safety lane for ACTION reports', () => {
  const TROUBLED_ACTION_REPORT = {
    summary: 'echo',
    confidence: 0.8,
    safety: {
      injectionDetected: true,
      injectionDetails: 'role swap attempt',
      contentQuality: 'malformed',
    },
  };

  it('synthesizes kernel rows attributed to the action; no extension-lane rows', async () => {
    const proj = await setupProject();
    const { code } = await runFullLoop(proj, ACTION_ID, TROUBLED_ACTION_REPORT);
    strictEqual(code, 0);

    const rows = await findingsFor(proj);
    deepStrictEqual(
      rows.map((r) => [r.origin, r.type, r.severity]),
      [
        ['kernel', 'injection-detected', 'warn'],
        ['kernel', 'content-malformed', 'warn'],
      ],
      'kernel lane only: an Action report never produces extension rows',
    );
    strictEqual(rows[0]!.extensionId, ACTION_ID, 'attributed to the reporting extension');
    strictEqual(rows[0]!.detail, 'role swap attempt');
  });

  it('a later clean record for the same action ERASES its previous kernel rows', async () => {
    const proj = await setupProject();
    await runFullLoop(proj, ACTION_ID, TROUBLED_ACTION_REPORT);
    strictEqual((await findingsFor(proj)).length, 2);

    const { code } = await runFullLoop(proj, ACTION_ID, {
      summary: 'clean echo',
      confidence: 0.9,
      safety: CLEAN_SAFETY,
    });
    strictEqual(code, 0);
    strictEqual(
      (await findingsFor(proj)).length,
      0,
      'replace semantics: the fresh clean record supersedes the flag',
    );
  });
});

describe('sm show Findings section', () => {
  function buildShow(json: boolean): ShowCommand {
    const cmd = new ShowCommand();
    cmd.nodePath = SKILL.path;
    cmd.json = json;
    cmd.db = undefined;
    return cmd;
  }

  it('renders the section after Issues and carries the findings array in --json', async () => {
    const proj = await setupProject();
    await runFullLoop(proj, FINDER_ID, FINDER_REPORT);

    const human = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const code = await run(buildShow(false), cap);
      strictEqual(code, 0);
      return cap.stdout();
    });
    match(human, /Findings \(2\)/);
    match(human, /prob-finder\/quality-check/);
    match(human, /contradiction/);
    match(human, /Step 2 contradicts step 5/);
    doesNotMatch(human, /\(stale\)/, 'fresh findings carry no stale marker');

    const doc = await withCwd(proj.root, async () => {
      const cap = captureContext();
      await run(buildShow(true), cap);
      return JSON.parse(cap.stdout()) as { findings: IFindingRecord[] };
    });
    strictEqual(doc.findings.length, 2);
    strictEqual(doc.findings[0]!.extensionId, FINDER_ID);
    strictEqual(doc.findings[0]!.stale, false);
  });

  it('marks findings (stale) once the node body_hash drifts', async () => {
    const proj = await setupProject();
    await runFullLoop(proj, FINDER_ID, FINDER_REPORT);

    const seed = await openDb(proj.dbPath);
    try {
      await seed.db
        .updateTable('scan_nodes')
        .set({ bodyHash: 'e'.repeat(64) })
        .where('path', '=', SKILL.path)
        .execute();
    } finally {
      await seed.close();
    }

    const human = await withCwd(proj.root, async () => {
      const cap = captureContext();
      await run(buildShow(false), cap);
      return cap.stdout();
    });
    match(human, /Findings \(2\)/, 'stale rows still render on sm show');
    match(human, /\(stale\)/);

    const doc = await withCwd(proj.root, async () => {
      const cap = captureContext();
      await run(buildShow(true), cap);
      return JSON.parse(cap.stdout()) as { findings: IFindingRecord[] };
    });
    ok(doc.findings.every((f) => f.stale), 'json stale flags flip true');
  });

  /**
   * `sm show` renders a fixer's resolution the same way `sm findings`
   * does (`spec/db-schema.md` §state_findings): the two surfaces must not
   * disagree about the lifecycle state a finding moved into. `sm show`
   * matters most here because it lists ALL rows (fixed included, unlike the
   * default `sm findings` view), and because it already includes STALE
   * rows, which is exactly where a human-decision finding ends up once the
   * fixer's sibling edits move the body.
   */
  it('renders a fixer resolution: human-decision prominently, fixed as a handled state', async () => {
    const proj = await setupProject();
    await runFullLoop(proj, FINDER_ID, FINDER_REPORT);

    const seed = await openDb(proj.dbPath);
    let ids: number[];
    try {
      ids = (await seed.findings.list({ includeStale: true })).map((f) => f.id);
      strictEqual(ids.length, 2, 'the finder landed two rows to resolve');
      await stampFindingResolutions(seed.db, SKILL.path, {
        resolvedBy: 'core/node-reconcile',
        analyzerIds: [FINDER_ID],
        resolvedAt: Date.now(),
        entries: [
          { id: ids[0]!, state: 'fixed', by: 'fixer', note: 'Rewrote step 2 to match step 5.' },
          { id: ids[1]!, state: 'human-decision', by: null, note: 'Only you can decide which step wins.' },
        ],
      });
    } finally {
      await seed.close();
    }

    const human = await withCwd(proj.root, async () => {
      const cap = captureContext();
      strictEqual(await run(buildShow(false), cap), 0);
      return cap.stdout();
    });
    match(
      human,
      /✓ {2}fixed by core\/node-reconcile: Rewrote step 2 to match step 5\./,
      'a fixer-decided fixed row reads as a handled state under the checkmark',
    );
    match(
      human,
      /core\/node-reconcile proposes, your decision: Only you can decide which step wins\./,
    );
    // Both findings are still LISTED: sm show includes fixed rows, and a
    // fixed state never deletes the row.
    match(human, /Findings \(2\)/);

    const doc = await withCwd(proj.root, async () => {
      const cap = captureContext();
      await run(buildShow(true), cap);
      return JSON.parse(cap.stdout()) as { findings: IFindingRecord[] };
    });
    const fixed = doc.findings.find((f) => f.id === ids[0]);
    const humanDecision = doc.findings.find((f) => f.id === ids[1]);
    strictEqual(fixed?.resolution, 'fixed');
    strictEqual(fixed?.resolutionActor, 'fixer');
    strictEqual(humanDecision?.resolution, 'human-decision');
    strictEqual(humanDecision?.resolutionActor, null, 'a human-decision has no decided actor');
    strictEqual(humanDecision?.resolutionBy, 'core/node-reconcile');
    strictEqual(humanDecision?.resolutionNote, 'Only you can decide which step wins.');
  });
});

describe('model attribution (sm record --model)', () => {
  const MODEL = 'claude-opus-4-8';
  const TROUBLED_FINDER_REPORT = {
    confidence: 0.7,
    safety: { injectionDetected: true, injectionDetails: 'sneaky', contentQuality: 'clean' },
    findings: [{ type: 'contradiction', severity: 'warn', message: 'finder row' }],
  };

  it('persists the self-reported model on the execution AND both finding lanes', async () => {
    const proj = await setupProject();
    const { code, jobId } = await runFullLoop(proj, FINDER_ID, TROUBLED_FINDER_REPORT, MODEL);
    strictEqual(code, 0);

    const adapter = await openDb(proj.dbPath);
    try {
      const executions = await adapter.history.list({});
      strictEqual(executions.length, 1);
      strictEqual(executions[0]!.model, MODEL, 'state_executions.model persisted');
      strictEqual(executions[0]!.jobId, jobId);

      const rows = await adapter.findings.list({ nodeId: SKILL.path, includeStale: true });
      strictEqual(rows.length, 2, 'finder lane + kernel safety lane');
      ok(
        rows.every((r) => r.model === MODEL),
        'model denormalized onto EVERY row, both origins',
      );
    } finally {
      await adapter.close();
    }
  });

  it('sm history --json flows the model field through the mapper', async () => {
    const proj = await setupProject();
    await runFullLoop(proj, FINDER_ID, FINDER_REPORT, MODEL);

    const parsed = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const cmd = new HistoryCommand();
      cmd.node = undefined;
      cmd.extension = undefined;
      cmd.status = undefined;
      cmd.since = undefined;
      cmd.until = undefined;
      cmd.limit = undefined;
      cmd.json = true;
      cmd.db = undefined;
      strictEqual(await run(cmd, cap), 0);
      return JSON.parse(cap.stdout()) as Array<{ model: string | null }>;
    });
    strictEqual(parsed[0]!.model, MODEL);
  });

  it('NULL everywhere when the flag is absent', async () => {
    const proj = await setupProject();
    await runFullLoop(proj, FINDER_ID, FINDER_REPORT);

    const adapter = await openDb(proj.dbPath);
    try {
      strictEqual((await adapter.history.list({}))[0]!.model, null);
      const rows = await adapter.findings.list({ nodeId: SKILL.path, includeStale: true });
      ok(rows.every((r) => r.model === null));
    } finally {
      await adapter.close();
    }
  });

  it('sm show renders the model next to the finding row', async () => {
    const proj = await setupProject();
    await runFullLoop(proj, FINDER_ID, FINDER_REPORT, MODEL);

    const human = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const cmd = new ShowCommand();
      cmd.nodePath = SKILL.path;
      cmd.json = false;
      cmd.db = undefined;
      strictEqual(await run(cmd, cap), 0);
      return cap.stdout();
    });
    match(human, /\(claude-opus-4-8\)/, 'findings section carries the model suffix');
  });
});
