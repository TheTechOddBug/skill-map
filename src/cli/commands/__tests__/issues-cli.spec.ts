/**
 * CLI tests for the `sm issues` verb family (`cli/commands/issues.ts`),
 * the deterministic-issue dismissal escape hatch
 * (`spec/cli-contract.md` §sm issues dismiss / undismiss /
 * suppressions). Rows are seeded straight through the storage adapter;
 * this spec pins the verb contract:
 *
 *   - dismiss writes a standing `annotations.issueSuppressions` entry to
 *     the node's `.sm` sidecar (same consent gate as `sm bump`),
 *     refreshes the `scan_nodes.annotations_json` mirror, DELETES the
 *     matching `scan_issues` rows, and appends the `issues.dismiss`
 *     operations-log line.
 *   - idempotent: a repeat dismiss of the same (analyzer, value) pair
 *     does NOT duplicate the entry (deletedIssues converges to 0).
 *   - undismiss removes ONE entry (bare / qualified analyzer spellings
 *     equivalent) and the issue does NOT come back until the next scan;
 *     exit 5 on no match, with the mirror self-healed first.
 *   - suppressions lists the active entries from the mirror, always
 *     exit 0.
 *   - unknown node: exit 5 on both write verbs.
 *
 * Runs against a real project DB (never `:memory:`, see
 * feedback_sqlite_in_memory_workaround) and writes real `.sm` files
 * under a temp project root.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import type { BaseContext } from 'clipanion';

import {
  IssuesDismissCommand,
  IssuesSuppressionsCommand,
  IssuesUndismissCommand,
} from '../issues.js';
import { SqliteStorageAdapter } from '../../../kernel/adapters/sqlite/index.js';
import { readSidecarFor, sidecarPathFor } from '../../../kernel/sidecar/index.js';
import { _resetSidecarStoreValidatorCacheForTests } from '../../../kernel/sidecar/store.js';
import { _resetSidecarValidatorCacheForTests } from '../../../kernel/sidecar/parse.js';

const NODE = 'notes/guide.md';
const HASH = 'a'.repeat(64);
const ANALYZER = 'reference-broken';
const QUALIFIED = 'core/reference-broken';
const VALUE = '@ApiSecurity';

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
    // A non-TTY stdin so the consent wrapper resolves `isTTY` without a
    // throw; `--yes` is what actually grants the write on the happy path.
    stdin: { isTTY: false },
    stdout: { write: (s: string) => { out.push(s); return true; } },
    stderr: { write: (s: string) => { err.push(s); return true; } },
  } as unknown as BaseContext;
  return { context, stdout: () => out.join(''), stderr: () => err.join('') };
}

async function insertNode(adapter: SqliteStorageAdapter): Promise<void> {
  await adapter.db
    .insertInto('scan_nodes')
    .values({
      path: NODE,
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
      bodyHash: HASH,
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

/** Seed one `scan_issues` row. The stored analyzer id is SHORT (persisted-issue rule). */
async function insertIssue(
  adapter: SqliteStorageAdapter,
  opts: { analyzerId?: string; target?: string } = {},
): Promise<void> {
  const target = opts.target ?? VALUE;
  await adapter.db
    .insertInto('scan_issues')
    .values({
      analyzerId: opts.analyzerId ?? ANALYZER,
      severity: 'warn',
      nodeIdsJson: JSON.stringify([NODE]),
      linkIndicesJson: null,
      message: `reference not found: ${target}`,
      detail: null,
      fixJson: null,
      dataJson: JSON.stringify({ target }),
    })
    .execute();
}

interface IProject {
  root: string;
  dbPath: string;
}

/** Seed a project DB with NODE and the given issue targets (default: two). */
async function setupProject(
  seed?: (adapter: SqliteStorageAdapter) => Promise<void>,
): Promise<IProject> {
  counter += 1;
  const root = join(tmpRoot, `proj-${counter}`);
  const dbPath = join(root, '.skill-map', 'skill-map.db');
  mkdirSync(join(root, '.skill-map'), { recursive: true });
  // The node's parent dir must exist for the `.sm` sidecar to land next to
  // it (in a real project the scanned `.md` already anchors the directory).
  mkdirSync(join(root, 'notes'), { recursive: true });
  writeFileSync(join(root, NODE), 'Body of the guide\n');

  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  try {
    await insertNode(adapter);
    if (seed) {
      await seed(adapter);
    } else {
      await insertIssue(adapter);
      await insertIssue(adapter, { target: '@Other' });
    }
  } finally {
    await adapter.close();
  }
  return { root, dbPath };
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

function buildDismiss(opts: {
  analyzer?: string;
  value?: string;
  node?: string;
  note?: string;
  json?: boolean;
  yes?: boolean;
} = {}): IssuesDismissCommand {
  const cmd = new IssuesDismissCommand();
  cmd.analyzer = opts.analyzer ?? QUALIFIED;
  cmd.value = opts.value ?? VALUE;
  cmd.node = opts.node ?? NODE;
  cmd.note = opts.note;
  cmd.json = opts.json ?? false;
  cmd.yes = opts.yes ?? false;
  cmd.db = undefined;
  return cmd;
}

function buildUndismiss(opts: {
  analyzer?: string;
  value?: string;
  node?: string;
  json?: boolean;
  yes?: boolean;
} = {}): IssuesUndismissCommand {
  const cmd = new IssuesUndismissCommand();
  cmd.analyzer = opts.analyzer ?? QUALIFIED;
  cmd.value = opts.value ?? VALUE;
  cmd.node = opts.node ?? NODE;
  cmd.json = opts.json ?? false;
  cmd.yes = opts.yes ?? false;
  cmd.db = undefined;
  return cmd;
}

function buildSuppressions(
  opts: { node?: string; json?: boolean } = {},
): IssuesSuppressionsCommand {
  const cmd = new IssuesSuppressionsCommand();
  cmd.node = opts.node;
  cmd.json = opts.json ?? false;
  cmd.db = undefined;
  return cmd;
}

async function run(
  cmd: { context: BaseContext; execute(): Promise<number> },
  cap: ICaptured,
): Promise<number> {
  cmd.context = cap.context;
  return cmd.execute();
}

/** Read the written `.sm` sidecar's issueSuppressions array (empty when absent). */
function readIssueSuppressions(root: string): Array<Record<string, unknown>> {
  _resetSidecarValidatorCacheForTests();
  const result = readSidecarFor(join(root, NODE));
  const raw = result.parsed?.annotations?.['issueSuppressions'];
  return Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];
}

/** The `data.target` values of the surviving `scan_issues` rows, sorted. */
async function remainingTargets(proj: IProject): Promise<string[]> {
  const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
  await adapter.init();
  try {
    const rows = await adapter.db.selectFrom('scan_issues').select(['dataJson']).execute();
    return rows
      .map((row) => (JSON.parse(row.dataJson ?? '{}') as { target?: string }).target ?? '')
      .sort();
  } finally {
    await adapter.close();
  }
}

/** The node's `scan_nodes.annotations_json` mirror, parsed (`null` when empty). */
async function readMirror(proj: IProject): Promise<Record<string, unknown> | null> {
  const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
  await adapter.init();
  try {
    const row = await adapter.db
      .selectFrom('scan_nodes')
      .select(['annotationsJson'])
      .where('path', '=', NODE)
      .executeTakeFirst();
    return row?.annotationsJson == null
      ? null
      : (JSON.parse(row.annotationsJson) as Record<string, unknown>);
  } finally {
    await adapter.close();
  }
}

/** Parsed `operations.log` lines (empty when the file does not exist). */
function readOpsLog(root: string): Array<Record<string, unknown>> {
  const logPath = join(root, '.skill-map', 'operations.log');
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, 'utf8')
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** Dismiss (analyzer, value) on NODE with consent, asserting success. */
async function dismissPair(
  proj: IProject,
  opts: { analyzer?: string; value?: string; note?: string } = {},
): Promise<void> {
  const cap = captureContext();
  const code = await withCwd(proj.root, async () =>
    run(buildDismiss({ ...opts, yes: true }), cap),
  );
  strictEqual(code, 0, cap.stderr());
}

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-issues-cli-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  _resetSidecarStoreValidatorCacheForTests();
  _resetSidecarValidatorCacheForTests();
});

describe('sm issues dismiss', () => {
  it('writes the sidecar entry, deletes the matching rows, refreshes the mirror, logs the op', async () => {
    const proj = await setupProject();

    const code = await withCwd(proj.root, async () =>
      run(buildDismiss({ yes: true }), captureContext()),
    );
    strictEqual(code, 0);

    // Durable sidecar suppression landed (analyzer stored verbatim as typed).
    deepStrictEqual(readIssueSuppressions(proj.root), [{ analyzer: QUALIFIED, value: VALUE }]);

    // Emission-time semantics: ONLY the matching row is deleted, the
    // sibling value survives.
    deepStrictEqual(await remainingTargets(proj), ['@Other']);

    // Write-through: the denormalized mirror carries the entry, so the
    // read surfaces agree without a scan.
    const mirror = await readMirror(proj);
    deepStrictEqual(mirror?.['issueSuppressions'], [{ analyzer: QUALIFIED, value: VALUE }]);

    // Operations log: one issues.dismiss line with what the verb held in hand.
    const ops = readOpsLog(proj.root).filter((line) => line['op'] === 'issues.dismiss');
    strictEqual(ops.length, 1);
    strictEqual(ops[0]!['target'], NODE);
    strictEqual(ops[0]!['channel'], 'cli');
    strictEqual(ops[0]!['outcome'], 'ok');
    strictEqual(ops[0]!['extension'], QUALIFIED);
  });

  it('--json emits the issue-suppression envelope with the deleted count', async () => {
    const proj = await setupProject();
    const cap = captureContext();
    const code = await withCwd(proj.root, async () =>
      run(buildDismiss({ yes: true, json: true }), cap),
    );
    strictEqual(code, 0);
    const body = JSON.parse(cap.stdout()) as Record<string, unknown>;
    strictEqual(body['ok'], true);
    strictEqual(body['kind'], 'issue-suppression');
    deepStrictEqual(body['suppression'], { analyzer: QUALIFIED, value: VALUE });
    strictEqual(body['node'], NODE);
    strictEqual(body['deletedIssues'], 1);
  });

  it('records the optional --note on the entry', async () => {
    const proj = await setupProject();
    await dismissPair(proj, { note: 'npm decorator, not a mention' });
    deepStrictEqual(readIssueSuppressions(proj.root), [
      { analyzer: QUALIFIED, value: VALUE, note: 'npm decorator, not a mention' },
    ]);
  });

  it('idempotent: a repeat dismiss (either analyzer spelling) does not duplicate the entry', async () => {
    const proj = await setupProject();
    await dismissPair(proj);

    // Repeat with the BARE spelling: same identity, still one entry, and
    // the row delete converges to zero (nothing left to delete).
    const cap = captureContext();
    const code = await withCwd(proj.root, async () =>
      run(buildDismiss({ analyzer: ANALYZER, yes: true, json: true }), cap),
    );
    strictEqual(code, 0);
    strictEqual((JSON.parse(cap.stdout()) as Record<string, unknown>)['deletedIssues'], 0);
    deepStrictEqual(readIssueSuppressions(proj.root), [{ analyzer: QUALIFIED, value: VALUE }]);
  });

  it('matching is case-sensitive on the value: a different casing is a distinct entry', async () => {
    const proj = await setupProject();
    await dismissPair(proj);
    await dismissPair(proj, { value: '@apisecurity' });
    deepStrictEqual(readIssueSuppressions(proj.root), [
      { analyzer: QUALIFIED, value: VALUE },
      { analyzer: QUALIFIED, value: '@apisecurity' },
    ]);
  });

  it('exit 5 when the node is not in the current scan (nothing written)', async () => {
    const proj = await setupProject();
    const cap = captureContext();
    const code = await withCwd(proj.root, async () =>
      run(buildDismiss({ node: 'ghost.md', yes: true }), cap),
    );
    strictEqual(code, 5);
    ok(/not in the current scan/.test(cap.stderr()), cap.stderr());
    strictEqual(existsSync(join(proj.root, sidecarPathFor(NODE))), false);
  });

  it('consent gate honored: a non-TTY caller without --yes refuses (exit 2) and touches nothing', async () => {
    const proj = await setupProject();
    const cap = captureContext();
    const code = await withCwd(proj.root, async () =>
      run(buildDismiss({ yes: false }), cap),
    );
    strictEqual(code, 2);
    ok(/consent required/.test(cap.stderr()), cap.stderr());
    // No sidecar written and the rows are intact.
    strictEqual(existsSync(join(proj.root, sidecarPathFor(NODE))), false);
    deepStrictEqual(await remainingTargets(proj), ['@ApiSecurity', '@Other']);
  });
});

describe('sm issues undismiss', () => {
  it('removes the entry (bare spelling matches), logs the op; the rows stay gone until the next scan', async () => {
    const proj = await setupProject();
    await dismissPair(proj);

    const cap = captureContext();
    const code = await withCwd(proj.root, async () =>
      run(buildUndismiss({ analyzer: ANALYZER, yes: true, json: true }), cap),
    );
    strictEqual(code, 0);
    const body = JSON.parse(cap.stdout()) as Record<string, unknown>;
    strictEqual(body['ok'], true);
    strictEqual(body['kind'], 'issue-unsuppression');
    deepStrictEqual(body['removed'], { analyzer: QUALIFIED, value: VALUE });
    strictEqual(body['node'], NODE);

    // The entry left the sidecar and the mirror agrees.
    deepStrictEqual(readIssueSuppressions(proj.root), []);
    deepStrictEqual((await readMirror(proj))?.['issueSuppressions'], []);

    // The documented asymmetry: the deleted rows do NOT come back, the
    // issue reappears only at the next scan.
    deepStrictEqual(await remainingTargets(proj), ['@Other']);

    const ops = readOpsLog(proj.root).filter((line) => line['op'] === 'issues.undismiss');
    strictEqual(ops.length, 1);
    strictEqual(ops[0]!['target'], NODE);
    strictEqual(ops[0]!['outcome'], 'ok');
  });

  it('human mode notes the next-scan reappearance', async () => {
    const proj = await setupProject();
    await dismissPair(proj);
    const cap = captureContext();
    strictEqual(
      await withCwd(proj.root, async () => run(buildUndismiss({ yes: true }), cap)),
      0,
    );
    ok(/NEXT scan/.test(cap.stdout()), cap.stdout());
  });

  it('exit 5 when no entry matches (value is exact and case-sensitive)', async () => {
    const proj = await setupProject();
    await dismissPair(proj);
    const cap = captureContext();
    const code = await withCwd(proj.root, async () =>
      run(buildUndismiss({ value: '@apisecurity', yes: true }), cap),
    );
    strictEqual(code, 5);
    ok(/No issue suppression/.test(cap.stderr()), cap.stderr());
    // The standing entry is untouched.
    deepStrictEqual(readIssueSuppressions(proj.root), [{ analyzer: QUALIFIED, value: VALUE }]);
  });

  it('no-match self-heals a stale mirror: hand-deleted .sm stops claiming the suppression', async () => {
    const proj = await setupProject();
    await dismissPair(proj);
    deepStrictEqual((await readMirror(proj))?.['issueSuppressions'], [
      { analyzer: QUALIFIED, value: VALUE },
    ]);

    // The operator deletes the sidecar OUTSIDE skill-map: the file truth
    // carries no suppression, the mirror still does.
    rmSync(join(proj.root, sidecarPathFor(NODE)));
    _resetSidecarValidatorCacheForTests();

    const cap = captureContext();
    const code = await withCwd(proj.root, async () =>
      run(buildUndismiss({ yes: true }), cap),
    );
    strictEqual(code, 5);
    ok(/No issue suppression/.test(cap.stderr()), cap.stderr());
    // Exit-5 is honest: the mirror was reconciled from the live file first.
    strictEqual(await readMirror(proj), null, 'mirror healed');
  });

  it('exit 5 when the node is not in the current scan', async () => {
    const proj = await setupProject();
    const cap = captureContext();
    const code = await withCwd(proj.root, async () =>
      run(buildUndismiss({ node: 'ghost.md', yes: true }), cap),
    );
    strictEqual(code, 5);
    ok(/not in the current scan/.test(cap.stderr()), cap.stderr());
  });
});

describe('sm issues suppressions', () => {
  it('lists the active entries (node, analyzer, value, note) after dismisses', async () => {
    const proj = await setupProject();
    await dismissPair(proj);
    await dismissPair(proj, { value: '@Other', note: 'intentional' });

    const cap = captureContext();
    const code = await withCwd(proj.root, async () =>
      run(buildSuppressions({ json: true }), cap),
    );
    strictEqual(code, 0);
    const body = JSON.parse(cap.stdout()) as {
      ok: boolean;
      kind: string;
      suppressions: Array<Record<string, unknown>>;
    };
    strictEqual(body.ok, true);
    strictEqual(body.kind, 'issue-suppressions');
    deepStrictEqual(body.suppressions, [
      { node: NODE, analyzer: QUALIFIED, value: VALUE },
      { node: NODE, analyzer: QUALIFIED, value: '@Other', note: 'intentional' },
    ]);
  });

  it('human mode renders the rows and the undismiss tip', async () => {
    const proj = await setupProject();
    await dismissPair(proj);
    const cap = captureContext();
    strictEqual(await withCwd(proj.root, async () => run(buildSuppressions(), cap)), 0);
    ok(/1 active/.test(cap.stdout()), cap.stdout());
    ok(new RegExp(`${NODE}.*${QUALIFIED}.*@ApiSecurity`).test(cap.stdout()), cap.stdout());
    ok(/undismiss/.test(cap.stdout()), 'points at the escape hatch');
  });

  it('-n narrows to the named node; a node without entries yields none', async () => {
    const proj = await setupProject();
    await dismissPair(proj);
    const hit = captureContext();
    strictEqual(
      await withCwd(proj.root, async () =>
        run(buildSuppressions({ node: NODE, json: true }), hit),
      ),
      0,
    );
    strictEqual(
      (JSON.parse(hit.stdout()) as { suppressions: unknown[] }).suppressions.length,
      1,
    );

    const miss = captureContext();
    strictEqual(
      await withCwd(proj.root, async () =>
        run(buildSuppressions({ node: 'other.md', json: true }), miss),
      ),
      0,
    );
    strictEqual(
      (JSON.parse(miss.stdout()) as { suppressions: unknown[] }).suppressions.length,
      0,
    );
  });

  it('friendly empty line when nothing is suppressed', async () => {
    const proj = await setupProject();
    const cap = captureContext();
    strictEqual(await withCwd(proj.root, async () => run(buildSuppressions(), cap)), 0);
    ok(/No active issue suppressions/.test(cap.stdout()), cap.stdout());
  });
});
