/**
 * End-to-end lifecycle of a deterministic-issue dismissal, across the
 * REAL verb and the REAL scan pipeline: `sm issues dismiss` writes the
 * `.sm` suppression, and the next scan must not re-emit the issue
 * (`spec/db-schema.md` §scan_issues, `spec/architecture.md` §Analyzer
 * phases).
 *
 * The regression this pins: the dismiss affordance is generic (any
 * issue carrying a `data.target`), but honouring it used to be
 * per-analyzer, so every analyzer except `core/reference-broken`
 * offered a dismiss that came back on the very next scan. The driver
 * here is `core/reference-redundant` precisely because it has no
 * suppression code of its own, the kernel gate is what silences it.
 *
 * `cli/commands/__tests__/issues-cli.spec.ts` pins the VERB (sidecar
 * write, mirror refresh, row delete, exit codes) against seeded rows;
 * this spec pins what the verb is FOR, which only a real scan can show.
 *
 * Uses temp file-based SQLite DBs (not `:memory:`, per
 * `feedback_sqlite_in_memory_workaround.md`).
 */

import { describe, it, before, after } from 'node:test';
import { strictEqual, deepStrictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BaseContext } from 'clipanion';

import { createKernel, runScan } from '../../kernel/index.js';
import type { Issue, ScanResult } from '../../kernel/index.js';
import { builtIns, listBuiltIns } from '../../plugins/built-ins.js';
import { SqliteStorageAdapter } from '../../kernel/adapters/sqlite/index.js';
import { persistScanResult } from '../../kernel/adapters/sqlite/scan-persistence.js';
import { loadScanResult } from '../../kernel/adapters/sqlite/scan-load.js';
import { IssuesDismissCommand, IssuesUndismissCommand } from '../../cli/commands/issues.js';

const ANALYZER = 'reference-redundant';
const TARGET = 'docs/x.md';
const NOTE_A = 'notes-a.md';
const NOTE_B = 'notes-b.md';

let tmpRoot: string;
let counter = 0;

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-dismiss-lifecycle-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

/**
 * Project with TWO independent nodes that each reference the same
 * target through two syntactic forms (a markdown link plus a backtick
 * path), so `core/reference-redundant` emits one info issue per node
 * with the SAME `data.target`. The second node is the cross-node
 * isolation control: dismissing on A must not silence B.
 */
function freshProject(label: string): string {
  counter += 1;
  const root = join(tmpRoot, `${label}-${counter}`);
  const write = (rel: string, body: string): void => {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, body);
  };
  mkdirSync(join(root, '.skill-map'), { recursive: true });
  write('docs/x.md', '# X\n\nContent.\n');
  write(NOTE_A, 'See [x](docs/x.md) and also `docs/x.md` for details.\n');
  write(NOTE_B, 'Also [x](docs/x.md) plus `docs/x.md` over here.\n');
  return root;
}

function dbPathOf(root: string): string {
  return join(root, '.skill-map', 'skill-map.db');
}

async function scanAndPersist(root: string, incremental: boolean): Promise<ScanResult> {
  const adapter = new SqliteStorageAdapter({
    databasePath: dbPathOf(root),
    autoBackup: false,
  });
  await adapter.init();
  try {
    const prior = incremental ? await loadScanResult(adapter.db) : null;
    const kernel = createKernel();
    for (const m of listBuiltIns()) kernel.registry.register(m);
    const result = await runScan(kernel, {
      roots: [root],
      extensions: builtIns(),
      ...(prior ? { priorSnapshot: prior, enableCache: true } : {}),
    });
    await persistScanResult(adapter.db, result);
    return result;
  } finally {
    await adapter.close();
  }
}

/** Every redundant-reference issue anchored on `path`, by target. */
function redundantTargets(result: ScanResult, path: string): string[] {
  return result.issues
    .filter((i: Issue) => i.analyzerId === ANALYZER && i.nodeIds.includes(path))
    .map((i: Issue) => String(i.data?.['target']))
    .sort();
}

function captureContext(): BaseContext {
  return {
    stdin: { isTTY: false },
    stdout: { write: (): boolean => true },
    stderr: { write: (): boolean => true },
  } as unknown as BaseContext;
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

/** Run the real `sm issues dismiss` / `undismiss` verb inside `root`. */
async function runIssuesVerb(
  root: string,
  cmd: IssuesDismissCommand | IssuesUndismissCommand,
  node: string,
): Promise<number> {
  cmd.analyzer = ANALYZER;
  cmd.value = TARGET;
  cmd.node = node;
  cmd.json = false;
  cmd.yes = true;
  cmd.db = undefined;
  cmd.context = captureContext();
  return withCwd(root, () => cmd.execute());
}

describe('deterministic-issue dismissal, verb to scan', () => {
  it('keeps a dismissed issue away on the next scan (analyzer with no suppression code)', async () => {
    const root = freshProject('sticks');

    const first = await scanAndPersist(root, false);
    deepStrictEqual(redundantTargets(first, NOTE_A), [TARGET]);

    strictEqual(await runIssuesVerb(root, new IssuesDismissCommand(), NOTE_A), 0);

    // Full re-scan: the analyzer runs from scratch, the kernel gate is
    // the only thing that can keep the issue away.
    const second = await scanAndPersist(root, false);
    deepStrictEqual(redundantTargets(second, NOTE_A), []);

    // Incremental re-scan: the `.sm` write invalidated the node's cache,
    // so it re-extracts and re-emits, and must be silenced again.
    const third = await scanAndPersist(root, true);
    deepStrictEqual(redundantTargets(third, NOTE_A), []);
  });

  it('is scoped to the node that carries the entry', async () => {
    const root = freshProject('scoped');

    const first = await scanAndPersist(root, false);
    deepStrictEqual(redundantTargets(first, NOTE_B), [TARGET]);

    strictEqual(await runIssuesVerb(root, new IssuesDismissCommand(), NOTE_A), 0);

    const second = await scanAndPersist(root, false);
    deepStrictEqual(redundantTargets(second, NOTE_A), []);
    deepStrictEqual(
      redundantTargets(second, NOTE_B),
      [TARGET],
      'the same (analyzer, value) on another node keeps its own issue',
    );
  });

  it('brings the issue back at the next scan after undismiss', async () => {
    const root = freshProject('undismiss');

    await scanAndPersist(root, false);
    strictEqual(await runIssuesVerb(root, new IssuesDismissCommand(), NOTE_A), 0);
    deepStrictEqual(redundantTargets(await scanAndPersist(root, false), NOTE_A), []);

    strictEqual(await runIssuesVerb(root, new IssuesUndismissCommand(), NOTE_A), 0);
    deepStrictEqual(
      redundantTargets(await scanAndPersist(root, false), NOTE_A),
      [TARGET],
      'undismiss restores the issue on the NEXT scan (the documented asymmetry)',
    );
  });
});
