/**
 * `sm check --analyzers` validation + retired probabilistic stubs.
 *
 * Covers:
 *
 *   (a) `--analyzers` with an unknown id → exit 2, stderr names the
 *       unknown id and lists the valid ones (validation short-circuits
 *       before the DB read).
 *   (b) `--analyzers` accepts both the qualified (`core/<id>`) and the
 *       short (`<id>`) form.
 *   (c) The transitional `--include-prob` / `--async` stubs were retired
 *       with the findings pipeline (`spec/cli-contract.md` §Browse, the
 *       `sm check` row): both flags now fail as unknown options.
 *       Probabilistic analyzers queue via `sm job submit` and report via
 *       `sm findings`; they never contribute to `sm check`.
 */

import { after, before, describe, it } from 'node:test';
import { strictEqual, notStrictEqual, match, doesNotMatch } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BaseContext } from 'clipanion';
import { Builtins, Cli } from 'clipanion';

import { CheckCommand } from '../check.js';
import { SqliteStorageAdapter } from '../../../kernel/adapters/sqlite/index.js';

// --- shared scaffolding ----------------------------------------------------

let tmpRoot: string;
let counter = 0;

function freshDir(label: string): string {
  counter += 1;
  const dir = join(tmpRoot, `${label}-${counter}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function freshDbPath(label: string): string {
  counter += 1;
  return join(tmpRoot, `${label}-${counter}.db`);
}

interface ICapturedContext {
  context: BaseContext;
  stdout: () => string;
  stderr: () => string;
}

function captureContext(): ICapturedContext {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const context = {
    stdin: process.stdin,
    stdout: { write: (s: string) => { stdoutChunks.push(s); return true; } },
    stderr: { write: (s: string) => { stderrChunks.push(s); return true; } },
  } as unknown as BaseContext;
  return {
    context,
    stdout: () => stdoutChunks.join(''),
    stderr: () => stderrChunks.join(''),
  };
}

interface ICheckOverrides {
  db?: string | undefined;
  json?: boolean;
  node?: string | undefined;
  analyzers?: string | undefined;
  noPlugins?: boolean;
}

function buildCheck(overrides: ICheckOverrides = {}): CheckCommand {
  const cmd = new CheckCommand();
  cmd.db = overrides.db;
  cmd.json = overrides.json ?? false;
  cmd.node = overrides.node;
  cmd.analyzers = overrides.analyzers;
  cmd.noPlugins = overrides.noPlugins ?? false;
  return cmd;
}

function buildCli(): Cli {
  const cli = new Cli({ binaryName: 'sm', binaryLabel: 'skill-map', binaryVersion: '0.0.0' });
  cli.register(Builtins.HelpCommand);
  cli.register(CheckCommand);
  return cli;
}

/**
 * Initialise an empty (migrated) DB at `dbPath` so `sm check` can read
 * `scan_issues` without tripping on missing tables.
 */
async function initEmptyDb(dbPath: string): Promise<void> {
  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  await adapter.close();
}

/**
 * Insert a synthetic warn issue to give the verb something concrete to
 * read (severity `warn` keeps the exit code at 0).
 */
async function insertWarnIssue(
  dbPath: string,
  analyzerId: string,
  nodePath: string,
): Promise<void> {
  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  try {
    await adapter.db
      .insertInto('scan_issues')
      .values({
        analyzerId,
        severity: 'warn',
        nodeIdsJson: JSON.stringify([nodePath]),
        linkIndicesJson: null,
        message: `synthetic ${analyzerId} on ${nodePath}`,
        detail: null,
        fixJson: null,
        dataJson: null,
      })
      .execute();
  } finally {
    await adapter.close();
  }
}

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-check-analyzers-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

// --- (a) --analyzers rejects unknown ids -----------------------------------

describe('sm check --analyzers <ids>, validation', () => {
  it('(a) unknown id → exit 2, stderr names the unknown id + lists valid ones', async () => {
    // Mirrors Finding 1 from the sm-tutorial session report: the
    // tester typed `broken-ref` instead of `reference-broken`, the
    // verb returned `No issues.` with exit 0, masking the planted
    // warning. Validation against the loaded analyzer catalog now
    // surfaces the typo with a non-zero exit and a list of valid ids.
    const projectRoot = freshDir('a-project');
    const dbPath = freshDbPath('a-db');
    await initEmptyDb(dbPath);
    // Persisted analyzer ids are SHORT per `issue.schema.json`.
    await insertWarnIssue(dbPath, 'reference-broken', 'notes/todo.md');

    const origCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      const cap = captureContext();
      const cmd = buildCheck({ db: dbPath, analyzers: 'broken-ref' });
      cmd.context = cap.context;
      const code = await cmd.execute();

      strictEqual(code, 2, `expected ExitCode.Error (2); got ${code}; stderr=${cap.stderr()}`);
      match(cap.stderr(), /unknown analyzer id\(s\) in --analyzers: broken-ref/);
      match(cap.stderr(), /core\/reference-broken/);
      // The planted issue MUST NOT have rendered, validation
      // short-circuits before the DB read.
      doesNotMatch(cap.stdout(), /notes\/todo\.md/);
    } finally {
      process.chdir(origCwd);
    }
  });

  it('(b) qualified and short ids both accepted', async () => {
    const projectRoot = freshDir('b-project');
    const dbPath = freshDbPath('b-db');
    await initEmptyDb(dbPath);
    // Persisted analyzer ids are SHORT per `issue.schema.json`; the
    // qualified filter form matches by suffix.
    await insertWarnIssue(dbPath, 'reference-broken', 'notes/todo.md');

    const origCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      // Short form
      const capShort = captureContext();
      const cmdShort = buildCheck({ db: dbPath, analyzers: 'reference-broken' });
      cmdShort.context = capShort.context;
      strictEqual(await cmdShort.execute(), 0);
      match(capShort.stdout(), /reference-broken/);
      match(capShort.stdout(), /notes\/todo\.md/);

      // Qualified form
      const capQual = captureContext();
      const cmdQual = buildCheck({ db: dbPath, analyzers: 'core/reference-broken' });
      cmdQual.context = capQual.context;
      strictEqual(await cmdQual.execute(), 0);
      match(capQual.stdout(), /reference-broken/);
      match(capQual.stdout(), /notes\/todo\.md/);
    } finally {
      process.chdir(origCwd);
    }
  });
});

// --- (c) the retired stubs fail as unknown options --------------------------

describe('sm check, retired probabilistic stubs', () => {
  // Clipanion reports parse-time usage errors ("Unknown Syntax Error:
  // Unsupported option name") on STDOUT, not stderr; the command body
  // never runs, so no DB is needed.
  it('(c) --include-prob is an unknown option after the retirement', async () => {
    const cap = captureContext();
    const exit = await buildCli().run(['check', '--include-prob'], cap.context);
    notStrictEqual(exit, 0, 'retired flag must not parse');
    match(cap.stdout(), /--include-prob/, cap.stdout());
  });

  it('(c) --async is an unknown option after the retirement', async () => {
    const cap = captureContext();
    const exit = await buildCli().run(['check', '--async'], cap.context);
    notStrictEqual(exit, 0, 'retired flag must not parse');
    match(cap.stdout(), /--async/, cap.stdout());
  });
});
