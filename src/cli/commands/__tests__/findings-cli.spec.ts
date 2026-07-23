/**
 * CLI tests for `sm findings` (`cli/commands/findings.ts`), the read
 * surface over `state_findings`. Rows are seeded straight through the
 * storage helpers (the write path is covered by the record specs); this
 * spec pins the verb contract (`spec/cli-contract.md` §sm findings):
 *
 *   - default read shows what needs attention (open + human-decision +
 *     stale rows, the stale ones riding INLINE marked `(stale)` per row;
 *     staleness is a per-row annotation since 2026-07-20, not a hidden
 *     bucket), HIDING two disjoint kinds of row: dismissed (an active
 *     suppression, top precedence) and `fixed` (already resolved). A
 *     fixed+stale row counts as fixed (state precedence).
 *   - the bucket flags are FILTERS, not additive reveals: `--fixed` shows
 *     ONLY the fixed bucket (rendered `✓ fixed by <actor>`), `--stale`
 *     narrows to ONLY the stale rows, together their union; the
 *     default-view rows are omitted and nothing is reported as excluded.
 *     An empty bucket-filter result reads the no-match line, never the
 *     clean verdict.
 *   - in the DEFAULT view, excluded rows are REPORTED, never silently
 *     swallowed: the hidden breakdown rides the human output (footer, or
 *     the `No fresh findings` empty state, never a bare `No findings`) and
 *     `dismissedExcluded` + `fixedExcluded` in JSON, scoped to the same
 *     filters as the listing. `staleExcluded` no longer exists anywhere.
 *   - filters: -n, --extension (qualified + bare), --type, --severity
 *     (minimum), --since (ISO), --threshold (minimum confidence).
 *   - exit 0 regardless of content (advisory by construction), even on
 *     error-severity findings.
 *   - exit 2 on malformed flag values; exit 5 on a missing DB.
 *   - `--json` emits { ok, kind, findings[], total, dismissedExcluded,
 *     fixedExcluded }.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strictEqual, deepStrictEqual, ok, match, doesNotMatch } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import { Readable } from 'node:stream';

import type { BaseContext } from 'clipanion';

import {
  FindingsClearCommand,
  FindingsCommand,
  FindingsPruneCommand,
  FindingsResolveCommand,
} from '../findings.js';
import { SqliteStorageAdapter } from '../../../kernel/adapters/sqlite/index.js';
import {
  replaceFindingsForNode,
  stampFindingResolutions,
} from '../../../kernel/adapters/sqlite/findings.js';
import type { IFindingRecord, TResolutionActor } from '../../../kernel/types/storage.js';

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
 * Backs the all-stale inline rendering (every row shows marked `(stale)`)
 * plus, once some rows are stamped `fixed`, the hidden-count plural forms
 * and the filter-scoped hidden count (a `--type` filter must scope it).
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
 * produced. Returns the stamped finding's id. `fixer` is the resolving
 * extension's qualified id (`resolution_by`); `actor` is the deciding
 * `resolution_actor` for a `fixed` entry (default `fixer`, i.e. a fully
 * autonomous fix), NULL for a `human-decision`.
 */
async function stampResolutionOnType(
  proj: IProject,
  opts: {
    type: string;
    state: 'fixed' | 'human-decision';
    note: string;
    fixer?: string;
    actor?: TResolutionActor;
  },
): Promise<number> {
  const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
  await adapter.init();
  try {
    const target = (await adapter.findings.list({ includeStale: true })).find(
      (f) => f.type === opts.type,
    );
    ok(target, `seeded finding of type ${opts.type} exists`);
    const by = opts.state === 'fixed' ? (opts.actor ?? 'fixer') : null;
    await stampFindingResolutions(adapter.db, target.nodeId, {
      resolvedBy: opts.fixer ?? 'core/ai-redundancy-action',
      // The finding's own finder: the fixer's declared scope.
      analyzerIds: [target.extensionId],
      resolvedAt: T1,
      entries: [{ id: target.id, state: opts.state, by, note: opts.note }],
    });
    return target.id;
  } finally {
    await adapter.close();
  }
}

/** Suppress a class on NODE_A via the write-through mirror (no `.sm` file). */
async function suppressOnMirror(
  proj: IProject,
  entries: Array<{ extension: string; type?: string }>,
): Promise<void> {
  const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
  await adapter.init();
  try {
    await adapter.scans.refreshAnnotations(NODE_A, { suppressions: entries });
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
  dismissed?: boolean;
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
  cmd.dismissed = flags.dismissed ?? false;
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
  dismissedExcluded: number;
  fixedExcluded: number;
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
  it('emits { ok, kind, findings, total, dismissedExcluded, fixedExcluded } with inline stale rows, exit 0', async () => {
    const proj = await setupProject();
    const { code, body } = await runJson(proj.root);
    strictEqual(code, 0, 'exit 0 even with an error-severity finding (advisory)');
    strictEqual(body.ok, true);
    strictEqual(body.kind, 'findings');
    strictEqual(body.total, 4, 'the stale row rides the default view inline');
    strictEqual(body.dismissedExcluded, 0, 'nothing suppressed');
    strictEqual(body.fixedExcluded, 0, 'no fixer touched anything yet');
    strictEqual('staleExcluded' in body, false, 'the stale bucket no longer exists (2026-07-20)');
    strictEqual(body.findings.length, 4);
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
    const staleRow = body.findings.find((f) => f.type === 'incoherence')!;
    strictEqual(staleRow.stale, true, 'the drifted row carries its per-row stale flag');
  });

  it('--stale shows ONLY the stale rows, drifted row flagged stale:true, default-view rows omitted', async () => {
    const proj = await setupProject();
    const { body } = await runJson(proj.root, { stale: true });
    strictEqual(body.total, 1, 'the drifted row is the whole stale set; fresh open rows are filtered out');
    strictEqual(body.dismissedExcluded, 0, 'an explicit bucket filter reports nothing as excluded');
    strictEqual(body.fixedExcluded, 0, 'no fixed rows in the seed');
    const only = body.findings[0]!;
    strictEqual(only.type, 'incoherence');
    strictEqual(only.stale, true);
    ok(!body.findings.some((f) => !f.stale), 'no fresh (needs-attention) row leaks into the stale view');
  });

  it('the excluded pair is 0 when no row matched at all (the clean verdict)', async () => {
    const proj = await setupProject();
    const { body } = await runJson(proj.root, { type: 'no-such-slug' });
    strictEqual(body.total, 0);
    strictEqual(body.dismissedExcluded, 0);
    strictEqual(body.fixedExcluded, 0);
  });

  it('shows every row inline when EVERY matching row is stale, nothing excluded', async () => {
    const proj = await setupAllStaleProject();
    const { code, body } = await runJson(proj.root);
    strictEqual(code, 0);
    strictEqual(body.total, 3, 'all three judgments ride the default view');
    ok(body.findings.every((f) => f.stale), 'each row carries its inline stale flag');
    strictEqual(body.dismissedExcluded, 0);
    strictEqual(body.fixedExcluded, 0);
    strictEqual('staleExcluded' in body, false, 'no stale bucket to report');
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
    strictEqual(body.total, 3, 'the error + both warn rows (the stale one riding inline)');
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

  it('prefixes each finding row with its id, right-aligned so glyphs stay in one column', async () => {
    const proj = await setupProject();
    const plain = await withCwd(proj.root, async () => {
      const cap = captureContext();
      strictEqual(await run(buildFindings(), cap), 0);
      return cap.stdout();
    });
    // Every rendered finding row carries `<id>:` before its glyph; the id is
    // the handle `sm findings resolve <id>` consumes.
    match(plain, /^\s*\d+:\s+[^\s]/m, 'a finding row leads with its id and a colon');
    // Right-alignment keeps the glyph column stable regardless of id width:
    // the `<n>:  ` prefix is padded so multi-digit ids do not shift the glyph.
    const rowLines = plain.split('\n').filter((l) => /^\s*\d+:/.test(l));
    ok(rowLines.length >= 1, 'at least one id-prefixed row rendered');
    const glyphCols = rowLines.map((l) => l.indexOf(':'));
    strictEqual(new Set(glyphCols).size, 1, 'the colon column is identical across rows');
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

  it('groups by node, glyph rows, stale row riding inline marked (stale)', async () => {
    const proj = await setupProject();
    const plain = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const code = await run(buildFindings(), cap);
      strictEqual(code, 0);
      return cap.stdout();
    });
    match(plain, /sm findings: /);
    match(plain, /1 error/);
    match(plain, /2 warnings/, 'the stale warn row counts in the summary too');
    match(plain, /1 info/);
    match(plain, new RegExp(NODE_A.replace(/[./]/g, '\\$&')));
    match(plain, /plug\/finder-a/);
    match(plain, /contradiction/);
    match(plain, /\(90%\)/, 'confidence rendered as a percent');
    match(plain, /hidden instruction in a comment/, 'detail line rendered');
    match(plain, /incoherence/, 'the stale row rides the default view');
    match(plain, /\(stale\)/, 'marked in place, per row');

    const withStale = await withCwd(proj.root, async () => {
      const cap = captureContext();
      await run(buildFindings({ stale: true }), cap);
      return cap.stdout();
    });
    match(withStale, /incoherence/);
    match(withStale, /\(stale\)/, 'included row is marked');
    doesNotMatch(withStale, /contradiction/, '--stale is a FILTER: fresh needs-attention rows are omitted');
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
 * A resolution rides the finding it addressed as a lifecycle STATE
 * (`spec/db-schema.md` §state_findings). `fixed` and `human-decision`
 * behave asymmetrically ON PURPOSE: a `fixed` finding drops out of the
 * default view (already handled, `--fixed` reveals it under a checkmark
 * naming the deciding actor), while `human-decision` stays VISIBLE as the
 * author's pending decision (the fixer's proposal).
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
    // Default actor is `fixer` (a fully autonomous fix), so the wording is
    // the plain `fixed by <fixer>` shape.
    const shown = await runHuman(proj.root, { fixed: true });
    strictEqual(shown.code, 0);
    match(shown.out, /Repeats itself/, '--fixed reveals the row');
    match(
      shown.out,
      /✓ {2}fixed by core\/ai-redundancy-action: Collapsed the two upload sentences into one\./,
      'a fixer-decided fixed row reads as handled, under a checkmark',
    );
    // Honest wording: still a state, never "resolved" / "verified".
    doesNotMatch(shown.out, /resolved|verified|unverified/i);
  });

  it('names the deciding actor on a fixed row: fixer vs your decision', async () => {
    // Two of the three actor shapes (`spec/db-schema.md` §state_findings):
    // a fully autonomous `fixer` fix vs a `human` decision WITH a fixer that
    // ran. The third (no fixer) is `sm findings resolve`'s own test.
    const autonomous = await setupProject();
    await stampResolutionOnType(autonomous, {
      type: 'redundancy',
      state: 'fixed',
      actor: 'fixer',
      fixer: 'core/ai-redundancy-action',
      note: 'Collapsed it.',
    });
    match(
      (await runHuman(autonomous.root, { fixed: true })).out,
      /✓ {2}fixed by core\/ai-redundancy-action: Collapsed it\./,
      'a fixer decision reads `fixed by <fixer>`',
    );

    const attended = await setupProject();
    await stampResolutionOnType(attended, {
      type: 'redundancy',
      state: 'fixed',
      actor: 'human',
      fixer: 'core/ai-redundancy-action',
      note: 'Approved the edit.',
    });
    match(
      (await runHuman(attended.root, { fixed: true })).out,
      /✓ {2}fixed by core\/ai-redundancy-action \(your decision\): Approved the edit\./,
      'a human decision with a fixer reads `(your decision)`',
    );
  });

  it('surfaces a `human-decision` note prominently under a warning glyph, visible by default', async () => {
    const proj = await setupProject();
    await stampResolutionOnType(proj, {
      type: 'contradiction',
      state: 'human-decision',
      note: 'The dev and prod steps are both intentional; only you can pick one.',
      fixer: 'core/ai-contradiction-action',
    });
    const { code, out } = await runHuman(proj.root, { type: 'contradiction' });
    strictEqual(code, 0);
    match(
      out,
      /⚠ {2}core\/ai-contradiction-action proposes, your decision: The dev and prod steps are both intentional; only you can pick one\./,
      'the fixer, its proposal, and the TODO all land on one line',
    );
  });

  it('leaves an unresolved finding without a resolution line', async () => {
    const proj = await setupProject();
    const { out } = await runHuman(proj.root, { type: 'redundancy' });
    match(out, /Repeats itself/, 'the finding renders');
    doesNotMatch(out, /fixed by|proposes, your decision/);
  });

  it('--json carries the resolution* fields on each entry', async () => {
    const proj = await setupProject();
    const id = await stampResolutionOnType(proj, {
      type: 'redundancy',
      state: 'human-decision',
      note: 'Needs an author decision.',
      fixer: 'core/ai-redundancy-action',
    });
    const { body } = await runJson(proj.root, { type: 'redundancy' });
    const entry = body.findings.find((f) => f.id === id);
    ok(entry, 'the stamped finding is in the envelope');
    strictEqual(entry.resolution, 'human-decision');
    strictEqual(entry.resolutionActor, null, 'a human-decision has no decided actor');
    strictEqual(entry.resolutionNote, 'Needs an author decision.');
    strictEqual(entry.resolutionBy, 'core/ai-redundancy-action');
    strictEqual(entry.resolutionAt, T1);

    // An untouched row reports the absence explicitly (null, not missing).
    const untouched = await runJson(proj.root, { type: 'injection-detected' });
    strictEqual(untouched.body.findings[0]!.resolution, null);
    strictEqual(untouched.body.findings[0]!.resolutionActor, null);
    strictEqual(untouched.body.findings[0]!.resolutionNote, null);
    strictEqual(untouched.body.findings[0]!.resolutionBy, null);
    strictEqual(untouched.body.findings[0]!.resolutionAt, null);
  });

  it('a hostile resolution note / fixer id is sanitized in human mode but raw in --json', async () => {
    // The note is FREE TEXT the processing agent authored and the kernel
    // stored verbatim: the most agent-controlled string on the row, so it
    // gets the same gate as a finder's message. A screen-clear smuggled
    // through it must never reach the operator's terminal.
    const proj = await setupProject();
    const hostileNote = '\u001b[2Jcleared your screen';
    const hostileBy = '\u001b[2Jevil/fixer';
    const id = await stampResolutionOnType(proj, {
      type: 'redundancy',
      state: 'human-decision',
      note: hostileNote,
      fixer: hostileBy,
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
      state: 'human-decision',
      note: 'First line.\nSecond line posing as its own row.',
    });
    const { out } = await runHuman(proj.root, { type: 'redundancy' });
    match(out, /First line\. Second line posing as its own row\./);
  });
});

/**
 * The default filter must never swallow rows silently: an empty result
 * with hidden judgments claiming a clean node is what made the operator
 * conclude his data had been deleted (`spec/cli-contract.md` §sm
 * findings: "Excluded rows MUST be reported"). Stale rows stopped hiding
 * on 2026-07-20 (they ride the default view inline, marked per row), so
 * the hidden set is dismissed + fixed only.
 */
describe('sm findings hidden-row disclosure', () => {
  it('zero rows at all is the ONLY clean verdict: ✓ No findings, no hidden count', async () => {
    // `no-such-slug` matches nothing, fresh OR stale: nothing is hidden.
    const proj = await setupProject();
    const { code, out } = await runHuman(proj.root, { type: 'no-such-slug' });
    strictEqual(code, 0);
    match(out, /✓ {2}No findings\./, 'clean verdict keeps the success glyph');
    doesNotMatch(out, /dismissed hidden|fixed hidden/, 'nothing was held back, so nothing to report');
    doesNotMatch(out, /No fresh findings/);
  });

  it('an all-stale project renders every row inline marked (stale), never an empty No-fresh shape', async () => {
    const proj = await setupAllStaleProject();
    const { code, out } = await runHuman(proj.root);
    strictEqual(code, 0, 'advisory read still exits 0');
    match(out, /sm findings: /, 'the normal listing renders, not an empty state');
    strictEqual(out.match(/\(stale\)/g)?.length, 3, 'every stale row is marked in place');
    doesNotMatch(out, /No fresh findings/, 'nothing is held back, so no empty breakdown');
    doesNotMatch(out, /re-run the finders/, 'no hidden footer either');
  });

  it('a listing with a stale row carries it INLINE, no hidden-count footer', async () => {
    const proj = await setupProject();
    const { code, out } = await runHuman(proj.root);
    strictEqual(code, 0);
    match(out, /sm findings: /, 'the normal listing still renders');
    match(out, /contradiction/);
    match(out, /incoherence/, 'the stale row shows in the default view');
    match(out, /\(stale\)/, 'marked in place, not buried in a footer');
    // The seeded NODE_B detail contains the word "hidden" ("hidden
    // instruction in a comment"), so anchor on the footer's own shapes.
    doesNotMatch(out, /hidden\./, 'nothing is held back, so the footer never renders');
    doesNotMatch(out, /re-run the finders/, 'no remedy hint without a hidden set');
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
    // One fixed row hides -> singular pronoun; a second one -> plural.
    await stampResolutionOnType(proj, { type: 'contradiction', state: 'fixed', note: 'a.' });
    const one = await runHuman(proj.root);
    match(one.out, /1 fixed hidden\./);
    match(one.out, /Pass --fixed to see it, or re-run the finders to re-check it\./);

    await stampResolutionOnType(proj, { type: 'redundancy', state: 'fixed', note: 'b.' });
    const many = await runHuman(proj.root);
    match(many.out, /2 fixed hidden\./);
    match(many.out, /Pass --fixed to see them, or re-run the finders to re-check them\./);
  });

  it('the hidden count RESPECTS the active filters (--type scopes it, not the whole table)', async () => {
    // NODE_A holds 3 stale rows: 1 contradiction + 2 redundancy. Fixing
    // the contradiction and ONE redundancy leaves one row shown (stale,
    // inline) and two hidden fixed rows for the filters to scope.
    const proj = await setupAllStaleProject();
    await stampResolutionOnType(proj, { type: 'contradiction', state: 'fixed', note: 'a.' });
    await stampResolutionOnType(proj, { type: 'redundancy', state: 'fixed', note: 'b.' });

    const byType = await runJson(proj.root, { type: 'contradiction' });
    strictEqual(byType.body.total, 0, 'the only contradiction row is fixed');
    strictEqual(byType.body.fixedExcluded, 1, 'counts ONLY the filtered type, not both fixed rows');
    strictEqual(byType.body.dismissedExcluded, 0, 'nothing suppressed');

    const other = await runJson(proj.root, { type: 'redundancy' });
    strictEqual(other.body.total, 1, 'the unfixed redundancy row shows, stale inline');
    strictEqual(other.body.fixedExcluded, 1, 'the other slug scopes to its own fixed row');

    // Same rule for the other filter axes.
    const bySeverity = await runJson(proj.root, { severity: 'error' });
    strictEqual(bySeverity.body.fixedExcluded, 1, 'minimum severity scopes the hidden count');
    const byNode = await runJson(proj.root, { node: NODE_B });
    strictEqual(byNode.body.fixedExcluded, 0, 'a node with no rows hides nothing');

    // ... and the human line reports the scoped number, not the total.
    const human = await runHuman(proj.root, { type: 'contradiction' });
    match(human.out, /1 fixed hidden\./);
    doesNotMatch(human.out, /2 fixed hidden/);
  });
});

/**
 * The excluded-count line MUST name the human-decision subset
 * (`spec/cli-contract.md` §sm findings). With stale rows riding the
 * default view inline (2026-07-20), a non-suppressed `human-decision`
 * row ALWAYS shows: the author's TODO no longer hides behind the
 * staleness a fixer's own edits caused. The only way a `human-decision`
 * row hides now is the operator's OWN dismissal (an active suppression),
 * so the fragment guards the TODO against exactly that.
 */
describe('sm findings hidden-row disclosure names human-decision rows', () => {
  it('a stale human-decision row SHOWS in the default view (the author TODO surfaces)', async () => {
    const proj = await setupProject();
    // The stale row is finder-b's incoherence; a fixer left it as a
    // human-decision. It used to hide behind the stale bucket; now it
    // rides the default view inline, proposal and all.
    await stampResolutionOnType(proj, {
      type: 'incoherence',
      state: 'human-decision',
      note: 'Only the author knows which section is right.',
      fixer: 'core/ai-incoherence-action',
    });
    const { code, out } = await runHuman(proj.root);
    strictEqual(code, 0);
    match(out, /incoherence/, 'the row renders in the default view');
    match(out, /\(stale\)/, 'still marked stale in place');
    match(
      out,
      /proposes, your decision: Only the author knows which section is right\./,
      'the proposal rides the row, not a footer',
    );
    doesNotMatch(out, /awaiting your decision/, 'nothing hidden, so no subset to name');
    doesNotMatch(out, /re-run the finders/, 'no hidden footer at all');
  });

  it('names the suppressed human-decision subset in the footer under a listing', async () => {
    const proj = await setupProject();
    // A fixer left the contradiction as a human-decision; the operator
    // then dismissed the class. Only a suppression can hide a TODO now.
    await stampResolutionOnType(proj, {
      type: 'contradiction',
      state: 'human-decision',
      note: 'Your call on which branch.',
      fixer: 'core/ai-contradiction-action',
    });
    await suppressOnMirror(proj, [{ extension: 'plug/finder-a', type: 'contradiction' }]);
    const { code, out } = await runHuman(proj.root);
    strictEqual(code, 0);
    match(
      out,
      /1 dismissed hidden \(1 awaiting your decision\)\./,
      'the dismissed TODO is named, not folded into a bare dismissed count',
    );
    match(out, /Pass --dismissed to see it/, 'the remedy still rides the line');
  });

  it('names the human-decision subset in the empty "No fresh findings" shape', async () => {
    const proj = await setupProject();
    await stampResolutionOnType(proj, {
      type: 'contradiction',
      state: 'human-decision',
      note: 'Both branches are intentional; your call.',
    });
    await suppressOnMirror(proj, [{ extension: 'plug/finder-a', type: 'contradiction' }]);
    // `--type contradiction` narrows to the suppressed TODO alone: an
    // empty view whose one hidden row awaits the author.
    const { code, out } = await runHuman(proj.root, { type: 'contradiction' });
    strictEqual(code, 0);
    match(out, /ℹ {2}No fresh findings\./, 'still not a clean verdict');
    match(
      out,
      /1 dismissed hidden \(1 awaiting your decision\)\./,
      'the human-decision subset is named inside the dismissed count',
    );
  });

  it('a fixed row lands in the fixed count while the human-decision row stays VISIBLE', async () => {
    const proj = await setupAllStaleProject();
    // Two of the three (all-stale) rows carry a resolution: one
    // human-decision (the author's TODO, shown inline now) and one FIXED
    // (hidden, state precedence over stale). Only the fixed row hides,
    // so the breakdown carries no human-decision subset.
    await stampResolutionOnType(proj, {
      type: 'contradiction',
      state: 'human-decision',
      note: 'Your call.',
    });
    await stampResolutionOnType(proj, {
      type: 'redundancy',
      state: 'fixed',
      note: 'Collapsed it.',
    });
    const { out } = await runHuman(proj.root);
    match(out, /proposes, your decision: Your call\./, 'the TODO renders in the default view');
    match(out, /1 fixed hidden\./, 'only the fixed row is reported hidden');
    doesNotMatch(out, /awaiting your decision/, 'the visible TODO is not hidden, no subset to name');
    match(out, /Pass --fixed to see it/, 'only the fixed reveal flag is offered');
  });

  it('does NOT name a human-decision when the hidden rows carry none', async () => {
    // Only a `fixed` state among the hidden rows: nothing is waiting on the
    // operator, so the breakdown carries no human-decision subset.
    const proj = await setupAllStaleProject();
    await stampResolutionOnType(proj, {
      type: 'contradiction',
      state: 'fixed',
      note: 'Collapsed it.',
    });
    const { out } = await runHuman(proj.root);
    match(out, /1 fixed hidden\./);
    doesNotMatch(out, /awaiting your decision/);
  });

  it('never names a human-decision under --stale (nothing is hidden to report)', async () => {
    const proj = await setupProject();
    await stampResolutionOnType(proj, {
      type: 'incoherence',
      state: 'human-decision',
      note: 'Only the author knows.',
    });
    const { out } = await runHuman(proj.root, { stale: true });
    // The row renders in full instead, resolution line and all.
    match(out, /proposes, your decision: Only the author knows\./);
    doesNotMatch(out, /re-run the finders/, 'the hidden footer never fires under --stale');
    doesNotMatch(out, /awaiting your decision/, 'the hidden-count fragment has no reason to fire');
  });

  it('the human-decision fragment respects the active filters', async () => {
    const proj = await setupProject();
    await stampResolutionOnType(proj, {
      type: 'contradiction',
      state: 'human-decision',
      note: 'Your call.',
    });
    await suppressOnMirror(proj, [{ extension: 'plug/finder-a', type: 'contradiction' }]);
    await stampResolutionOnType(proj, { type: 'redundancy', state: 'fixed', note: 'Done.' });
    // Unscoped: both hidden buckets, the suppressed TODO named.
    const all = await runHuman(proj.root);
    match(all.out, /1 dismissed, 1 fixed hidden \(1 awaiting your decision\)\./);
    // `--type redundancy` scopes the hidden set to rows with no human-decision.
    const other = await runHuman(proj.root, { type: 'redundancy' });
    match(other.out, /1 fixed hidden\./);
    doesNotMatch(other.out, /awaiting your decision/, 'the human-decision is outside this filter');
  });
});

/**
 * The `fixed` lifecycle state hides from the default view
 * (`spec/cli-contract.md` §sm findings) while stale rows ride it inline.
 * `--fixed` reveals the fixed rows; the excluded-count pair reports the
 * dismissed / fixed buckets; a row that is BOTH fixed and stale counts as
 * fixed (state precedence), so it hides too.
 */
describe('sm findings fixed hiding', () => {
  it('default HIDES fixed rows and reports fixedExcluded; the stale row rides inline', async () => {
    const proj = await setupProject();
    await stampResolutionOnType(proj, {
      type: 'redundancy',
      state: 'fixed',
      note: 'Collapsed it.',
    });
    const { body } = await runJson(proj.root);
    strictEqual(body.total, 3, 'contradiction + injection + the inline stale row; only the fixed row held back');
    strictEqual(body.fixedExcluded, 1, 'the fixed row is reported');
    strictEqual(body.dismissedExcluded, 0, 'no suppression in play');
    strictEqual('staleExcluded' in body, false, 'the stale bucket no longer exists');
    ok(body.findings.some((f) => f.stale), 'the stale row is in the listing, flagged per row');

    const human = await runHuman(proj.root);
    match(human.out, /1 fixed hidden\./, 'the single hidden bucket is named');
    match(human.out, /Pass --fixed to see it/, 'only the fixed reveal flag is offered');
  });

  it('--fixed shows ONLY the fixed bucket, both excluded counts 0', async () => {
    const proj = await setupProject();
    await stampResolutionOnType(proj, {
      type: 'redundancy',
      state: 'fixed',
      note: 'Collapsed it.',
    });
    const { body } = await runJson(proj.root, { fixed: true });
    strictEqual(body.total, 1, 'only the fixed row survives the filter');
    strictEqual(body.fixedExcluded, 0, 'an explicit bucket filter reports nothing as excluded');
    strictEqual(body.dismissedExcluded, 0, 'nothing dismissed either');
    strictEqual('staleExcluded' in body, false, 'the stale bucket no longer exists');
    ok(body.findings.every((f) => f.resolution === 'fixed'), 'no needs-attention or stale row leaks in');
  });

  it('--fixed --stale shows the UNION of the two buckets, nothing excluded', async () => {
    const proj = await setupProject();
    await stampResolutionOnType(proj, {
      type: 'redundancy',
      state: 'fixed',
      note: 'Collapsed it.',
    });
    const { body } = await runJson(proj.root, { fixed: true, stale: true });
    strictEqual(body.total, 2, 'the fixed row + the stale row, no open rows');
    strictEqual(body.fixedExcluded, 0);
    strictEqual(body.dismissedExcluded, 0);
    ok(
      body.findings.every((f) => f.resolution === 'fixed' || f.stale),
      'every returned row is in the fixed or stale bucket',
    );
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
    strictEqual(body.dismissedExcluded, 0, 'nothing suppressed');
    ok(!body.findings.some((f) => f.stale), 'no OTHER stale row rides the view; the fixed one hides');

    const human = await runHuman(proj.root);
    match(human.out, /1 fixed hidden\./, 'the breakdown reports the single fixed row');
    match(human.out, /Pass --fixed to see it/, 'only the fixed reveal flag is offered');

    // --fixed shows it even though it is also stale (fixed owns the row); the
    // fixed bucket is the whole view, so only that one row comes back.
    const revealed = await runJson(proj.root, { fixed: true });
    strictEqual(revealed.body.total, 1, 'the fixed+stale row is the only member of the fixed bucket');
    strictEqual(revealed.body.fixedExcluded, 0);
    strictEqual(revealed.body.dismissedExcluded, 0);
    strictEqual(revealed.body.findings[0]!.resolution, 'fixed');
    strictEqual(revealed.body.findings[0]!.stale, true, 'the row is still marked stale in the fixed view');
  });

  it('the fixed count is independent: 2 fixed hidden, the stale row rides inline', async () => {
    const proj = await setupProject();
    await stampResolutionOnType(proj, { type: 'redundancy', state: 'fixed', note: 'a.' });
    await stampResolutionOnType(proj, { type: 'contradiction', state: 'fixed', note: 'b.' });
    const { body } = await runJson(proj.root);
    strictEqual(body.total, 2, 'NODE_B injection + the inline stale incoherence row');
    strictEqual(body.fixedExcluded, 2);
    strictEqual('staleExcluded' in body, false, 'no stale bucket to report');

    const human = await runHuman(proj.root);
    match(human.out, /2 fixed hidden\./, 'the count is plural-correct');
  });
});

/**
 * The bucket flags are FILTERS, not additive reveals (`spec/cli-contract.md`
 * §sm findings). `--fixed` shows ONLY the fixed bucket, `--stale` narrows to
 * ONLY the stale rows, together their union; the other default-view rows
 * (open + human-decision) are omitted and the excluded-count reporting is off
 * (it is a DEFAULT-view honesty device). An empty bucket-filter result reads
 * the no-match line, never the clean verdict, never the No-fresh breakdown.
 */
describe('sm findings bucket flags are filters', () => {
  /**
   * One row of each lifecycle shape on the same tree, so a bucket filter has
   * something in EVERY category to include or exclude:
   *   contradiction (human-decision, fresh) - needs attention, stays in default
   *   redundancy    (fixed)                  - the fixed bucket
   *   incoherence   (stale, open)            - default view (inline, marked),
   *                                            the `--stale` narrowing target
   *   injection     (open, fresh)            - needs attention, stays in default
   */
  async function setupMixedProject(): Promise<IProject> {
    const proj = await setupProject();
    await stampResolutionOnType(proj, {
      type: 'redundancy',
      state: 'fixed',
      note: 'Collapsed it.',
    });
    await stampResolutionOnType(proj, {
      type: 'contradiction',
      state: 'human-decision',
      note: 'Your call on which branch.',
      fixer: 'core/ai-contradiction-action',
    });
    return proj;
  }

  it('--fixed shows ONLY the fixed bucket; open, human-decision and stale rows are absent', async () => {
    const proj = await setupMixedProject();
    const { code, out } = await runHuman(proj.root, { fixed: true });
    strictEqual(code, 0);
    match(out, /Repeats itself/, 'the fixed redundancy row is shown');
    match(out, /✓ {2}fixed by/, 'rendered as a handled state under a checkmark');
    doesNotMatch(out, /A contradicts B/, 'the human-decision row is NOT in the fixed view');
    doesNotMatch(out, /Sections disagree/, 'the stale row is NOT in the fixed view');
    doesNotMatch(out, /prompt-injection/, 'the open row is NOT in the fixed view');
    doesNotMatch(out, /re-run the finders/, 'no excluded-count line under an explicit bucket filter');
  });

  it('--stale shows ONLY the stale (non-fixed) bucket', async () => {
    const proj = await setupMixedProject();
    const { out } = await runHuman(proj.root, { stale: true });
    match(out, /Sections disagree/, 'the stale incoherence row is shown');
    match(out, /\(stale\)/, 'marked stale');
    doesNotMatch(out, /Repeats itself/, 'the fixed row is not part of the stale bucket');
    doesNotMatch(out, /A contradicts B/, 'the fresh human-decision row is omitted');
    doesNotMatch(out, /prompt-injection/, 'the open row is omitted');
  });

  it('--fixed --stale shows the UNION of both buckets, still no needs-attention rows', async () => {
    const proj = await setupMixedProject();
    const { body } = await runJson(proj.root, { fixed: true, stale: true });
    strictEqual(body.total, 2, 'the fixed row + the stale row');
    strictEqual(body.fixedExcluded, 0);
    strictEqual(body.dismissedExcluded, 0);
    ok(body.findings.some((f) => f.resolution === 'fixed'), 'fixed bucket present');
    ok(body.findings.some((f) => f.stale && f.resolution !== 'fixed'), 'stale bucket present');
    ok(
      body.findings.every((f) => f.resolution === 'fixed' || f.stale),
      'every returned row is in the fixed or stale bucket (no open / human-decision rows)',
    );
  });

  it('--fixed --json returns only the fixed rows with both excluded counts at 0', async () => {
    const proj = await setupMixedProject();
    const { body } = await runJson(proj.root, { fixed: true });
    strictEqual(body.total, 1);
    strictEqual(body.fixedExcluded, 0);
    strictEqual(body.dismissedExcluded, 0);
    strictEqual('staleExcluded' in body, false, 'the stale bucket no longer exists');
    ok(body.findings.every((f) => f.resolution === 'fixed'), 'only fixed rows returned');
  });

  it('composes with --type: --fixed --type scopes the fixed view to the slug', async () => {
    const proj = await setupMixedProject();
    // redundancy is the fixed row; contradiction is human-decision, not fixed.
    const hit = await runJson(proj.root, { fixed: true, type: 'redundancy' });
    strictEqual(hit.body.total, 1, 'the fixed redundancy row matches the type');
    strictEqual(hit.body.findings[0]!.type, 'redundancy');

    const miss = await runJson(proj.root, { fixed: true, type: 'contradiction' });
    strictEqual(miss.body.total, 0, 'contradiction is human-decision, not fixed: no match');
    strictEqual(miss.body.fixedExcluded, 0);
    strictEqual(miss.body.dismissedExcluded, 0);
  });

  it('an empty bucket-filter result uses the no-match shape, never the clean verdict or the No-fresh block', async () => {
    const proj = await setupMixedProject();
    // --fixed --type contradiction: rows DO exist (contradiction is present as
    // a human-decision), but none are in the fixed bucket, so the view is
    // empty while the node is NOT clean.
    const human = await runHuman(proj.root, { fixed: true, type: 'contradiction' });
    strictEqual(human.code, 0);
    match(human.out, /No findings match the current filter\./, 'the neutral no-match line');
    doesNotMatch(human.out, /✓ {2}No findings\./, 'never the clean verdict: rows sit behind the filter');
    doesNotMatch(human.out, /No fresh findings/, 'never the excluded-count block under a bucket filter');
    doesNotMatch(human.out, /hidden\./, 'no hidden breakdown');

    const json = await runJson(proj.root, { fixed: true, type: 'contradiction' });
    strictEqual(json.body.total, 0);
    strictEqual(json.body.findings.length, 0);
    strictEqual(json.body.fixedExcluded, 0);
    strictEqual(json.body.dismissedExcluded, 0);
  });

  it('a bucket filter that matches no rows AT ALL keeps the clean verdict (the one clean-verdict case)', async () => {
    // --fixed --type no-such-slug: the query returns nothing at all, so this
    // is the one clean-verdict case (spec: "a node with no rows at all is the
    // only clean-verdict output"), NOT a no-match.
    const proj = await setupMixedProject();
    const { out } = await runHuman(proj.root, { fixed: true, type: 'no-such-slug' });
    match(out, /✓ {2}No findings\./, 'zero rows at all keeps the clean verdict');
    doesNotMatch(out, /No findings match/, 'not the no-match line');
  });

  it('the DEFAULT view (no bucket flag): needs-attention + inline stale shown, fixed hidden and reported', async () => {
    const proj = await setupMixedProject();
    const { body } = await runJson(proj.root);
    strictEqual(body.total, 3, 'the human-decision + open + stale rows show');
    strictEqual(body.fixedExcluded, 1, 'the fixed row is reported hidden');
    strictEqual(body.dismissedExcluded, 0, 'nothing suppressed');
    strictEqual('staleExcluded' in body, false, 'stale rows are never held back');
    ok(
      body.findings.some((f) => f.resolution === 'human-decision'),
      'the human-decision TODO stays visible in the default view',
    );
    ok(
      body.findings.some((f) => f.stale),
      'the stale row rides the default view flagged per row',
    );
  });
});

/**
 * `sm findings resolve <id>`, the operator marking a finding fixed himself
 * (`spec/cli-contract.md`): sets `resolution = 'fixed'`, `resolution_actor
 * = 'human'`, `resolution_by = NULL` (no fixer ran), the optional `--note`.
 * It records a human decision, NOT a verification; the row then hides from
 * the default view like any `fixed` row. Eligible from OPEN or
 * `human-decision`; exit 5 on an unknown id, exit 2 when already `fixed` or
 * on a non-integer id.
 */
describe('sm findings resolve', () => {
  function buildResolve(
    id: string,
    opts: { note?: string; json?: boolean } = {},
  ): FindingsResolveCommand {
    const cmd = new FindingsResolveCommand();
    cmd.id = id;
    cmd.note = opts.note;
    cmd.json = opts.json ?? false;
    cmd.db = undefined;
    return cmd;
  }

  /** The id of the seeded OPEN `redundancy` finding on NODE_A. */
  async function openFindingId(proj: IProject): Promise<number> {
    const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
    await adapter.init();
    try {
      const target = (await adapter.findings.list({ includeStale: true })).find(
        (f) => f.type === 'redundancy',
      );
      ok(target, 'seeded redundancy finding exists');
      return target.id;
    } finally {
      await adapter.close();
    }
  }

  it('marks an open finding fixed by the operator (fixed + human + null fixer), --json row', async () => {
    const proj = await setupProject();
    const id = await openFindingId(proj);
    const outcome = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const code = await run(
        buildResolve(String(id), { note: 'Rewrote the section by hand.', json: true }),
        cap,
      );
      return {
        code,
        body: JSON.parse(cap.stdout()) as { ok: boolean; kind: string; finding: IFindingRecord },
      };
    });
    strictEqual(outcome.code, 0);
    strictEqual(outcome.body.ok, true);
    strictEqual(outcome.body.kind, 'finding');
    const f = outcome.body.finding;
    strictEqual(f.id, id);
    strictEqual(f.resolution, 'fixed');
    strictEqual(f.resolutionActor, 'human');
    strictEqual(f.resolutionBy, null, 'no fixer ran');
    strictEqual(f.resolutionNote, 'Rewrote the section by hand.');
    ok(typeof f.resolutionAt === 'number' && f.resolutionAt > 0, 'stamped with a time');
  });

  it('renders `fixed by you` (no fixer) and hides the row from the default view', async () => {
    const proj = await setupProject();
    const id = await openFindingId(proj);
    const human = await withCwd(proj.root, async () => {
      const cap = captureContext();
      strictEqual(await run(buildResolve(String(id), { note: 'Handled it.' }), cap), 0);
      return cap.stdout();
    });
    match(human, new RegExp(`Finding ${id} marked fixed by you\\.`));

    // The resolved row now hides by default (fixed); --fixed reveals it as
    // the third actor shape, `fixed by you` (no fixer id).
    const def = await runHuman(proj.root);
    doesNotMatch(def.out, /Repeats itself/, 'the resolved finding is hidden by default');
    const shown = await runHuman(proj.root, { fixed: true });
    match(shown.out, /✓ {2}fixed by you: Handled it\./, 'no fixer, so `by you`');
  });

  it('resolves a human-decision finding too (clears the fixer id)', async () => {
    const proj = await setupProject();
    const id = await stampResolutionOnType(proj, {
      type: 'redundancy',
      state: 'human-decision',
      note: 'A fixer proposed this.',
      fixer: 'core/ai-redundancy-action',
    });
    const code = await withCwd(proj.root, async () => run(buildResolve(String(id)), captureContext()));
    strictEqual(code, 0);
    const { body } = await runJson(proj.root, { type: 'redundancy', fixed: true });
    const entry = body.findings.find((f) => f.id === id);
    strictEqual(entry?.resolution, 'fixed');
    strictEqual(entry?.resolutionActor, 'human');
    strictEqual(entry?.resolutionBy, null, 'a purely human resolution clears the fixer id');
  });

  it('exits 5 when the id does not exist', async () => {
    const proj = await setupProject();
    const outcome = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const code = await run(buildResolve('999999'), cap);
      return { code, err: cap.stderr() };
    });
    strictEqual(outcome.code, 5);
    match(outcome.err, /not found/);
  });

  it('exits 2 when the finding is already fixed', async () => {
    const proj = await setupProject();
    const id = await stampResolutionOnType(proj, {
      type: 'redundancy',
      state: 'fixed',
      note: 'Already done.',
    });
    const outcome = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const code = await run(buildResolve(String(id)), cap);
      return { code, err: cap.stderr() };
    });
    strictEqual(outcome.code, 2);
    match(outcome.err, /already fixed/);
  });

  it('exits 2 on a non-integer id', async () => {
    const proj = await setupProject();
    const outcome = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const code = await run(buildResolve('not-a-number'), cap);
      return { code, err: cap.stderr() };
    });
    strictEqual(outcome.code, 2);
    match(outcome.err, /invalid id/);
  });

  it('exits 5 when the DB file is missing', async () => {
    counter += 1;
    const bare = join(tmpRoot, `resolve-bare-${counter}`);
    mkdirSync(bare, { recursive: true });
    const code = await withCwd(bare, async () => run(buildResolve('1'), captureContext()));
    strictEqual(code, 5);
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

describe('sm findings clear', () => {
  interface IClearFlags {
    node?: string;
    all?: boolean;
    dryRun?: boolean;
    yes?: boolean;
    json?: boolean;
  }

  function buildClear(flags: IClearFlags = {}): FindingsClearCommand {
    const cmd = new FindingsClearCommand();
    cmd.node = flags.node;
    cmd.all = flags.all ?? false;
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

  async function allRows(proj: IProject): Promise<IFindingRecord[]> {
    const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
    await adapter.init();
    try {
      return await adapter.findings.list({ includeStale: true });
    } finally {
      await adapter.close();
    }
  }

  it('exits 2 when neither -n nor --all is passed (and when both are)', async () => {
    const proj = await setupProject();
    const neither = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const code = await run(buildClear({ yes: true }), cap);
      return { code, err: cap.stderr() };
    });
    strictEqual(neither.code, 2);
    match(neither.err, /pass exactly one target/);

    const both = await withCwd(proj.root, async () =>
      run(buildClear({ node: NODE_A, all: true, yes: true }), captureContext()),
    );
    strictEqual(both, 2);
    strictEqual((await allRows(proj)).length, 4, 'nothing deleted on a usage error');
  });

  it('-n --yes clears ONLY that node (fresh AND stale), other nodes survive', async () => {
    const proj = await setupProject();
    strictEqual((await allRows(proj)).length, 4, 'seed: 3 on NODE_A + 1 on NODE_B');

    const outcome = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const code = await run(buildClear({ node: NODE_A, yes: true, json: true }), cap);
      return { code, body: JSON.parse(cap.stdout()) as Record<string, unknown> };
    });
    strictEqual(outcome.code, 0);
    strictEqual(outcome.body['deleted'], 3, 'fresh + stale rows of the node');
    strictEqual(outcome.body['wouldDelete'], 0);
    ok(typeof outcome.body['elapsedMs'] === 'number', 'envelope carries elapsedMs');

    const rows = await allRows(proj);
    strictEqual(rows.length, 1, 'the other node survives');
    strictEqual(rows[0]!.nodeId, NODE_B);
  });

  it('--all --yes clears the whole table, kernel safety rows included', async () => {
    const proj = await setupProject();
    const outcome = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const code = await run(buildClear({ all: true, yes: true, json: true }), cap);
      return { code, body: JSON.parse(cap.stdout()) as Record<string, unknown> };
    });
    strictEqual(outcome.code, 0);
    // 4 seeded rows, one of them the kernel-origin injection-detected row.
    strictEqual(outcome.body['deleted'], 4);
    strictEqual((await allRows(proj)).length, 0, 'table empty, safety lane included');
  });

  it('--dry-run reports the count without deleting and never prompts', async () => {
    const proj = await setupProject();
    const outcome = await withCwd(proj.root, async () => {
      // No stdin at all: a prompt would hang / crash, proving dry-run
      // never asks.
      const cap = captureContext();
      const code = await run(buildClear({ all: true, dryRun: true, json: true }), cap);
      return { code, body: JSON.parse(cap.stdout()) as Record<string, unknown> };
    });
    strictEqual(outcome.code, 0);
    strictEqual(outcome.body['deleted'], 0);
    strictEqual(outcome.body['wouldDelete'], 4);
    strictEqual((await allRows(proj)).length, 4, 'nothing deleted');
  });

  it('interactive decline aborts without deleting; accept clears', async () => {
    const proj = await setupProject();
    const declined = await withCwd(proj.root, async () => {
      const cap = captureWithStdin('n\n');
      const code = await run(buildClear({ all: true }), cap);
      return { code, err: cap.stderr() };
    });
    strictEqual(declined.code, 0);
    match(declined.err, /about to delete 4 findings/);
    match(declined.err, /aborted by user/);
    strictEqual((await allRows(proj)).length, 4, 'nothing deleted after decline');

    const accepted = await withCwd(proj.root, async () => {
      const cap = captureWithStdin('y\n');
      const code = await run(buildClear({ all: true }), cap);
      return { code, out: cap.stdout() };
    });
    strictEqual(accepted.code, 0);
    match(accepted.out, /Deleted 4 findings/);
    strictEqual((await allRows(proj)).length, 0);
  });

  it('prints the friendly no-op line for a node with zero findings', async () => {
    const proj = await setupProject();
    const outcome = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const code = await run(buildClear({ node: 'unjudged.md', yes: true }), cap);
      return { code, out: cap.stdout() };
    });
    strictEqual(outcome.code, 0);
    match(outcome.out, /No findings to clear on unjudged\.md\./);
    strictEqual((await allRows(proj)).length, 4, 'untouched');
  });

  it('exits 5 when the DB file is missing', async () => {
    counter += 1;
    const bare = join(tmpRoot, `clear-bare-${counter}`);
    mkdirSync(bare, { recursive: true });
    const code = await withCwd(bare, async () =>
      run(buildClear({ all: true, yes: true }), captureContext()),
    );
    strictEqual(code, 5);
  });
});

describe('sm findings dismissed bucket (read-time suppression lens)', () => {
  it('a suppressed class hides as dismissed; the stale row rides inline; --dismissed reveals the class', async () => {
    // Seed: NODE_A carries contradiction (fresh) + redundancy (fresh) +
    // incoherence (stale). Suppressing contradiction leaves redundancy and
    // the inline-marked stale incoherence as the shown rows, with one
    // dismissed row hidden.
    const proj = await setupProject();
    await suppressOnMirror(proj, [{ extension: 'plug/finder-a', type: 'contradiction' }]);

    const out = await withCwd(proj.root, async () => {
      const cap = captureContext();
      strictEqual(await run(buildFindings({ node: NODE_A }), cap), 0);
      return cap.stdout();
    });
    match(out, /redundancy/);
    match(out, /incoherence/, 'the stale row shows in the default view');
    match(out, /\(stale\)/, 'marked in place, per row');
    doesNotMatch(out, /contradiction/);
    match(out, /1 dismissed hidden/);
    match(out, /Pass --dismissed to see it/, 'only the dismissed reveal flag is offered');

    // --dismissed reveals ONLY the suppressed class.
    const revealed = await withCwd(proj.root, async () => {
      const cap = captureContext();
      strictEqual(
        await run(buildFindings({ node: NODE_A, dismissed: true, json: true }), cap),
        0,
      );
      return JSON.parse(cap.stdout()) as { findings: Array<{ type: string }> };
    });
    deepStrictEqual(
      revealed.findings.map((f) => f.type),
      ['contradiction'],
    );
  });

  it('precedence: a suppressed row counts as dismissed even when it is fixed', async () => {
    const proj = await setupProject();
    await stampResolutionOnType(proj, { type: 'contradiction', state: 'fixed', note: 'done' });
    await suppressOnMirror(proj, [{ extension: 'plug/finder-a', type: 'contradiction' }]);

    const body = await withCwd(proj.root, async () => {
      const cap = captureContext();
      strictEqual(await run(buildFindings({ node: NODE_A, json: true }), cap), 0);
      return JSON.parse(cap.stdout()) as {
        dismissedExcluded: number;
        fixedExcluded: number;
      };
    });
    strictEqual(body.dismissedExcluded, 1, 'suppression wins the bucket');
    strictEqual(body.fixedExcluded, 0, 'never double-counted as fixed');

    // --fixed no longer surfaces it (it lives in the dismissed bucket).
    const fixedView = await withCwd(proj.root, async () => {
      const cap = captureContext();
      strictEqual(await run(buildFindings({ node: NODE_A, fixed: true, json: true }), cap), 0);
      return JSON.parse(cap.stdout()) as { findings: Array<{ type: string }> };
    });
    strictEqual(fixedView.findings.some((f) => f.type === 'contradiction'), false);
  });
});
