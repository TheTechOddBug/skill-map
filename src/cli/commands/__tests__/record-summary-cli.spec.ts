/**
 * End-to-end tests for the `state_summaries` write-through wired through
 * the real CLI verbs: `sm job submit` -> `sm job claim` -> `sm record
 * --status completed` with a schema-valid `core/markdown-summarizer`
 * report lands a per-node summary, and `sm show` renders it (marking it
 * `(stale)` once the node body changes). Runs against a real project DB
 * (never `:memory:`, see feedback_sqlite_in_memory_workaround).
 *
 * The summarizer signal is the Action's report schema, never a manifest
 * flag (`spec/job-lifecycle.md` §Record): an Action whose report schema
 * `$ref`s a canonical `summaries/<kind>.schema.json` gets the write-through,
 * any other report stays history-only on `state_executions.report_json`.
 * Both schema sources are covered: the built-in's codegen-inlined
 * `reportSchema` (core/markdown-summarizer) and a plugin's on-disk
 * `report.schema.json` (the prob-summarizer fixture).
 *
 * Coverage:
 *   - full loop -> a state_summaries row with the right keys + report.
 *   - `sm show NOTES.md` renders the summarizer id + report headline.
 *   - after the node body_hash changes (rescan), `sm show` marks it
 *     `(stale)`; `sm show --json` carries a `stale: true` per summary.
 *   - plugin action whose report schema $refs summaries/skill -> summary
 *     row lands (on-disk schema path).
 *   - plugin action whose report schema extends report-base only -> NO
 *     summary row (history-only).
 */

import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strictEqual, ok, match, doesNotMatch } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import type { BaseContext } from 'clipanion';

import { JobSubmitCommand, JobClaimCommand } from '../job-queue.js';
import { RecordCommand } from '../record.js';
import { ShowCommand } from '../show.js';
import { SqliteStorageAdapter } from '../../../kernel/adapters/sqlite/index.js';
import { sha256 } from '../../../kernel/orchestrator/node-build.js';

const ACTION_ID = 'core/markdown-summarizer';
const NOTE = { path: 'notes/guide.md', kind: 'markdown', provider: 'markdown' };

const VALID_REPORT = {
  whatItCovers: 'A short guide to the thing.',
  confidence: 0.9,
  safety: { injectionDetected: false, contentQuality: 'clean' },
};

// Plugin-path fixtures: skill-brief's report schema $refs summaries/skill
// (summarizer), skill-echo's extends report-base only (history-only).
const FIXTURE = fileURLToPath(new URL('./fixtures/prob-summarizer', import.meta.url));
const PLUGIN_ID = 'prob-summarizer';
const PLUGIN_SUMMARIZER_ID = 'prob-summarizer/skill-brief';
const PLUGIN_HISTORY_ONLY_ID = 'prob-summarizer/skill-echo';
const SKILL = { path: '.claude/skills/foo/SKILL.md', kind: 'skill', provider: 'claude' };

const SKILL_SUMMARY_REPORT = {
  whatItDoes: 'Echoes the skill body back as a brief.',
  confidence: 0.8,
  safety: { injectionDetected: false, contentQuality: 'clean' },
};

const HISTORY_ONLY_REPORT = {
  summary: 'A one-line echo of the skill body.',
  confidence: 0.8,
  safety: { injectionDetected: false, contentQuality: 'clean' },
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

async function insertNode(adapter: SqliteStorageAdapter, node = NOTE): Promise<void> {
  await adapter.db
    .insertInto('scan_nodes')
    .values({
      path: node.path,
      kind: node.kind,
      provider: node.provider,
      title: null,
      description: null,
      stability: null,
      version: null,
      sidecarStatus: null,
      annotationsJson: null,
      sidecarRootJson: null,
      frontmatterJson: '{}',
      // Real hash of the written body: submit now verifies disk vs scan.
      bodyHash: sha256(`Body of ${node.path}\n`),
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

async function setupProject(
  opts: { node?: typeof NOTE; withPlugin?: boolean } = {},
): Promise<IProject> {
  const node = opts.node ?? NOTE;
  counter += 1;
  const root = join(tmpRoot, `proj-${counter}`);
  const dbPath = join(root, '.skill-map', 'skill-map.db');
  mkdirSync(join(root, '.skill-map'), { recursive: true });
  if (opts.withPlugin === true) {
    mkdirSync(join(root, '.skill-map', 'plugins'), { recursive: true });
    cpSync(FIXTURE, join(root, '.skill-map', 'plugins', PLUGIN_ID), { recursive: true });
  }

  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  try {
    await insertNode(adapter, node);
    const abs = join(root, node.path);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, `---\ntitle: t\n---\nBody of ${node.path}\n`);
    if (opts.withPlugin === true) {
      await adapter.trust.set(PLUGIN_ID, true);
    }
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

function buildSubmit(action = ACTION_ID, node = NOTE.path): JobSubmitCommand {
  const cmd = new JobSubmitCommand();
  cmd.action = action;
  cmd.node = node;
  cmd.all = false;
  cmd.runFlag = false;
  cmd.force = false;
  cmd.ttl = undefined;
  cmd.priority = undefined;
  cmd.json = false;
  cmd.db = undefined;
  return cmd;
}

function buildClaim(): JobClaimCommand {
  const cmd = new JobClaimCommand();
  cmd.filter = undefined;
  cmd.json = true;
  cmd.db = undefined;
  return cmd;
}

function buildRecord(o: { id: string; nonce: string; report: string }): RecordCommand {
  const cmd = new RecordCommand();
  cmd.id = o.id;
  cmd.nonce = o.nonce;
  cmd.status = 'completed';
  cmd.report = o.report;
  cmd.error = undefined;
  cmd.tokensIn = undefined;
  cmd.tokensOut = undefined;
  cmd.durationMs = undefined;
  cmd.model = undefined;
  cmd.json = true;
  cmd.db = undefined;
  return cmd;
}

function buildShow(json: boolean): ShowCommand {
  const cmd = new ShowCommand();
  cmd.nodePath = NOTE.path;
  cmd.json = json;
  cmd.db = undefined;
  return cmd;
}

/** Full loop: submit + claim + record a valid report. Returns the job id. */
async function runFullLoop(
  proj: IProject,
  o: { action?: string; node?: string; report?: object } = {},
): Promise<string> {
  const submitCap = captureContext();
  const submitCode = await withCwd(proj.root, async () =>
    run(buildSubmit(o.action, o.node), submitCap),
  );
  strictEqual(submitCode, 0, `submit: ${submitCap.stderr()}`);
  const { id, nonce } = await withCwd(proj.root, async () => {
    const cap = captureContext();
    await run(buildClaim(), cap);
    return JSON.parse(cap.stdout()) as { id: string; nonce: string };
  });
  writeFileSync(join(proj.root, 'report.json'), JSON.stringify(o.report ?? VALID_REPORT));
  const code = await withCwd(proj.root, async () =>
    run(buildRecord({ id, nonce, report: 'report.json' }), captureContext()),
  );
  strictEqual(code, 0, 'record completed');
  return id;
}

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-summary-cli-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('summary write-through via sm record + sm show', () => {
  it('lands a state_summaries row with the right keys + report', async () => {
    const proj = await setupProject();
    await runFullLoop(proj);

    const adapter = await openDb(proj.dbPath);
    try {
      const rows = await adapter.summaries.forNode(NOTE.path);
      strictEqual(rows.length, 1);
      const s = rows[0]!;
      strictEqual(s.summarizerActionId, ACTION_ID);
      strictEqual(s.kind, NOTE.kind);
      strictEqual(s.bodyHashAtGeneration, sha256(`Body of ${NOTE.path}\n`));
      strictEqual(s.report['whatItCovers'], VALID_REPORT.whatItCovers);
    } finally {
      await adapter.close();
    }
  });

  it('sm show renders the summary; --json carries stale=false while fresh', async () => {
    const proj = await setupProject();
    await runFullLoop(proj);

    const human = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const code = await run(buildShow(false), cap);
      strictEqual(code, 0);
      return cap.stdout();
    });
    match(human, /Summary \(1\)/);
    match(human, /core\/markdown-summarizer/);
    match(human, /A short guide to the thing\./);
    doesNotMatch(human, /\(stale\)/, 'fresh summary is not stale');

    const doc = await withCwd(proj.root, async () => {
      const cap = captureContext();
      await run(buildShow(true), cap);
      return JSON.parse(cap.stdout()) as { summaries: { summarizerActionId: string; stale: boolean }[] };
    });
    strictEqual(doc.summaries.length, 1);
    strictEqual(doc.summaries[0]!.summarizerActionId, ACTION_ID);
    strictEqual(doc.summaries[0]!.stale, false);
  });

  it('marks the summary (stale) once the node body_hash changes', async () => {
    const proj = await setupProject();
    await runFullLoop(proj);

    // Simulate an edit + rescan: the node's body_hash changes while the
    // stored summary keeps its body_hash_at_generation.
    const seed = await openDb(proj.dbPath);
    try {
      await seed.db
        .updateTable('scan_nodes')
        .set({ bodyHash: 'e'.repeat(64) })
        .where('path', '=', NOTE.path)
        .execute();
    } finally {
      await seed.close();
    }

    const human = await withCwd(proj.root, async () => {
      const cap = captureContext();
      await run(buildShow(false), cap);
      return cap.stdout();
    });
    match(human, /\(stale\)/, 'stale marker rendered after body change');

    const doc = await withCwd(proj.root, async () => {
      const cap = captureContext();
      await run(buildShow(true), cap);
      return JSON.parse(cap.stdout()) as { summaries: { stale: boolean }[] };
    });
    ok(doc.summaries[0]!.stale, 'json stale flag flips true');
  });
});

describe('summarizer detection from the report schema (plugin on-disk path)', () => {
  it('a plugin action whose report schema $refs summaries/skill lands the write-through', async () => {
    const proj = await setupProject({ node: SKILL, withPlugin: true });
    await runFullLoop(proj, {
      action: PLUGIN_SUMMARIZER_ID,
      node: SKILL.path,
      report: SKILL_SUMMARY_REPORT,
    });

    const adapter = await openDb(proj.dbPath);
    try {
      const rows = await adapter.summaries.forNode(SKILL.path);
      strictEqual(rows.length, 1);
      const s = rows[0]!;
      strictEqual(s.summarizerActionId, PLUGIN_SUMMARIZER_ID);
      // state_summaries.kind mirrors the NODE's kind; the summary-schema
      // kind is only the detection signal.
      strictEqual(s.kind, SKILL.kind);
      strictEqual(s.report['whatItDoes'], SKILL_SUMMARY_REPORT.whatItDoes);
    } finally {
      await adapter.close();
    }
  });

  it('a plugin action whose report schema extends report-base only stays history-only', async () => {
    const proj = await setupProject({ node: SKILL, withPlugin: true });
    await runFullLoop(proj, {
      action: PLUGIN_HISTORY_ONLY_ID,
      node: SKILL.path,
      report: HISTORY_ONLY_REPORT,
    });

    const adapter = await openDb(proj.dbPath);
    try {
      strictEqual((await adapter.summaries.forNode(SKILL.path)).length, 0, 'no summary row');
      // The completed execution still lands, report kept on history only.
      const executions = await adapter.db
        .selectFrom('state_executions')
        .selectAll()
        .execute();
      strictEqual(executions.length, 1);
      strictEqual(executions[0]!.status, 'completed');
      ok(executions[0]!.reportJson!.includes('one-line echo'), 'report stored inline');
    } finally {
      await adapter.close();
    }
  });
});
