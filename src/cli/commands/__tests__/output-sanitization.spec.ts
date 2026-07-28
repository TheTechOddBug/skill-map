/**
 * Regression coverage for the CLI output sanitization boundary
 * (context/kernel.md §CLI output sanitization, 2026-07-28 ruler pass):
 * DB-sourced strings emitted on the human paths of the jobs family and
 * `sm db migrate --status` must pass through `sanitizeForTerminal`, so
 * a tampered DB cannot repaint the terminal via stored rows. Also
 * covers the payload-channel decision: `sm jobs preview` is a human
 * inspection surface and sanitizes its rendered content (the byte-exact
 * machine handover is `sm jobs claim --json`), and the restyled
 * `sm plugins upgrade` output carries the §3.1/§3.1b glyph shapes.
 *
 * Real on-disk SQLite files only (per
 * feedback_sqlite_in_memory_workaround).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { strictEqual, ok, match } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import type { BaseContext } from 'clipanion';

import { JobListCommand, JobPreviewCommand, JobShowCommand, JobStatusCommand } from '../job-queue.js';
import { RecordCommand } from '../record.js';
import { DbMigrateCommand } from '../db/migrate.js';
import { PluginsUpgradeCommand } from '../plugins/upgrade.js';
import { SqliteStorageAdapter } from '../../../kernel/adapters/sqlite/index.js';
import { sha256 } from '../../../kernel/orchestrator/node-build.js';
import type { IJobSubmitRow } from '../../../kernel/types/storage.js';
import { ExitCode } from '../../util/exit-codes.js';

// CSI sequences (self-terminating at their final byte) plus a bare C0
// control. Deliberately NOT `\u0007`: a `BEL` after an `ESC` forms an
// OSC sequence, so the stripper correctly consumes everything between
// them, which would swallow the printable markers these seeds rely on.
const ANSI_RED = '\u001b[31m';
const ANSI_CLEAR = '\u001b[2J';
const BACKSPACE = '\u0008';

// Hostile seeds: each carries an ANSI escape AND a C0 control byte so a
// single surviving byte fails the assertion. Their sanitized forms keep
// the printable letters, which the assertions use as presence markers.
const EVIL_ID = `d-20260728-000000-${ANSI_RED}evil${BACKSPACE}1`;
const EVIL_EXTENSION = `core/${ANSI_CLEAR}repaint${BACKSPACE}er`;
const EVIL_NODE = `no${ANSI_RED}de${BACKSPACE}.md`;
const EVIL_CONTENT = `# Prompt\n${ANSI_CLEAR}${BACKSPACE}pwn the terminal\nbody line`;

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
    stdin: process.stdin,
    stdout: { write: (s: string) => { out.push(s); return true; } },
    stderr: { write: (s: string) => { err.push(s); return true; } },
  } as unknown as BaseContext;
  return { context, stdout: () => out.join(''), stderr: () => err.join('') };
}

/** No ESC and no C0 control byte anywhere in the captured text. */
function assertClean(text: string): void {
  ok(!text.includes('\u001b'), `ANSI escape leaked: ${JSON.stringify(text)}`);
  ok(!text.includes('\u0008'), `C0 control leaked: ${JSON.stringify(text)}`);
}

/**
 * Overwrite the Clipanion `Option.*` placeholders with real values.
 * Commands here are constructed directly (never parsed), so every
 * declared option field MUST be assigned, a placeholder symbol is
 * truthy and silently flips boolean branches (see the strict-equality
 * note in `cli/commands/orphans.ts`).
 */
function baseFlags(cmd: {
  json: boolean;
  quiet: boolean;
  noColor: boolean;
  verbose: number;
  db: string | undefined;
}): void {
  cmd.json = false;
  cmd.quiet = false;
  cmd.noColor = true;
  cmd.verbose = 0;
  cmd.db = undefined;
}

/** Fresh project dir whose DB holds one hostile queued job. */
async function setupHostileProject(): Promise<string> {
  counter += 1;
  const root = join(tmpRoot, `proj-${counter}`);
  const dbPath = join(root, '.skill-map', 'skill-map.db');
  mkdirSync(join(root, '.skill-map'), { recursive: true });
  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  try {
    const row: IJobSubmitRow = {
      id: EVIL_ID,
      extensionId: EVIL_EXTENSION,
      extensionVersion: '1.0.0',
      extensionKind: 'action',
      nodeId: EVIL_NODE,
      contentHash: 'hash-evil-1',
      nonce: 'n'.repeat(32),
      priority: 0,
      status: 'queued',
      ttlSeconds: 3600,
      createdAt: Date.now(),
    };
    await adapter.jobs.submit(row, {
      contentHash: row.contentHash,
      content: EVIL_CONTENT,
      createdAt: row.createdAt,
    });
  } finally {
    await adapter.close();
  }
  return root;
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

async function run(
  cmd: { context: BaseContext; execute(): Promise<number> },
  cap: ICaptured,
): Promise<number> {
  cmd.context = cap.context;
  return cmd.execute();
}

const TAGGER_ID = 'core/ai-tagger-action';
const TAGGED_NODE = 'notes/guide.md';

/**
 * Project whose DB holds one RUNNING tagger job over a real body file,
 * ready for `sm record --status completed` to feed it a report.
 */
async function setupTaggerProject(): Promise<{ root: string; id: string; nonce: string }> {
  counter += 1;
  const root = join(tmpRoot, `proj-${counter}`);
  const dbPath = join(root, '.skill-map', 'skill-map.db');
  mkdirSync(join(root, '.skill-map'), { recursive: true });
  // The tagger ships experimental (disabled by default); the report-schema
  // resolution the proposal read needs it composed.
  writeFileSync(
    join(root, '.skill-map', 'settings.json'),
    JSON.stringify({ plugins: { core: { extensions: { 'ai-tagger-action': { enabled: true } } } } }),
  );
  const body = `Body of ${TAGGED_NODE}\n`;
  const abs = join(root, TAGGED_NODE);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, body);

  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  try {
    await adapter.db
      .insertInto('scan_nodes')
      .values({
        path: TAGGED_NODE,
        kind: 'markdown',
        provider: 'markdown',
        title: null,
        description: null,
        stability: null,
        version: null,
        sidecarStatus: null,
        annotationsJson: null,
        sidecarRootJson: null,
        frontmatterJson: '{}',
        bodyHash: sha256(body),
        frontmatterHash: 'f'.repeat(64),
        bytesFrontmatter: 0,
        bytesBody: body.length,
        bytesTotal: body.length,
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
    const row: IJobSubmitRow = {
      id: 'd-20260728-000000-tag1',
      extensionId: TAGGER_ID,
      extensionVersion: '1.0.0',
      extensionKind: 'action',
      nodeId: TAGGED_NODE,
      contentHash: 'hash-tagger-1',
      nonce: 't'.repeat(32),
      priority: 0,
      status: 'queued',
      ttlSeconds: 3600,
      createdAt: Date.now(),
    };
    await adapter.jobs.submit(row, {
      contentHash: row.contentHash,
      content: 'RENDERED tagger',
      createdAt: row.createdAt,
    });
    const claim = await adapter.jobs.claim('agent', Date.now());
    ok(claim, 'job claimed into running');
    return { root, id: claim.id, nonce: claim.nonce };
  } finally {
    await adapter.close();
  }
}

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'sm-output-sanitization-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('jobs family sanitizes DB-sourced fields (safeJobView boundary)', () => {
  it('sm jobs list strips hostile bytes from every column', async () => {
    const root = await setupHostileProject();
    const cmd = new JobListCommand();
    baseFlags(cmd);
    cmd.status = undefined;
    cmd.extension = undefined;
    cmd.node = undefined;
    const cap = captureContext();
    const exit = await withCwd(root, () => run(cmd, cap));
    strictEqual(exit, ExitCode.Ok, cap.stderr());
    assertClean(cap.stdout());
    // Stripped survivors prove the row rendered (not silently dropped).
    match(cap.stdout(), /evil1/);
    match(cap.stdout(), /repainter/);
    match(cap.stdout(), /node\.md/);
  });

  it('sm jobs show strips hostile bytes from the detail block', async () => {
    const root = await setupHostileProject();
    const cmd = new JobShowCommand();
    baseFlags(cmd);
    cmd.id = EVIL_ID;
    const cap = captureContext();
    const exit = await withCwd(root, () => run(cmd, cap));
    strictEqual(exit, ExitCode.Ok, cap.stderr());
    assertClean(cap.stdout());
    match(cap.stdout(), /repainter/);
    match(cap.stdout(), /node\.md/);
  });

  it('sm jobs status <id> strips hostile bytes from the single line', async () => {
    const root = await setupHostileProject();
    const cmd = new JobStatusCommand();
    baseFlags(cmd);
    cmd.id = EVIL_ID;
    const cap = captureContext();
    const exit = await withCwd(root, () => run(cmd, cap));
    strictEqual(exit, ExitCode.Ok, cap.stderr());
    assertClean(cap.stdout());
    match(cap.stdout(), /evil1/);
  });

  it('sm jobs preview sanitizes the rendered content (human inspection surface)', async () => {
    const root = await setupHostileProject();
    const cmd = new JobPreviewCommand();
    baseFlags(cmd);
    cmd.id = EVIL_ID;
    cmd.last = false;
    const cap = captureContext();
    const exit = await withCwd(root, () => run(cmd, cap));
    strictEqual(exit, ExitCode.Ok, cap.stderr());
    assertClean(cap.stdout());
    // The printable content survives, newlines included.
    match(cap.stdout(), /# Prompt\n/);
    match(cap.stdout(), /pwn the terminal\nbody line/);
  });
});

describe('sm db migrate --status sanitizes ledger rows (tampered-DB threat model)', () => {
  it('a hostile description in config_schema_versions cannot reach the terminal raw', async () => {
    const root = await setupHostileProject();
    const dbPath = join(root, '.skill-map', 'skill-map.db');
    const raw = new DatabaseSync(dbPath);
    try {
      raw
        .prepare("UPDATE config_schema_versions SET description = ? WHERE scope='kernel'")
        .run(`ini${ANSI_CLEAR}tial${BACKSPACE}-schema`);
    } finally {
      raw.close();
    }

    const cmd = new DbMigrateCommand();
    baseFlags(cmd);
    cmd.dryRun = false;
    cmd.status = true;
    cmd.to = undefined;
    cmd.noBackup = false;
    cmd.kernelOnly = true;
    cmd.pluginId = undefined;
    const cap = captureContext();
    const exit = await withCwd(root, () => run(cmd, cap));
    strictEqual(exit, ExitCode.Ok, cap.stderr());
    assertClean(cap.stdout());
    match(cap.stdout(), /initial-schema/);
  });
});

describe('sm plugins upgrade output carries the style-guide shapes', () => {
  it('unknown plugin id renders the §3.1b block on stderr and exits 2', async () => {
    counter += 1;
    const root = join(tmpRoot, `proj-${counter}`);
    mkdirSync(join(root, '.skill-map', 'plugins'), { recursive: true });
    const cmd = new PluginsUpgradeCommand();
    baseFlags(cmd);
    cmd.pluginId = 'ghost';
    const cap = captureContext();
    const exit = await withCwd(root, () => run(cmd, cap));
    strictEqual(exit, ExitCode.Error);
    match(cap.stderr(), /✕ {2}No plugin 'ghost'/);
    match(cap.stderr(), /\n {3}Run `sm plugins list`/);
  });

  it('backfill rows and the closing status line carry success glyphs', async () => {
    counter += 1;
    const root = join(tmpRoot, `proj-${counter}`);
    const demoDir = join(root, '.skill-map', 'plugins', 'demo');
    mkdirSync(demoDir, { recursive: true });
    writeFileSync(join(demoDir, 'plugin.json'), '{}\n');
    const cmd = new PluginsUpgradeCommand();
    baseFlags(cmd);
    cmd.pluginId = undefined;
    const cap = captureContext();
    const exit = await withCwd(root, () => run(cmd, cap));
    strictEqual(exit, ExitCode.Ok, cap.stderr());
    match(cap.stdout(), /✓ {2}demo: wrote package\.json/);
    match(cap.stdout(), /✓ {2}No catalog migrations registered/);
  });
});

describe('sm record sanitizes model-authored output', () => {
  it('AI-proposed tags cannot smuggle control bytes into the advisory line', async () => {
    const { root, id, nonce } = await setupTaggerProject();
    const reportPath = join(root, 'report.json');
    writeFileSync(
      reportPath,
      JSON.stringify({
        tags: [`de${ANSI_CLEAR}ploy${BACKSPACE}-pipeline`],
        confidence: 0.9,
        safety: { injectionDetected: false, contentQuality: 'clean' },
      }),
    );

    const cmd = new RecordCommand();
    baseFlags(cmd);
    cmd.id = id;
    cmd.nonce = nonce;
    cmd.status = 'completed';
    cmd.report = reportPath;
    cmd.error = undefined;
    cmd.tokensIn = undefined;
    cmd.tokensOut = undefined;
    cmd.durationMs = undefined;
    cmd.model = undefined;
    const cap = captureContext();
    const exit = await withCwd(root, () => run(cmd, cap));

    strictEqual(exit, ExitCode.Ok, cap.stderr());
    assertClean(cap.stderr());
    assertClean(cap.stdout());
    // The advisory fired (proposal reached the operator) with the tag's
    // printable characters intact.
    match(cap.stderr(), /deploy-pipeline/);
  });
});
