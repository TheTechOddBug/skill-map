/**
 * End-to-end tests for the sidecar tags write-through
 * (`spec/job-lifecycle.md` §Tags write-through) wired through the real
 * CLI verbs: `sm jobs submit` -> `sm jobs claim` -> `sm record --status
 * completed` with a schema-valid `core/ai-tagger-action` report merges
 * the report's `tags[]` into the node's `.sm` sidecar through the gated
 * channel, honouring the STANDING consent only. Runs against a real
 * project DB (never `:memory:`, see feedback_sqlite_in_memory_workaround).
 *
 * The tagger signal is the Action's report schema, never a manifest flag
 * (`isTagsReportSchema`, mirror of the summaries detection): a report
 * schema that `$ref`s a canonical `tags/*.schema.json` gets the
 * write-through; any other report stays history-only.
 *
 * Coverage:
 *   - standing consent granted -> a brand-new sidecar lands with the
 *     identity block sourced from the live scan node + the tags, and the
 *     scan_nodes annotations mirror refreshes in the same pass.
 *   - existing sidecar -> union merge: existing entries keep their order
 *     and case, incoming appended, case-insensitive dedup.
 *   - NO standing consent -> nothing written, a human advisory surfaces,
 *     the record still exits 0 and the report keeps the tags.
 *   - a non-tagger report (summarizer) never touches the sidecar.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strictEqual, ok, match, deepStrictEqual } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import type { BaseContext } from 'clipanion';

import { JobSubmitCommand, JobClaimCommand } from '../job-queue.js';
import { RecordCommand } from '../record.js';
import { SqliteStorageAdapter } from '../../../kernel/adapters/sqlite/index.js';
import { sha256 } from '../../../kernel/orchestrator/node-build.js';
import { installAgentSkill } from '../../../core/agent-skill/engine.js';
import { readSidecarFor } from '../../../kernel/sidecar/index.js';

const TAGGER_ID = 'core/ai-tagger-action';
const SUMMARIZER_ID = 'core/ai-summarizer-action';
const NOTE = { path: 'notes/guide.md', kind: 'markdown', provider: 'markdown' };
const SIDECAR_REL = 'notes/guide.sm';

const TAGS_REPORT = {
  tags: ['deploy-pipeline', 'release-notes'],
  confidence: 0.9,
  safety: { injectionDetected: false, contentQuality: 'clean' },
};

const SUMMARY_REPORT = {
  whatItCovers: 'A short guide to the thing.',
  confidence: 0.9,
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

async function insertNode(adapter: SqliteStorageAdapter): Promise<void> {
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
      // Real hash of the written body: submit verifies disk vs scan.
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
}

interface IProject {
  root: string;
  dbPath: string;
}

async function setupProject(opts: { consent?: boolean } = {}): Promise<IProject> {
  counter += 1;
  const root = join(tmpRoot, `proj-${counter}`);
  const dbPath = join(root, '.skill-map', 'skill-map.db');
  mkdirSync(join(root, '.skill-map'), { recursive: true });
  // Both built-ins under test (tagger + the summarizer control) ship
  // stable / enabled, so no settings opt-in is needed.
  if (opts.consent !== false) {
    // STANDING `.sm` consent (project-local layer): the write-through
    // honours this flag only, it never prompts and never persists one.
    writeFileSync(
      join(root, '.skill-map', 'settings.local.json'),
      JSON.stringify({ allowEditSmFiles: true }),
    );
  }
  // Processing-agent gate (spec/job-lifecycle.md §Submit): submits refuse
  // unless the processing skill is installed.
  installAgentSkill(root, '.claude/skills');

  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  try {
    await insertNode(adapter);
    const abs = join(root, NOTE.path);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, `---\ntitle: t\n---\nBody of ${NOTE.path}\n`);
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

function buildSubmit(action: string): JobSubmitCommand {
  const cmd = new JobSubmitCommand();
  cmd.extension = action;
  cmd.node = NOTE.path;
  cmd.all = false;
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
  cmd.wait = false;
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
  cmd.json = false;
  cmd.db = undefined;
  return cmd;
}

/** Full loop: submit + claim + record a valid report. Returns the record capture. */
async function runFullLoop(
  proj: IProject,
  o: { action?: string; report?: object } = {},
): Promise<ICaptured> {
  const submitCap = captureContext();
  const submitCode = await withCwd(proj.root, async () =>
    run(buildSubmit(o.action ?? TAGGER_ID), submitCap),
  );
  strictEqual(submitCode, 0, `submit: ${submitCap.stderr()}`);
  const { id, nonce } = await withCwd(proj.root, async () => {
    const cap = captureContext();
    await run(buildClaim(), cap);
    return JSON.parse(cap.stdout()) as { id: string; nonce: string };
  });
  writeFileSync(join(proj.root, 'report.json'), JSON.stringify(o.report ?? TAGS_REPORT));
  const recordCap = captureContext();
  const code = await withCwd(proj.root, async () =>
    run(buildRecord({ id, nonce, report: 'report.json' }), recordCap),
  );
  strictEqual(code, 0, `record completed: ${recordCap.stderr()}`);
  return recordCap;
}

function sidecarTags(proj: IProject): string[] {
  const read = readSidecarFor(join(proj.root, NOTE.path));
  const raw = read.parsed?.annotations?.['tags'];
  return Array.isArray(raw) ? (raw as string[]) : [];
}

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-tags-cli-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('tags write-through via sm record (standing consent granted)', () => {
  it('creates a brand-new sidecar with the identity block + tags and refreshes the mirror', async () => {
    const proj = await setupProject();
    const cap = await runFullLoop(proj);

    // The sidecar landed with the identity sourced from the live scan node.
    const smAbs = join(proj.root, SIDECAR_REL);
    ok(existsSync(smAbs), 'sidecar file written');
    const read = readSidecarFor(join(proj.root, NOTE.path));
    ok(read.parsed !== null, 'sidecar parses');
    strictEqual(read.parsed!.identityPath, NOTE.path);
    strictEqual(read.parsed!.identityBodyHash, sha256(`Body of ${NOTE.path}\n`));
    deepStrictEqual(sidecarTags(proj), TAGS_REPORT.tags);

    // The annotations mirror refreshed in the same pass.
    const adapter = await openDb(proj.dbPath);
    try {
      const row = await adapter.db
        .selectFrom('scan_nodes')
        .select('annotationsJson')
        .where('path', '=', NOTE.path)
        .executeTakeFirst();
      ok(row?.annotationsJson, 'mirror refreshed');
      const annotations = JSON.parse(row!.annotationsJson!) as { tags?: string[] };
      deepStrictEqual(annotations.tags, TAGS_REPORT.tags);
    } finally {
      await adapter.close();
    }

    // The human advisory names the node and the applied tags.
    match(cap.stderr(), /tags on notes\/guide\.md/);
  });

  it('merges into an existing sidecar: existing first, case-insensitive dedup', async () => {
    const proj = await setupProject();
    writeFileSync(
      join(proj.root, SIDECAR_REL),
      [
        'identity:',
        `  path: ${NOTE.path}`,
        `  bodyHash: ${sha256(`Body of ${NOTE.path}\n`)}`,
        `  frontmatterHash: ${'f'.repeat(64)}`,
        'annotations:',
        '  tags:',
        '    - Release-Notes',
        '    - guides',
        '',
      ].join('\n'),
    );
    await runFullLoop(proj);

    // `Release-Notes` keeps its original casing and position (the
    // incoming `release-notes` dedupes against it); the truly new
    // `deploy-pipeline` appends after the existing entries.
    deepStrictEqual(sidecarTags(proj), ['Release-Notes', 'guides', 'deploy-pipeline']);
  });

  it('a non-tagger report (summarizer) never touches the sidecar', async () => {
    const proj = await setupProject();
    await runFullLoop(proj, { action: SUMMARIZER_ID, report: SUMMARY_REPORT });
    ok(!existsSync(join(proj.root, SIDECAR_REL)), 'no sidecar written');
  });
});

describe('tags write-through without standing consent', () => {
  it('applies nothing, surfaces the advisory, and the record still succeeds', async () => {
    const proj = await setupProject({ consent: false });
    const cap = await runFullLoop(proj);

    ok(!existsSync(join(proj.root, SIDECAR_REL)), 'no sidecar written without consent');
    match(cap.stderr(), /tags not applied to notes\/guide\.md/);
    match(cap.stderr(), /allowEditSmFiles/);

    // The completed execution still landed with the report inline, so
    // the judgment is not lost.
    const adapter = await openDb(proj.dbPath);
    try {
      const executions = await adapter.db.selectFrom('state_executions').selectAll().execute();
      strictEqual(executions.length, 1);
      strictEqual(executions[0]!.status, 'completed');
      ok(executions[0]!.reportJson!.includes('deploy-pipeline'), 'report keeps the tags');
    } finally {
      await adapter.close();
    }
  });
});
