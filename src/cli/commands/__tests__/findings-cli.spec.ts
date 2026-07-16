/**
 * CLI tests for `sm findings` (`cli/commands/findings.ts`), the read
 * surface over `state_findings`. Rows are seeded straight through the
 * storage helpers (the write path is covered by the record specs); this
 * spec pins the verb contract (`spec/cli-contract.md` §sm findings):
 *
 *   - default read HIDES two disjoint kinds of row: `fixed` (a fixer
 *     resolved it, `--fixed` reveals it, rendered `✓ fixed by <fixer>`)
 *     and stale (`--stale` reveals it, marked `(stale)`). A fixed+stale
 *     row counts as fixed (state precedence). Open + declined rows always
 *     show.
 *   - excluded rows are REPORTED, never silently swallowed: the hidden
 *     breakdown rides the human output (footer, or the `No fresh findings`
 *     empty state, never a bare `No findings`) and `fixedExcluded` +
 *     `staleExcluded` in JSON, scoped to the same filters as the listing.
 *   - filters: -n, --extension (qualified + bare), --type, --severity
 *     (minimum), --since (ISO), --threshold (minimum confidence).
 *   - exit 0 regardless of content (advisory by construction), even on
 *     error-severity findings.
 *   - exit 2 on malformed flag values; exit 5 on a missing DB.
 *   - `--json` emits { ok, kind, findings[], total, fixedExcluded,
 *     staleExcluded }.
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
import {
  replaceFindingsForNode,
  stampFindingResolutions,
} from '../../../kernel/adapters/sqlite/findings.js';
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

/**
 * Seed a project whose findings are ALL stale (the node body moved on
 * after every judgment landed), spread over two type slugs:
 *   NODE_A: stale `contradiction` (finder-a) x1
 *           stale `redundancy`    (finder-a) x2
 * Backs the all-stale human shape, both plural forms, and the
 * filter-scoped hidden count (a `--type` filter must scope the count).
 */
async function setupAllStaleProject(): Promise<IProject> {
  counter += 1;
  const root = join(tmpRoot, `stale-proj-${counter}`);
  const dbPath = join(root, '.skill-map', 'skill-map.db');
  mkdirSync(join(root, '.skill-map'), { recursive: true });

  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  try {
    await insertNode(adapter, { path: NODE_A, bodyHash: HASH_A });
    // Every row was judged against a body hash the node no longer has.
    const base = {
      detail: null,
      extensionVersion: '1.0.0',
      jobId: null,
      model: null,
      origin: 'extension' as const,
      bodyHashAtGeneration: 'd'.repeat(64),
      generatedAt: T0,
      confidence: 0.7,
    };
    await replaceFindingsForNode(adapter.db, NODE_A, 'plug/finder-a', [
      { ...base, type: 'contradiction', severity: 'error', message: 'A contradicts B' },
      { ...base, type: 'redundancy', severity: 'info', message: 'Repeats itself' },
      { ...base, type: 'redundancy', severity: 'info', message: 'Repeats itself again' },
    ]);
  } finally {
    await adapter.close();
  }
  return { root, dbPath };
}

/**
 * Stamp a fixer resolution onto the seeded finding carrying `type`, through
 * the REAL adapter path (`stampFindingResolutions`) rather than raw SQL, so
 * these display tests read rows the record path could actually have
 * produced. Returns the stamped finding's id.
 */
async function stampResolutionOnType(
  proj: IProject,
  opts: { type: string; state: 'fixed' | 'declined'; note: string; by?: string },
): Promise<number> {
  const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
  await adapter.init();
  try {
    const target = (await adapter.findings.list({ includeStale: true })).find(
      (f) => f.type === opts.type,
    );
    ok(target, `seeded finding of type ${opts.type} exists`);
    await stampFindingResolutions(adapter.db, target.nodeId, {
      resolvedBy: opts.by ?? 'core/node-consolidate',
      // The finding's own finder: the fixer's declared scope.
      analyzerIds: [target.extensionId],
      resolvedAt: T1,
      entries: [{ id: target.id, state: opts.state, note: opts.note }],
    });
    return target.id;
  } finally {
    await adapter.close();
  }
}

interface IFlags {
  node?: string;
  extension?: string;
  type?: string;
  severity?: string;
  since?: string;
  threshold?: string;
  stale?: boolean;
  fixed?: boolean;
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
  cmd.fixed = flags.fixed ?? false;
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
  fixedExcluded: number;
  staleExcluded: number;
}

/** Run the verb in human mode and return stdout (colorless in tests). */
async function runHuman(root: string, flags: IFlags = {}): Promise<{ code: number; out: string }> {
  return withCwd(root, async () => {
    const cap = captureContext();
    const code = await run(buildFindings(flags), cap);
    return { code, out: cap.stdout() };
  });
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
  it('emits { ok, kind, findings, total, fixedExcluded, staleExcluded } with camelCase rows + stale=false, exit 0', async () => {
    const proj = await setupProject();
    const { code, body } = await runJson(proj.root);
    strictEqual(code, 0, 'exit 0 even with an error-severity finding (advisory)');
    strictEqual(body.ok, true);
    strictEqual(body.kind, 'findings');
    strictEqual(body.total, 3, 'stale row excluded by default');
    strictEqual(body.staleExcluded, 1, 'the excluded row is reported, never swallowed');
    strictEqual(body.fixedExcluded, 0, 'no fixer touched anything yet');
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

  it('--stale includes the drifted row flagged stale:true and excludes nothing', async () => {
    const proj = await setupProject();
    const { body } = await runJson(proj.root, { stale: true });
    strictEqual(body.total, 4);
    strictEqual(body.staleExcluded, 0, '--stale hides nothing, so nothing is excluded');
    strictEqual(body.fixedExcluded, 0, 'no fixed rows in the seed');
    const staleRow = body.findings.find((f) => f.type === 'incoherence')!;
    strictEqual(staleRow.stale, true);
    ok(body.findings.filter((f) => f.stale).length === 1, 'only the drifted row is stale');
  });

  it('staleExcluded is 0 when no row matched at all (the clean verdict)', async () => {
    const proj = await setupProject();
    const { body } = await runJson(proj.root, { type: 'no-such-slug' });
    strictEqual(body.total, 0);
    strictEqual(body.staleExcluded, 0);
  });

  it('staleExcluded carries the count when EVERY matching row is stale', async () => {
    const proj = await setupAllStaleProject();
    const { code, body } = await runJson(proj.root);
    strictEqual(code, 0);
    strictEqual(body.total, 0, 'no fresh rows to return');
    strictEqual(body.staleExcluded, 3, 'all three judgments are alive, just hidden');
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

/**
 * A fixer's outcome rides the finding it addressed as a lifecycle STATE
 * (`spec/db-schema.md` §state_findings). `fixed` and `declined` behave
 * asymmetrically ON PURPOSE: a `fixed` finding drops out of the default
 * view (a fixer handled it, `--fixed` reveals it under a checkmark), while
 * `declined` stays VISIBLE as the author's pending decision.
 */
describe('sm findings fixer resolution', () => {
  it('HIDES a fixed finding by default; --fixed reveals it as a handled state', async () => {
    const proj = await setupProject();
    await stampResolutionOnType(proj, {
      type: 'redundancy',
      state: 'fixed',
      note: 'Collapsed the two upload sentences into one.',
    });

    // Default view: the fixed finding is gone, accounted for in the footer.
    const def = await runHuman(proj.root);
    strictEqual(def.code, 0);
    doesNotMatch(def.out, /Repeats itself/, 'the fixed finding is hidden by default');
    match(def.out, /1 fixed/, 'the hidden breakdown accounts for it');

    // --fixed brings it back, rendered as a handled state under a checkmark.
    const shown = await runHuman(proj.root, { fixed: true });
    strictEqual(shown.code, 0);
    match(shown.out, /Repeats itself/, '--fixed reveals the row');
    match(
      shown.out,
      /✓ {2}fixed by core\/node-consolidate: Collapsed the two upload sentences into one\./,
      'a fixed row reads as handled, under a checkmark',
    );
    // Honest wording: still a state, never "resolved" / "verified".
    doesNotMatch(shown.out, /resolved|verified|unverified/i);
  });

  it('surfaces a `declined` note prominently under a warning glyph, visible by default', async () => {
    const proj = await setupProject();
    await stampResolutionOnType(proj, {
      type: 'contradiction',
      state: 'declined',
      note: 'The dev and prod steps are both intentional; only you can pick one.',
      by: 'core/node-reconcile',
    });
    const { code, out } = await runHuman(proj.root, { type: 'contradiction' });
    strictEqual(code, 0);
    match(
      out,
      /⚠ {2}core\/node-reconcile declined, needs your decision: The dev and prod steps are both intentional; only you can pick one\./,
      'the fixer, the refusal, and the TODO all land on one line',
    );
  });

  it('leaves an unresolved finding without a resolution line', async () => {
    const proj = await setupProject();
    const { out } = await runHuman(proj.root, { type: 'redundancy' });
    match(out, /Repeats itself/, 'the finding renders');
    doesNotMatch(out, /fixed by|declined, needs your decision/);
  });

  it('--json carries the resolution* fields on each entry', async () => {
    const proj = await setupProject();
    const id = await stampResolutionOnType(proj, {
      type: 'redundancy',
      state: 'declined',
      note: 'Needs an author decision.',
      by: 'core/node-consolidate',
    });
    const { body } = await runJson(proj.root, { type: 'redundancy' });
    const entry = body.findings.find((f) => f.id === id);
    ok(entry, 'the stamped finding is in the envelope');
    strictEqual(entry.resolution, 'declined');
    strictEqual(entry.resolutionNote, 'Needs an author decision.');
    strictEqual(entry.resolutionBy, 'core/node-consolidate');
    strictEqual(entry.resolutionAt, T1);

    // An untouched row reports the absence explicitly (null, not missing).
    const untouched = await runJson(proj.root, { type: 'injection-detected' });
    strictEqual(untouched.body.findings[0]!.resolution, null);
    strictEqual(untouched.body.findings[0]!.resolutionNote, null);
    strictEqual(untouched.body.findings[0]!.resolutionBy, null);
    strictEqual(untouched.body.findings[0]!.resolutionAt, null);
  });

  it('a hostile resolution note / fixer id is sanitized in human mode but raw in --json', async () => {
    // The note is FREE TEXT the draining agent authored and the kernel
    // stored verbatim: the most agent-controlled string on the row, so it
    // gets the same gate as a finder's message. A screen-clear smuggled
    // through it must never reach the operator's terminal.
    const proj = await setupProject();
    const hostileNote = '\u001b[2Jcleared your screen';
    const hostileBy = '\u001b[2Jevil/fixer';
    const id = await stampResolutionOnType(proj, {
      type: 'redundancy',
      state: 'declined',
      note: hostileNote,
      by: hostileBy,
    });
    const { out } = await runHuman(proj.root, { type: 'redundancy' });
    ok(out.includes('cleared your screen'), 'note text content survives');
    ok(out.includes('evil/fixer'), 'fixer id text survives');
    strictEqual(out.includes('\u001b['), false, 'escape bytes stripped at render');

    const { body } = await runJson(proj.root, { type: 'redundancy' });
    const entry = body.findings.find((f) => f.id === id);
    strictEqual(entry?.resolutionNote, hostileNote, 'machine surface round-trips raw');
    strictEqual(entry?.resolutionBy, hostileBy, 'machine surface round-trips raw');
  });

  it('flattens a multi-line note so the row stays one line', async () => {
    // A note with embedded newlines could otherwise forge what looks like
    // a second finding row underneath the real one.
    const proj = await setupProject();
    await stampResolutionOnType(proj, {
      type: 'redundancy',
      state: 'declined',
      note: 'First line.\nSecond line posing as its own row.',
    });
    const { out } = await runHuman(proj.root, { type: 'redundancy' });
    match(out, /First line\. Second line posing as its own row\./);
  });
});

/**
 * The stale filter must never swallow rows silently: an empty result
 * with hidden judgments claiming a clean node is what made the operator
 * conclude his data had been deleted (`spec/cli-contract.md` §sm
 * findings: "Excluded rows MUST be reported").
 */
describe('sm findings stale disclosure', () => {
  it('zero rows at all is the ONLY clean verdict: ✓ No findings, no hidden count', async () => {
    // `no-such-slug` matches nothing, fresh OR stale: nothing is hidden.
    const proj = await setupProject();
    const { code, out } = await runHuman(proj.root, { type: 'no-such-slug' });
    strictEqual(code, 0);
    match(out, /✓ {2}No findings\./, 'clean verdict keeps the success glyph');
    doesNotMatch(out, /stale hidden|fixed hidden/, 'nothing was held back, so nothing to report');
    doesNotMatch(out, /No fresh findings/);
  });

  it('zero fresh + stale hidden reads "No fresh findings" under ℹ, never a bare ✓ No findings', async () => {
    const proj = await setupAllStaleProject();
    const { code, out } = await runHuman(proj.root);
    strictEqual(code, 0, 'advisory read still exits 0');
    match(out, /ℹ {2}No fresh findings\./, 'neutral glyph: this is NOT a clean verdict');
    doesNotMatch(out, /✓/, 'the success glyph would assert a clean node while 3 judgments sit hidden');
    doesNotMatch(out, /^.*No findings\./m, 'the bare clean-verdict line is the lie being fixed');
    match(out, /3 stale hidden\./, 'the hidden breakdown is named');
    match(out, /--stale/, 'remedy 1: see them');
    match(out, /re-run the finders/, 'remedy 2: re-check them');
  });

  it('a listing with stale rows behind it carries the hidden count as a footer', async () => {
    const proj = await setupProject();
    const { code, out } = await runHuman(proj.root);
    strictEqual(code, 0);
    match(out, /sm findings: /, 'the normal listing still renders');
    match(out, /contradiction/);
    match(out, /ℹ {2}1 stale hidden\./, 'footer reports what the default filter held back');
    doesNotMatch(out, /declined by a fixer/, 'nothing hidden was declined, so no subset to name');
    match(out, /Pass --stale to see it/);
    // Footer sits between the last row and the tip.
    ok(
      out.indexOf('1 stale hidden') < out.indexOf('Tip:'),
      'hidden-count footer precedes the tip line',
    );
  });

  it('--stale hides nothing, so no hidden-count line is emitted', async () => {
    const proj = await setupProject();
    const { code, out } = await runHuman(proj.root, { stale: true });
    strictEqual(code, 0);
    match(out, /\(stale\)/, 'the row renders marked instead');
    // The hint only rides the hidden footer; a seeded finding detail happens
    // to contain the word "hidden" ("hidden instruction in a comment"), so
    // anchor on the footer's own remedy line instead.
    doesNotMatch(out, /re-run the finders/, 'nothing is excluded under --stale');
    doesNotMatch(out, /Pass --stale/, 'no remedy to offer, the flag is already on');
  });

  it('the hidden count is plural-correct: 1/it vs N/them', async () => {
    const proj = await setupAllStaleProject();
    const many = await runHuman(proj.root);
    match(many.out, /3 stale hidden\./);
    match(many.out, /Pass --stale to see them, or re-run the finders to re-check them\./);

    // `--type contradiction` narrows the hidden set to exactly one row.
    const one = await runHuman(proj.root, { type: 'contradiction' });
    match(one.out, /1 stale hidden\./);
    match(one.out, /Pass --stale to see it, or re-run the finders to re-check it\./);
  });

  it('the hidden count RESPECTS the active filters (--type scopes it, not the whole table)', async () => {
    // NODE_A holds 3 stale rows: 1 contradiction + 2 redundancy.
    const proj = await setupAllStaleProject();

    const byType = await runJson(proj.root, { type: 'contradiction' });
    strictEqual(byType.body.total, 0, 'no fresh contradiction rows');
    strictEqual(byType.body.staleExcluded, 1, 'counts ONLY the filtered type, not all 3 stale rows');
    strictEqual(byType.body.fixedExcluded, 0, 'no fixer touched anything');

    const other = await runJson(proj.root, { type: 'redundancy' });
    strictEqual(other.body.staleExcluded, 2, 'the other slug scopes to its own 2 rows');

    // Same rule for the other filter axes.
    const bySeverity = await runJson(proj.root, { severity: 'error' });
    strictEqual(bySeverity.body.staleExcluded, 1, 'minimum severity scopes the hidden count');
    const byNode = await runJson(proj.root, { node: NODE_B });
    strictEqual(byNode.body.staleExcluded, 0, 'a node with no rows hides nothing');

    // ... and the human line reports the scoped number, not the total.
    const human = await runHuman(proj.root, { type: 'contradiction' });
    match(human.out, /1 stale hidden\./);
    doesNotMatch(human.out, /3 stale hidden/);
  });
});

/**
 * The excluded-count line MUST name the declined subset
 * (`spec/cli-contract.md` §sm findings). This is the sharp edge of the
 * whole feature: a fixer's edits for the OTHER findings stale the WHOLE
 * node, so the one finding it refused, the one carrying a note that says
 * "only you can decide this", hides behind the default stale filter. A
 * bare "N stale hidden" would report the operator's TODO as ordinary
 * staleness and bury it exactly like the old report_json did. (A declined
 * row is never fixed, so it always lands in the STALE bucket when hidden.)
 */
describe('sm findings stale disclosure names declined rows', () => {
  it('names the declined subset in the footer under a listing', async () => {
    const proj = await setupProject();
    // The hidden (stale) row is finder-b's incoherence; a fixer declined it.
    await stampResolutionOnType(proj, {
      type: 'incoherence',
      state: 'declined',
      note: 'Only the author knows which section is right.',
      by: 'core/node-clarify',
    });
    const { code, out } = await runHuman(proj.root);
    strictEqual(code, 0);
    match(
      out,
      /1 stale hidden \(1 declined by a fixer, needing your decision\)\./,
      'the hidden TODO is named, not folded into a bare stale count',
    );
    match(out, /Pass --stale to see it/, 'the remedy still rides the line');
  });

  it('names the declined subset in the empty "No fresh findings" shape', async () => {
    const proj = await setupAllStaleProject();
    await stampResolutionOnType(proj, {
      type: 'contradiction',
      state: 'declined',
      note: 'Both branches are intentional; your call.',
    });
    const { code, out } = await runHuman(proj.root);
    strictEqual(code, 0);
    match(out, /ℹ {2}No fresh findings\./, 'still not a clean verdict');
    match(
      out,
      /3 stale hidden \(1 declined by a fixer, needing your decision\)\./,
      'the declined subset is named inside the plural stale count',
    );
  });

  it('a fixed row lands in the fixed count, declined stays in the stale bucket', async () => {
    const proj = await setupAllStaleProject();
    // Two of the three (all-stale) hidden rows carry a resolution: one
    // declined (the author's TODO), one FIXED. The fixed row counts under
    // `fixed` (state precedence over stale), so it neither inflates the
    // stale count nor the declined subset.
    await stampResolutionOnType(proj, {
      type: 'contradiction',
      state: 'declined',
      note: 'Your call.',
    });
    await stampResolutionOnType(proj, {
      type: 'redundancy',
      state: 'fixed',
      note: 'Collapsed it.',
    });
    const { out } = await runHuman(proj.root);
    match(out, /1 fixed, 2 stale hidden \(1 declined by a fixer, needing your decision\)\./);
    // Both flags are offered, since both buckets are populated.
    match(out, /Pass --fixed \/ --stale to see them/);
  });

  it('does NOT name declines when the hidden rows carry none', async () => {
    // Only a `fixed` state among the hidden rows: nothing is waiting on the
    // operator, so the breakdown carries no declined subset.
    const proj = await setupAllStaleProject();
    await stampResolutionOnType(proj, {
      type: 'contradiction',
      state: 'fixed',
      note: 'Collapsed it.',
    });
    const { out } = await runHuman(proj.root);
    match(out, /1 fixed, 2 stale hidden\./);
    doesNotMatch(out, /declined by a fixer/);
  });

  it('never names declines under --stale (nothing is hidden to report)', async () => {
    const proj = await setupProject();
    await stampResolutionOnType(proj, {
      type: 'incoherence',
      state: 'declined',
      note: 'Only the author knows.',
    });
    const { out } = await runHuman(proj.root, { stale: true });
    // The row renders in full instead, resolution line and all.
    match(out, /declined, needs your decision: Only the author knows\./);
    doesNotMatch(out, /re-run the finders/, 'the hidden footer never fires under --stale');
    doesNotMatch(out, /declined by a fixer/, 'the hidden-count fragment has no reason to fire');
  });

  it('the declined fragment respects the active filters', async () => {
    const proj = await setupAllStaleProject();
    await stampResolutionOnType(proj, {
      type: 'contradiction',
      state: 'declined',
      note: 'Your call.',
    });
    // `--type redundancy` scopes the hidden set to rows with no decline.
    const other = await runHuman(proj.root, { type: 'redundancy' });
    match(other.out, /2 stale hidden\./);
    doesNotMatch(other.out, /declined by a fixer/, 'the decline is outside this filter');
  });
});

/**
 * The `fixed` lifecycle state hides from the default view alongside stale
 * (two DISJOINT reasons, `spec/cli-contract.md` §sm findings). `--fixed`
 * reveals the fixed rows; the excluded-count line reports the two buckets
 * separately; a row that is BOTH fixed and stale counts as fixed.
 */
describe('sm findings fixed hiding', () => {
  it('default HIDES fixed rows and reports fixedExcluded beside staleExcluded', async () => {
    const proj = await setupProject();
    await stampResolutionOnType(proj, {
      type: 'redundancy',
      state: 'fixed',
      note: 'Collapsed it.',
    });
    const { body } = await runJson(proj.root);
    strictEqual(body.total, 2, 'contradiction + injection; fixed + stale rows held back');
    strictEqual(body.fixedExcluded, 1, 'the fixed row is reported');
    strictEqual(body.staleExcluded, 1, 'the stale row is reported separately');

    const human = await runHuman(proj.root);
    match(human.out, /1 fixed, 1 stale hidden\./, 'the two buckets are named disjointly');
    match(human.out, /Pass --fixed \/ --stale to see them/, 'both reveal flags offered');
  });

  it('--fixed reveals the fixed rows and drops fixedExcluded to 0', async () => {
    const proj = await setupProject();
    await stampResolutionOnType(proj, {
      type: 'redundancy',
      state: 'fixed',
      note: 'Collapsed it.',
    });
    const { body } = await runJson(proj.root, { fixed: true });
    strictEqual(body.total, 3, 'the fixed row joins the listing');
    strictEqual(body.fixedExcluded, 0, '--fixed reveals them, so none excluded');
    strictEqual(body.staleExcluded, 1, 'the stale row is still held back');
    ok(body.findings.some((f) => f.resolution === 'fixed'), 'the fixed row is present');
  });

  it('--fixed --stale reveals every row, nothing excluded', async () => {
    const proj = await setupProject();
    await stampResolutionOnType(proj, {
      type: 'redundancy',
      state: 'fixed',
      note: 'Collapsed it.',
    });
    const { body } = await runJson(proj.root, { fixed: true, stale: true });
    strictEqual(body.total, 4);
    strictEqual(body.fixedExcluded, 0);
    strictEqual(body.staleExcluded, 0);
  });

  it('a fixed+stale row counts as FIXED, never as stale (state precedence)', async () => {
    const proj = await setupProject();
    // incoherence is the seeded STALE row; a fixer marks it fixed.
    await stampResolutionOnType(proj, {
      type: 'incoherence',
      state: 'fixed',
      note: 'Edited the stale section too.',
    });
    const { body } = await runJson(proj.root);
    strictEqual(body.total, 3, 'the fixed+stale row is the only one hidden now');
    strictEqual(body.fixedExcluded, 1, 'counted as fixed');
    strictEqual(body.staleExcluded, 0, 'NOT double-counted as stale');

    const human = await runHuman(proj.root);
    match(human.out, /1 fixed hidden\./, 'the breakdown reports the single fixed row');
    match(human.out, /Pass --fixed to see it/, 'only the fixed reveal flag is offered');

    // --fixed reveals it even though it is also stale (fixed owns the row).
    const revealed = await runJson(proj.root, { fixed: true });
    strictEqual(revealed.body.total, 4);
    strictEqual(revealed.body.fixedExcluded, 0);
    strictEqual(revealed.body.staleExcluded, 0);
  });

  it('the fixed count is independent: 2 fixed, 1 stale hidden', async () => {
    const proj = await setupProject();
    await stampResolutionOnType(proj, { type: 'redundancy', state: 'fixed', note: 'a.' });
    await stampResolutionOnType(proj, { type: 'contradiction', state: 'fixed', note: 'b.' });
    const { body } = await runJson(proj.root);
    strictEqual(body.total, 1, 'only NODE_B injection remains fresh + open');
    strictEqual(body.fixedExcluded, 2);
    strictEqual(body.staleExcluded, 1);

    const human = await runHuman(proj.root);
    match(human.out, /2 fixed, 1 stale hidden\./, 'each count is plural-correct and disjoint');
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
