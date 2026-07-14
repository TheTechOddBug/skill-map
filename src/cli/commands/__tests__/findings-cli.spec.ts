/**
 * CLI tests for `sm findings` (`cli/commands/findings.ts`), the read
 * surface over `state_findings`. Rows are seeded straight through the
 * storage helpers (the write path is covered by the record specs); this
 * spec pins the verb contract (`spec/cli-contract.md` §sm findings):
 *
 *   - default read EXCLUDES stale rows; `--stale` includes them marked
 *     `(stale)` in human mode / `stale: true` in JSON.
 *   - filters: -n, --extension (qualified + bare), --type, --severity
 *     (minimum), --since (ISO), --threshold (minimum confidence).
 *   - exit 0 regardless of content (advisory by construction), even on
 *     error-severity findings.
 *   - exit 2 on malformed flag values; exit 5 on a missing DB.
 *   - `--json` emits { ok, kind: 'findings', findings[], total }.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strictEqual, ok, match, doesNotMatch } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import { Readable } from 'node:stream';

import type { BaseContext } from 'clipanion';

import { FindingsCommand, FindingsPruneCommand } from '../findings.js';
import { SqliteStorageAdapter } from '../../../kernel/adapters/sqlite/index.js';
import { replaceFindingsForNode } from '../../../kernel/adapters/sqlite/findings.js';
import type { IFindingRecord } from '../../../kernel/types/storage.js';

const NODE_A = 'notes/guide.md';
const NODE_B = '.claude/skills/foo/SKILL.md';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const T0 = Date.parse('2026-01-01T00:00:00Z');
const T1 = Date.parse('2026-02-01T00:00:00Z');

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

async function insertNode(
  adapter: SqliteStorageAdapter,
  opts: { path: string; bodyHash: string },
): Promise<void> {
  await adapter.db
    .insertInto('scan_nodes')
    .values({
      path: opts.path,
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
      bodyHash: opts.bodyHash,
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

/**
 * Seed a project DB with two nodes and a spread of findings:
 *   NODE_A: fresh error (finder-a, contradiction, 0.9, T1)
 *           fresh info  (finder-a, redundancy, 0.4, T0)
 *           STALE warn  (finder-b, incoherence, 0.7, T0; hash drifted)
 *   NODE_B: fresh warn  (other/checker, injection-detected kernel row,
 *           0.8, T1, with a detail)
 */
async function setupProject(): Promise<IProject> {
  counter += 1;
  const root = join(tmpRoot, `proj-${counter}`);
  const dbPath = join(root, '.skill-map', 'skill-map.db');
  mkdirSync(join(root, '.skill-map'), { recursive: true });

  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  try {
    await insertNode(adapter, { path: NODE_A, bodyHash: HASH_A });
    await insertNode(adapter, { path: NODE_B, bodyHash: HASH_B });
    const base = { detail: null, extensionVersion: '1.0.0', jobId: null, model: null };
    await replaceFindingsForNode(adapter.db, NODE_A, 'plug/finder-a', [
      {
        ...base,
        origin: 'extension',
        type: 'contradiction',
        severity: 'error',
        message: 'A contradicts B',
        confidence: 0.9,
        bodyHashAtGeneration: HASH_A,
        generatedAt: T1,
      },
      {
        ...base,
        origin: 'extension',
        type: 'redundancy',
        severity: 'info',
        message: 'Repeats itself',
        confidence: 0.4,
        bodyHashAtGeneration: HASH_A,
        generatedAt: T0,
      },
    ]);
    // finder-b judged an OLDER body: stale by hash drift.
    await replaceFindingsForNode(adapter.db, NODE_A, 'plug/finder-b', [
      {
        ...base,
        origin: 'extension',
        type: 'incoherence',
        severity: 'warn',
        message: 'Sections disagree',
        confidence: 0.7,
        bodyHashAtGeneration: 'd'.repeat(64),
        generatedAt: T0,
      },
    ]);
    await replaceFindingsForNode(adapter.db, NODE_B, 'other/checker', [
      {
        ...base,
        origin: 'kernel',
        type: 'injection-detected',
        severity: 'warn',
        message: 'The model flagged a prompt-injection attempt inside the node content',
        detail: 'hidden instruction in a comment',
        confidence: 0.8,
        model: 'claude-opus-4-8',
        bodyHashAtGeneration: HASH_B,
        generatedAt: T1,
      },
    ]);
  } finally {
    await adapter.close();
  }
  return { root, dbPath };
}

interface IFlags {
  node?: string;
  extension?: string;
  type?: string;
  severity?: string;
  since?: string;
  threshold?: string;
  stale?: boolean;
  json?: boolean;
}

function buildFindings(flags: IFlags = {}): FindingsCommand {
  const cmd = new FindingsCommand();
  cmd.node = flags.node;
  cmd.extension = flags.extension;
  cmd.type = flags.type;
  cmd.severity = flags.severity;
  cmd.since = flags.since;
  cmd.threshold = flags.threshold;
  cmd.stale = flags.stale ?? false;
  cmd.json = flags.json ?? false;
  cmd.db = undefined;
  return cmd;
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

interface IEnvelope {
  ok: boolean;
  kind: string;
  findings: IFindingRecord[];
  total: number;
}

async function runJson(root: string, flags: IFlags = {}): Promise<{ code: number; body: IEnvelope }> {
  return withCwd(root, async () => {
    const cap = captureContext();
    const code = await run(buildFindings({ ...flags, json: true }), cap);
    return { code, body: JSON.parse(cap.stdout()) as IEnvelope };
  });
}

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-findings-cli-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('sm findings --json envelope', () => {
  it('emits { ok, kind, findings, total } with camelCase rows + stale=false, exit 0', async () => {
    const proj = await setupProject();
    const { code, body } = await runJson(proj.root);
    strictEqual(code, 0, 'exit 0 even with an error-severity finding (advisory)');
    strictEqual(body.ok, true);
    strictEqual(body.kind, 'findings');
    strictEqual(body.total, 3, 'stale row excluded by default');
    strictEqual(body.findings.length, 3);
    const first = body.findings.find((f) => f.type === 'contradiction')!;
    strictEqual(first.nodeId, NODE_A);
    strictEqual(first.extensionId, 'plug/finder-a');
    strictEqual(first.extensionVersion, '1.0.0');
    strictEqual(first.origin, 'extension');
    strictEqual(first.severity, 'error');
    strictEqual(first.confidence, 0.9);
    strictEqual(first.bodyHashAtGeneration, HASH_A);
    strictEqual(first.generatedAt, T1);
    strictEqual(first.jobId, null);
    strictEqual(first.stale, false);
    ok(typeof first.id === 'number');
  });

  it('--stale includes the drifted row flagged stale:true', async () => {
    const proj = await setupProject();
    const { body } = await runJson(proj.root, { stale: true });
    strictEqual(body.total, 4);
    const staleRow = body.findings.find((f) => f.type === 'incoherence')!;
    strictEqual(staleRow.stale, true);
    ok(body.findings.filter((f) => f.stale).length === 1, 'only the drifted row is stale');
  });
});

describe('sm findings filters', () => {
  it('-n restricts to one node', async () => {
    const proj = await setupProject();
    const { body } = await runJson(proj.root, { node: NODE_B });
    strictEqual(body.total, 1);
    strictEqual(body.findings[0]!.nodeId, NODE_B);
  });

  it('--extension matches qualified and bare ids', async () => {
    const proj = await setupProject();
    strictEqual((await runJson(proj.root, { extension: 'plug/finder-a' })).body.total, 2);
    strictEqual((await runJson(proj.root, { extension: 'checker' })).body.total, 1);
    strictEqual(
      (await runJson(proj.root, { extension: 'finder-a,checker' })).body.total,
      3,
      'comma-separated union',
    );
  });

  it('--type restricts by slug', async () => {
    const proj = await setupProject();
    const { body } = await runJson(proj.root, { type: 'redundancy' });
    strictEqual(body.total, 1);
    strictEqual(body.findings[0]!.type, 'redundancy');
  });

  it('--severity is a MINIMUM (warn keeps warn + error, drops info)', async () => {
    const proj = await setupProject();
    const { body } = await runJson(proj.root, { severity: 'warn' });
    strictEqual(body.total, 2);
    ok(body.findings.every((f) => f.severity !== 'info'));
  });

  it('--since keeps rows generated at or after the ISO date', async () => {
    const proj = await setupProject();
    const { body } = await runJson(proj.root, { since: '2026-01-15' });
    strictEqual(body.total, 2, 'only the T1 rows survive');
  });

  it('--threshold keeps rows at or above the confidence floor', async () => {
    const proj = await setupProject();
    const { body } = await runJson(proj.root, { threshold: '0.8' });
    strictEqual(body.total, 2);
    ok(body.findings.every((f) => f.confidence >= 0.8));
  });
});

describe('sm findings human mode', () => {
  it('renders the self-reported model beside the confidence when present', async () => {
    const proj = await setupProject();
    const plain = await withCwd(proj.root, async () => {
      const cap = captureContext();
      strictEqual(await run(buildFindings({ node: NODE_B }), cap), 0);
      return cap.stdout();
    });
    match(plain, /\(80% · claude-opus-4-8\)/, 'percent + model in one cell');

    const { body } = await runJson(proj.root, { node: NODE_B });
    strictEqual(body.findings[0]!.model, 'claude-opus-4-8', 'json entry carries model');
  });

  it('a hostile model string is sanitized in human mode but raw in --json', async () => {
    const proj = await setupProject();
    const hostileModel = '\u001b[2Jevil-model';
    const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
    await adapter.init();
    try {
      await replaceFindingsForNode(adapter.db, NODE_A, 'plug/hostile', [
        {
          origin: 'extension',
          type: 'spoof',
          severity: 'info',
          message: 'spoofed row',
          detail: null,
          confidence: 0.5,
          extensionVersion: '1.0.0',
          model: hostileModel,
          bodyHashAtGeneration: HASH_A,
          generatedAt: T1,
          jobId: null,
        },
      ]);
    } finally {
      await adapter.close();
    }

    const plain = await withCwd(proj.root, async () => {
      const cap = captureContext();
      strictEqual(await run(buildFindings({ type: 'spoof' }), cap), 0);
      return cap.stdout();
    });
    ok(plain.includes('evil-model'), 'text content survives');
    strictEqual(plain.includes('\u001b['), false, 'escape bytes stripped at render');

    const { body } = await runJson(proj.root, { type: 'spoof' });
    strictEqual(body.findings[0]!.model, hostileModel, 'machine surface stays raw');
  });

  it('groups by node, glyph rows, stale marker only under --stale', async () => {
    const proj = await setupProject();
    const plain = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const code = await run(buildFindings(), cap);
      strictEqual(code, 0);
      return cap.stdout();
    });
    match(plain, /sm findings: /);
    match(plain, /1 error/);
    match(plain, /1 warning/);
    match(plain, /1 info/);
    match(plain, new RegExp(NODE_A.replace(/[./]/g, '\\$&')));
    match(plain, /plug\/finder-a/);
    match(plain, /contradiction/);
    match(plain, /\(90%\)/, 'confidence rendered as a percent');
    match(plain, /hidden instruction in a comment/, 'detail line rendered');
    doesNotMatch(plain, /\(stale\)/, 'stale row excluded by default');

    const withStale = await withCwd(proj.root, async () => {
      const cap = captureContext();
      await run(buildFindings({ stale: true }), cap);
      return cap.stdout();
    });
    match(withStale, /incoherence/);
    match(withStale, /\(stale\)/, 'included row is marked');
  });

  it('prints the friendly empty line when nothing matches', async () => {
    const proj = await setupProject();
    const out = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const code = await run(buildFindings({ type: 'no-such-slug' }), cap);
      strictEqual(code, 0);
      return cap.stdout();
    });
    match(out, /No findings\./);
  });
});

describe('sm findings flag validation + missing DB', () => {
  it('rejects an unknown --severity with exit 2 and a hint', async () => {
    const proj = await setupProject();
    const outcome = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const code = await run(buildFindings({ severity: 'fatal' }), cap);
      return { code, err: cap.stderr() };
    });
    strictEqual(outcome.code, 2);
    match(outcome.err, /--severity/);
    match(outcome.err, /info, warn, error/);
  });

  it('rejects an unparseable --since with exit 2', async () => {
    const proj = await setupProject();
    const outcome = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const code = await run(buildFindings({ since: 'not-a-date' }), cap);
      return { code, err: cap.stderr() };
    });
    strictEqual(outcome.code, 2);
    match(outcome.err, /--since/);
  });

  it('rejects an out-of-range --threshold with exit 2', async () => {
    const proj = await setupProject();
    const outcome = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const code = await run(buildFindings({ threshold: '1.5' }), cap);
      return { code, err: cap.stderr() };
    });
    strictEqual(outcome.code, 2);
    match(outcome.err, /--threshold/);
  });

  it('exits 5 when the DB file is missing (mirror of the other read verbs)', async () => {
    counter += 1;
    const bare = join(tmpRoot, `bare-${counter}`);
    mkdirSync(bare, { recursive: true });
    const code = await withCwd(bare, async () => run(buildFindings(), captureContext()));
    strictEqual(code, 5);
  });
});

describe('sm findings prune', () => {
  interface IPruneFlags {
    dryRun?: boolean;
    yes?: boolean;
    json?: boolean;
  }

  function buildPrune(flags: IPruneFlags = {}): FindingsPruneCommand {
    const cmd = new FindingsPruneCommand();
    cmd.dryRun = flags.dryRun ?? false;
    cmd.yes = flags.yes ?? false;
    cmd.json = flags.json ?? false;
    cmd.db = undefined;
    return cmd;
  }

  /** Capture context carrying a scripted stdin for the confirm prompt. */
  function captureWithStdin(answer: string): ICaptured {
    const cap = captureContext();
    (cap.context as { stdin?: unknown }).stdin = Readable.from([answer]);
    return cap;
  }

  /**
   * setupProject seeds 3 fresh rows + 1 drift-stale row; add one more
   * stale row on a node that never existed in the scan (node-gone lane)
   * so the prune covers both staleness shapes: 2 stale, 3 fresh.
   */
  async function setupWithGhost(): Promise<IProject> {
    const proj = await setupProject();
    const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
    await adapter.init();
    try {
      await replaceFindingsForNode(adapter.db, 'ghost.md', 'plug/finder-a', [
        {
          origin: 'extension',
          type: 'orphaned-judgment',
          severity: 'info',
          message: 'node left the scan',
          detail: null,
          confidence: 0.5,
          extensionVersion: '1.0.0',
          model: null,
          bodyHashAtGeneration: 'f'.repeat(64),
          generatedAt: T0,
          jobId: null,
        },
      ]);
    } finally {
      await adapter.close();
    }
    return proj;
  }

  async function allRows(proj: IProject): Promise<IFindingRecord[]> {
    const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
    await adapter.init();
    try {
      return await adapter.findings.list({ includeStale: true });
    } finally {
      await adapter.close();
    }
  }

  it('--yes deletes ONLY the stale rows (drift + node-gone), fresh rows survive', async () => {
    const proj = await setupWithGhost();
    strictEqual((await allRows(proj)).length, 5, 'seed: 3 fresh + 2 stale');

    const outcome = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const code = await run(buildPrune({ yes: true, json: true }), cap);
      return { code, body: JSON.parse(cap.stdout()) as Record<string, unknown> };
    });
    strictEqual(outcome.code, 0);
    strictEqual(outcome.body['deleted'], 2);
    strictEqual(outcome.body['wouldDelete'], 0);
    ok(typeof outcome.body['elapsedMs'] === 'number', 'envelope carries elapsedMs');

    const rows = await allRows(proj);
    strictEqual(rows.length, 3, 'fresh rows untouched');
    ok(rows.every((r) => !r.stale), 'no stale row survives');
  });

  it('--dry-run reports the count without deleting and never prompts', async () => {
    const proj = await setupWithGhost();
    const outcome = await withCwd(proj.root, async () => {
      // No stdin at all: a prompt would hang / crash, proving dry-run
      // never asks.
      const cap = captureContext();
      const code = await run(buildPrune({ dryRun: true, json: true }), cap);
      return { code, body: JSON.parse(cap.stdout()) as Record<string, unknown> };
    });
    strictEqual(outcome.code, 0);
    strictEqual(outcome.body['deleted'], 0);
    strictEqual(outcome.body['wouldDelete'], 2);
    strictEqual((await allRows(proj)).length, 5, 'nothing deleted');
  });

  it('human dry-run renders the would-delete line with the dry-run tag', async () => {
    const proj = await setupWithGhost();
    const out = await withCwd(proj.root, async () => {
      const cap = captureContext();
      strictEqual(await run(buildPrune({ dryRun: true }), cap), 0);
      return cap.stdout();
    });
    match(out, /Would delete 2 stale findings/);
    match(out, /\(dry-run\)/);
  });

  it('interactive decline aborts without deleting', async () => {
    const proj = await setupWithGhost();
    const outcome = await withCwd(proj.root, async () => {
      const cap = captureWithStdin('n\n');
      const code = await run(buildPrune(), cap);
      return { code, err: cap.stderr() };
    });
    strictEqual(outcome.code, 0);
    match(outcome.err, /about to delete 2 stale findings/);
    match(outcome.err, /aborted by user/);
    strictEqual((await allRows(proj)).length, 5, 'nothing deleted after decline');
  });

  it('interactive accept deletes and reports the summary line', async () => {
    const proj = await setupWithGhost();
    const outcome = await withCwd(proj.root, async () => {
      const cap = captureWithStdin('y\n');
      const code = await run(buildPrune(), cap);
      return { code, out: cap.stdout() };
    });
    strictEqual(outcome.code, 0);
    match(outcome.out, /Deleted 2 stale findings/);
    strictEqual((await allRows(proj)).length, 3);
  });

  it('prints the friendly empty line when nothing is stale', async () => {
    const proj = await setupProject();
    // Wipe the seeded drift-stale row first so ONLY fresh rows remain.
    await withCwd(proj.root, async () =>
      run(buildPrune({ yes: true }), captureContext()),
    );
    const outcome = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const code = await run(buildPrune({ yes: true }), cap);
      return { code, out: cap.stdout() };
    });
    strictEqual(outcome.code, 0);
    match(outcome.out, /No stale findings\./);
  });

  it('exits 5 when the DB file is missing', async () => {
    counter += 1;
    const bare = join(tmpRoot, `prune-bare-${counter}`);
    mkdirSync(bare, { recursive: true });
    const code = await withCwd(bare, async () => run(buildPrune({ yes: true }), captureContext()));
    strictEqual(code, 5);
  });
});
