/**
 * Step 4.5 acceptance tests for `sm list`, `sm show`, `sm check`, the
 * read-side commands that query the persisted scan snapshot.
 *
 * Tests instantiate each Command class directly and call `execute()` with
 * a mocked Clipanion-like context, mirroring the pattern used by
 * `cli.test.ts` for `sm scan`. We avoid spawning child processes here,
 * the real-CLI integration is exercised by the existing `cli.test.ts`
 * file; this test focuses on handler behavior at the per-flag level.
 *
 * Each `it` builds a fresh fixture + DB via `mkdtempSync` (no `:memory:`
 * see `feedback_sqlite_in_memory_workaround.md`) and primes the DB by
 * driving the orchestrator + `persistScanResult`, the exact path the
 * real `sm scan` takes.
 */

import { describe, it, before, after } from 'node:test';
import { strictEqual, ok, deepStrictEqual, match } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BaseContext } from 'clipanion';

import { CheckCommand } from '../../cli/commands/check.js';
import { ListCommand } from '../../cli/commands/list.js';
import { ScanCommand } from '../../cli/commands/scan.js';
import { ShowCommand } from '../../cli/commands/show.js';
import { createKernel, runScan } from '../../kernel/index.js';
import { builtIns, listBuiltIns } from '../../plugins/built-ins.js';
import { SqliteStorageAdapter } from '../../kernel/adapters/sqlite/index.js';
import { persistScanResult } from '../../kernel/adapters/sqlite/scan-persistence.js';

// --- shared scaffolding ----------------------------------------------------

let tmpRoot: string;
let counter = 0;

function freshDbPath(label: string): string {
  counter += 1;
  return join(tmpRoot, `${label}-${counter}.db`);
}

function freshFixture(label: string): string {
  counter += 1;
  return mkdtempSync(join(tmpRoot, `${label}-${counter}-`));
}

function writeFixtureFile(root: string, rel: string, content: string): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
}

async function plantClaudeFixture(root: string): Promise<void> {
  // Same shape as scan-e2e.test.ts, three nodes, multiple link kinds,
  // broken-ref issues. Keeps the surface representative without inventing
  // new edge cases the rest of the suite already covers.
  writeFixtureFile(
    root,
    '.claude/agents/architect.md',
    [
      '---',
      'name: architect',
      'description: The architect',
      '---',
      '',
      'Run /deploy or /unknown, consult @backend-lead. See [deploy](../commands/deploy.md).',
    ].join('\n'),
  );
  writeFixtureFile(
    root,
    '.claude/commands/deploy.md',
    ['---', 'name: deploy', 'description: Deploy', '---', 'Deploy body.'].join('\n'),
  );
  writeFixtureFile(
    root,
    '.claude/commands/rollback.md',
    [
      '---',
      'name: Rollback',
      'description: Rollback the last deploy.',
      '---',
      'Rollback body.',
    ].join('\n'),
  );
}

/**
 * Plant a minimal fixture whose only issue is `reference-redundant`
 * at `info`: the architect references helper through TWO syntactic
 * forms (an `@helper` mention plus a markdown link), so both edges
 * resolve to the same target and the rule fires. Used by the tests
 * that exercise the "no error-severity → exit 0" contract;
 * `plantClaudeFixture` cannot serve that role since `reference-broken`
 * (which the default fixture exercises via `/unknown` +
 * `@backend-lead`) emits at `error` severity. (This helper used the
 * `annotation-stale` info issue until 2026-07-20, when that analyzer
 * went icon-only and stopped emitting issues.)
 */
async function plantInfoFixture(root: string): Promise<void> {
  writeFixtureFile(
    root,
    '.claude/agents/architect.md',
    [
      '---',
      'name: architect',
      'description: Info-only fixture, redundant double reference to helper.',
      '---',
      '',
      'Coordinate with @helper on the plan.',
      'Background reading: [helper](./helper.md).',
    ].join('\n'),
  );
  writeFixtureFile(
    root,
    '.claude/agents/helper.md',
    [
      '---',
      'name: helper',
      'description: Referenced twice by the architect.',
      '---',
      '',
      'Body without any broken @ or / triggers.',
    ].join('\n'),
  );
}

async function primeDb(fixture: string, dbPath: string): Promise<void> {
  const kernel = createKernel();
  for (const manifest of listBuiltIns()) kernel.registry.register(manifest);
  const result = await runScan(kernel, {
    roots: [fixture],
    extensions: builtIns(),
    activeProvider: 'claude',
  });
  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  try {
    await persistScanResult(adapter.db, result);
  } finally {
    await adapter.close();
  }
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
    stdout: { write: (s: string) => { stdoutChunks.push(s); return true; } },
    stderr: { write: (s: string) => { stderrChunks.push(s); return true; } },
  } as unknown as BaseContext;
  return {
    context,
    stdout: () => stdoutChunks.join(''),
    stderr: () => stderrChunks.join(''),
  };
}

/**
 * Reset every Clipanion `Option.*` field on a freshly-instantiated Command
 * to its at-rest default. Without this, the bare property holds an
 * internal Option descriptor (Clipanion only resolves it during
 * `cli.run()`); calling `execute()` directly then sees the descriptor
 * and the `--sort-by`-validation path treats it as an invalid value.
 */

interface IListOverrides {
  db?: string | undefined;
  global?: boolean;
  kind?: string | undefined;
  issue?: boolean;
  sortBy?: string | undefined;
  limit?: string | undefined;
  json?: boolean;
  tag?: string | undefined;
}

function buildList(overrides: IListOverrides = {}): ListCommand {
  const cmd = new ListCommand();
  cmd.db = overrides.db;
  cmd.kind = overrides.kind;
  cmd.issue = overrides.issue ?? false;
  cmd.sortBy = overrides.sortBy;
  cmd.limit = overrides.limit;
  cmd.json = overrides.json ?? false;
  cmd.tag = overrides.tag;
  return cmd;
}

interface IShowOverrides {
  nodePath: string;
  db?: string | undefined;
  global?: boolean;
  json?: boolean;
}

function buildShow(overrides: IShowOverrides): ShowCommand {
  const cmd = new ShowCommand();
  cmd.db = overrides.db;
  cmd.json = overrides.json ?? false;
  cmd.nodePath = overrides.nodePath;
  return cmd;
}

interface ICheckOverrides {
  db?: string | undefined;
  global?: boolean;
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

interface IScanOverrides {
  roots?: string[];
  json?: boolean;
  noBuiltIns?: boolean;
  noTokens?: boolean;
  dryRun?: boolean;
  changed?: boolean;
  allowEmpty?: boolean;
  strict?: boolean;
  watch?: boolean;
  maxScan?: string | undefined;
  maxNodes?: string | undefined;
}

function buildScan(overrides: IScanOverrides = {}): ScanCommand {
  const cmd = new ScanCommand();
  cmd.roots = overrides.roots ?? [];
  cmd.json = overrides.json ?? false;
  cmd.noBuiltIns = overrides.noBuiltIns ?? false;
  cmd.noTokens = overrides.noTokens ?? false;
  cmd.dryRun = overrides.dryRun ?? false;
  cmd.changed = overrides.changed ?? false;
  cmd.allowEmpty = overrides.allowEmpty ?? false;
  cmd.strict = overrides.strict ?? false;
  cmd.watch = overrides.watch ?? false;
  // Reset Clipanion markers for `--max-scan` / `--max-nodes`. New
  // `ScanCommand()` leaves the Option.String marker object on
  // `cmd.maxScan` / `cmd.maxNodes`; the parser fills them in only when
  // the CLI engine runs. Tests that instantiate the command directly
  // must clear the markers so `parseMaxScanFlag()` / `parseMaxNodesFlag()`
  // see `undefined` instead of the metadata.
  cmd.maxScan = overrides.maxScan;
  cmd.maxNodes = overrides.maxNodes;
  return cmd;
}

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-readers-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

// --- list ------------------------------------------------------------------

describe('sm list', () => {
  it('empty DB → exit 0, prints "No nodes found." (human)', async () => {
    const dbPath = freshDbPath('list-empty');
    // Migrate but leave scan_* empty.
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    await adapter.close();

    const cap = captureContext();
    const cmd = buildList({ db: dbPath });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 0, `unexpected exit ${code}; stderr=${cap.stderr()}`);
    match(cap.stdout(), /No nodes found\./);
  });

  it('3 nodes → table has 3 data rows', async () => {
    const fixture = freshFixture('list-three');
    await plantClaudeFixture(fixture);
    const dbPath = freshDbPath('list-three');
    await primeDb(fixture, dbPath);

    const cap = captureContext();
    const cmd = buildList({ db: dbPath });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 0, `unexpected exit ${code}; stderr=${cap.stderr()}`);
    // New layout: indented header + 3 data rows + blank + footer count
    // + tip. Count data rows directly (lines that include `.md`) so the
    // assertion stays robust to header / footer churn.
    const stdout = cap.stdout();
    const dataRows = stdout.split('\n').filter((l) => l.includes('.md'));
    strictEqual(dataRows.length, 3, `expected 3 data rows, got ${dataRows.length}: ${stdout}`);
    ok(stdout.includes('PATH'));
    ok(stdout.includes('.claude/agents/architect.md'));
    ok(stdout.includes('.claude/commands/deploy.md'));
    ok(stdout.includes('.claude/commands/rollback.md'));
    // Footer is part of the new contract.
    ok(stdout.includes('3 nodes'));
  });

  it('--kind agent → only agent rows', async () => {
    const fixture = freshFixture('list-kind');
    await plantClaudeFixture(fixture);
    const dbPath = freshDbPath('list-kind');
    await primeDb(fixture, dbPath);

    const cap = captureContext();
    const cmd = buildList({ db: dbPath, kind: 'agent' });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 0, `unexpected exit ${code}; stderr=${cap.stderr()}`);
    const stdout = cap.stdout();
    const dataRows = stdout.split('\n').filter((l) => l.includes('.md'));
    strictEqual(dataRows.length, 1, `expected 1 data row, got: ${stdout}`);
    ok(stdout.includes('.claude/agents/architect.md'));
    ok(!stdout.includes('.claude/commands/deploy.md'));
  });

  it('--kind <external> filters external-Provider kinds (open kind contract)', async () => {
    // Companion to the `--kind agent` test above. Plants a row with
    // `kind: 'cursorRule'` (no built-in Provider classifies into it),
    // then asserts the verb's `WHERE kind = ?` filter accepts the open
    // string and surfaces only that row. Catches a regression where
    // anyone retypes the column to `NodeKind` and quietly drops
    // external kinds from the listing.
    const fixture = freshFixture('list-external');
    await plantClaudeFixture(fixture);
    const dbPath = freshDbPath('list-external');
    await primeDb(fixture, dbPath);

    // Manually insert a `cursorRule` row alongside the claude fixtures.
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      const a64 = 'a'.repeat(64);
      const b64 = 'b'.repeat(64);
      await adapter.db
        .insertInto('scan_nodes')
        .values({
          path: '.cursor/rules/strict-mode.md',
          kind: 'cursorRule',
          provider: 'cursor',
          frontmatterJson: '{}',
          bodyHash: a64,
          frontmatterHash: b64,
          bytesFrontmatter: 0,
          bytesBody: 0,
          bytesTotal: 0,
          linksOutCount: 0,
          linksInCount: 0,
          externalRefsCount: 0,
          scannedAt: Date.now(),
        })
        .execute();
    } finally {
      await adapter.close();
    }

    const cap = captureContext();
    const cmd = buildList({ db: dbPath, kind: 'cursorRule' });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 0, `unexpected exit ${code}; stderr=${cap.stderr()}`);
    const stdout = cap.stdout();
    ok(stdout.includes('.cursor/rules/strict-mode.md'), `expected cursor row, got: ${stdout}`);
    ok(stdout.includes('cursorRule'), 'KIND column should render the open string verbatim');
    // Negative: claude rows present in the DB do NOT leak through the filter.
    ok(!stdout.includes('.claude/agents/architect.md'));
    ok(!stdout.includes('.claude/commands/deploy.md'));
  });

  it('--issue → only nodes touched by an issue', async () => {
    const fixture = freshFixture('list-issue');
    await plantClaudeFixture(fixture);
    const dbPath = freshDbPath('list-issue');
    await primeDb(fixture, dbPath);

    const cap = captureContext();
    const cmd = buildList({ db: dbPath, issue: true });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 0, `unexpected exit ${code}; stderr=${cap.stderr()}`);
    // architect (broken-ref ×2 from /unknown + @backend-lead). deploy and
    // rollback have no issues.
    ok(cap.stdout().includes('.claude/agents/architect.md'));
    ok(!cap.stdout().includes('.claude/commands/deploy.md'));
    ok(!cap.stdout().includes('.claude/commands/rollback.md'));
  });

  it('--sort-by tokens_total --limit 1 → 1 row, the largest', async () => {
    const fixture = freshFixture('list-sort');
    await plantClaudeFixture(fixture);
    const dbPath = freshDbPath('list-sort');
    await primeDb(fixture, dbPath);

    const cap = captureContext();
    const cmd = buildList({ db: dbPath, sortBy: 'tokens_total', limit: '1' });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 0, `unexpected exit ${code}; stderr=${cap.stderr()}`);
    const stdout = cap.stdout();
    const dataRows = stdout.split('\n').filter((l) => l.includes('.md'));
    strictEqual(dataRows.length, 1, `expected 1 data row, got: ${stdout}`);
    // Architect is the largest fixture by cl100k_base token count
    // (frontmatter + body), same ordering as bytes for this ASCII trio.
    ok(stdout.includes('.claude/agents/architect.md'));
    ok(!stdout.includes('.claude/commands/rollback.md'));
  });

  it('--sort-by malicious-string → exit 2, stderr names the field', async () => {
    const dbPath = freshDbPath('list-sort-bad');
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    await adapter.close();

    const cap = captureContext();
    const cmd = buildList({ db: dbPath, sortBy: 'malicious; DROP TABLE' });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 2);
    match(cap.stderr(), /invalid sort field/);
    match(cap.stderr(), /malicious/);
  });

  it('--json → array of nodes whose length matches the row count', async () => {
    const fixture = freshFixture('list-json');
    await plantClaudeFixture(fixture);
    const dbPath = freshDbPath('list-json');
    await primeDb(fixture, dbPath);

    const cap = captureContext();
    const cmd = buildList({ db: dbPath, json: true });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 0, `unexpected exit ${code}; stderr=${cap.stderr()}`);
    const parsed = JSON.parse(cap.stdout()) as Array<{ path: string; kind: string }>;
    ok(Array.isArray(parsed));
    strictEqual(parsed.length, 3);
    const paths = parsed.map((n) => n.path).sort();
    deepStrictEqual(paths, [
      '.claude/agents/architect.md',
      '.claude/commands/deploy.md',
      '.claude/commands/rollback.md',
    ]);
  });
});

// --- show ------------------------------------------------------------------

describe('sm show', () => {
  it('existing path → human output covers kind, links, issues sections', async () => {
    const fixture = freshFixture('show-existing');
    await plantClaudeFixture(fixture);
    const dbPath = freshDbPath('show-existing');
    await primeDb(fixture, dbPath);

    const cap = captureContext();
    const cmd = buildShow({ db: dbPath, nodePath: '.claude/agents/architect.md' });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 0, `unexpected exit ${code}; stderr=${cap.stderr()}`);
    const out = cap.stdout();
    // New layout: `  ✓  <path>   <kind>` header, dim field labels
    // (`Tokens` / `External refs`), sectioned `Links out (N)` /
    // `Issues (N)` blocks. Empty Links/Issues sections are dropped,
    // architect has out-links + issues, so both render. `Links in` is
    // only present when another node points back at architect, which
    // depends on the fixture; don't gate on it.
    match(out, /✓\s+\.claude\/agents\/architect\.md/);
    match(out, /\bagent\b/);
    match(out, /\bTokens\b/);
    match(out, /\bLinks out \(\d+\)/);
    match(out, /\bIssues \(\d+\)/);
    // architect emits ≥3 outbound links (markdown-link to deploy + slash + at).
    ok(out.includes('.claude/commands/deploy.md'), 'markdown-link to deploy shown');
    ok(out.includes('@backend-lead'), 'at-handle mention shown');
    ok(out.includes('reference-broken'), 'broken-ref issue shown');
  });

  it('missing path → exit 5, stderr "Node not found: <path>"', async () => {
    const fixture = freshFixture('show-missing');
    await plantClaudeFixture(fixture);
    const dbPath = freshDbPath('show-missing');
    await primeDb(fixture, dbPath);

    const cap = captureContext();
    const cmd = buildShow({ db: dbPath, nodePath: 'does/not/exist.md' });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 5);
    match(cap.stderr(), /Node not found: does\/not\/exist\.md/);
  });

  it('human output reports External refs > 0 after the Weight section', async () => {
    // A node with an http(s) link in its body raises externalRefsCount.
    // The Weight section is followed by the new "External refs: <N>" line.
    const fixture = freshFixture('show-ext');
    writeFixtureFile(
      fixture,
      '.claude/agents/links.md',
      [
        '---',
        'name: links',
        '---',
        '',
        'See https://example.com and https://example.com/path.',
      ].join('\n'),
    );
    const dbPath = freshDbPath('show-ext');
    await primeDb(fixture, dbPath);

    const cap = captureContext();
    const cmd = buildShow({ db: dbPath, nodePath: '.claude/agents/links.md' });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 0, `unexpected exit ${code}; stderr=${cap.stderr()}`);
    // New layout: `External refs  N` field row (label + value).
    match(cap.stdout(), /External refs\s+2/);
  });

  it('human output reports External refs: 0 honestly (no body links)', async () => {
    const fixture = freshFixture('show-ext-zero');
    writeFixtureFile(
      fixture,
      '.claude/agents/quiet.md',
      ['---', 'name: quiet', '---', '', 'No external links here.'].join('\n'),
    );
    const dbPath = freshDbPath('show-ext-zero');
    await primeDb(fixture, dbPath);

    const cap = captureContext();
    const cmd = buildShow({ db: dbPath, nodePath: '.claude/agents/quiet.md' });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 0, `unexpected exit ${code}; stderr=${cap.stderr()}`);
    match(cap.stdout(), /External refs\s+0/);
  });

  it('--json → object with node/linksOut/linksIn/issues', async () => {
    const fixture = freshFixture('show-json');
    await plantClaudeFixture(fixture);
    const dbPath = freshDbPath('show-json');
    await primeDb(fixture, dbPath);

    const cap = captureContext();
    const cmd = buildShow({ db: dbPath, json: true, nodePath: '.claude/agents/architect.md' });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 0, `unexpected exit ${code}; stderr=${cap.stderr()}`);
    const parsed = JSON.parse(cap.stdout()) as Record<string, unknown>;
    ok(parsed['node'], 'node present');
    ok(Array.isArray(parsed['linksOut']), 'linksOut is array');
    ok(Array.isArray(parsed['linksIn']), 'linksIn is array');
    ok(Array.isArray(parsed['issues']), 'issues is array');
    ok(Array.isArray(parsed['findings']), 'findings is array (Step 10 landed)');
    strictEqual((parsed['findings'] as unknown[]).length, 0, 'no stored findings for a fresh scan');
    ok(!('summary' in parsed), 'summary field absent until Step 11');
  });
});

// --- scan ------------------------------------------------------------------
//
// Exit-code contract for `sm scan` (per spec/cli-contract.md §Exit codes,
// mirrored from `sm check`): exit 1 only when an issue at severity `error`
// exists; warns / infos do not fail the verb.

describe('sm scan exit code', () => {
  it('warn / info issues only → exit 0', async () => {
    // Plant an ORPHAN sidecar: a `.sm` with no sibling `.md` makes the
    // `annotation-orphan` analyzer fire at `warn`, exercising the "no
    // errors → exit 0" branch in isolation. The clean `architect.md` node
    // carries no sidecar, so the now-default-on `annotation-stale` analyzer
    // (stable since 2026-07-19) finds no drift and stays silent; the body
    // has no broken @ / triggers, so nothing escalates to `error`.
    const fixture = freshFixture('scan-warns');
    writeFixtureFile(
      fixture,
      '.claude/agents/architect.md',
      [
        '---',
        'name: architect',
        'description: Clean node, no broken refs.',
        '---',
        '',
        'Body without any broken @ or / triggers.',
      ].join('\n'),
    );
    writeFixtureFile(
      fixture,
      '.claude/agents/orphan.sm',
      [
        'identity:',
        '  path: .claude/agents/orphan.md',
        `  bodyHash: ${'a'.repeat(64)}`,
        `  frontmatterHash: ${'a'.repeat(64)}`,
        'annotations:',
        '  version: 1',
        '',
      ].join('\n'),
    );

    const cap = captureContext();
    const cmd = buildScan({ roots: [fixture], dryRun: true, json: true });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 0, `expected exit 0 with no error-severity issues, got ${code}; stderr=${cap.stderr()}`);
    const result = JSON.parse(cap.stdout()) as { issues: Array<{ severity: string }> };
    ok(result.issues.length > 0, 'fixture should yield at least one warn/info issue');
    ok(
      !result.issues.some((i) => i.severity === 'error'),
      'precondition: no error-severity issues in this fixture',
    );
  });

  it('error-severity issue present → exit 1', async () => {
    // Two commands both declare `name: deploy`, so both advertise
    // `/deploy`. The name-collision rule fires at severity `error`
    // (two advertisers of one trigger; the runtime must pick one).
    const fixture = freshFixture('scan-error');
    writeFixtureFile(
      fixture,
      '.claude/commands/deploy.md',
      ['---', 'name: deploy', '---', '', 'Deploy the project.'].join('\n'),
    );
    writeFixtureFile(
      fixture,
      '.claude/commands/deploy-v2.md',
      ['---', 'name: deploy', '---', '', 'A second command claiming the deploy name.'].join('\n'),
    );

    const cap = captureContext();
    const cmd = buildScan({ roots: [fixture], dryRun: true, json: true });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 1, `expected exit 1 with error-severity issue, got ${code}; stderr=${cap.stderr()}`);
    const result = JSON.parse(cap.stdout()) as { issues: Array<{ severity: string; analyzerId: string }> };
    ok(
      result.issues.some((i) => i.severity === 'error' && i.analyzerId === 'name-collision'),
      'fixture must yield name-collision at error severity',
    );
  });
});

// --- check -----------------------------------------------------------------

describe('sm check', () => {
  it('empty DB → exit 0, "No issues."', async () => {
    const dbPath = freshDbPath('check-empty');
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    await adapter.close();

    const cap = captureContext();
    const cmd = buildCheck({ db: dbPath });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 0, `unexpected exit ${code}; stderr=${cap.stderr()}`);
    match(cap.stdout(), /No issues\./);
  });

  it('info-severity issue with no error-severity → exit 0', async () => {
    // Uses the info fixture so the verb-side "exit 0 when no
    // errors" branch is exercised in isolation. The default
    // claude fixture's `reference-broken` is now `error` (per the
    // chip-vs-issue policy in `context/view-slots.md`).
    const fixture = freshFixture('check-warns');
    await plantInfoFixture(fixture);
    const dbPath = freshDbPath('check-warns');
    await primeDb(fixture, dbPath);

    const cap = captureContext();
    const cmd = buildCheck({ db: dbPath });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 0, `expected exit 0 with no error-severity issues, got ${code}`);
    // Layout: severity glyph + dim analyzer id. reference-redundant is
    // the info-only finding planted by the fixture.
    match(cap.stdout(), /ℹ\s+reference-redundant/);
  });

  it('error-severity issue present → exit 1', async () => {
    // Manufacture an error-severity issue via direct insert. The built-in
    // rules in this Step never emit `error`, so we synthesise one to
    // exercise the contract boundary explicitly.
    const fixture = freshFixture('check-error');
    await plantClaudeFixture(fixture);
    const dbPath = freshDbPath('check-error');
    await primeDb(fixture, dbPath);

    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      await adapter.db
        .insertInto('scan_issues')
        .values({
          analyzerId: 'synthetic-error',
          severity: 'error',
          nodeIdsJson: JSON.stringify(['.claude/agents/architect.md']),
          linkIndicesJson: null,
          message: 'Synthetic error for the check exit-code test.',
          detail: null,
          fixJson: null,
          dataJson: null,
        })
        .execute();
    } finally {
      await adapter.close();
    }

    const cap = captureContext();
    const cmd = buildCheck({ db: dbPath });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 1);
    match(cap.stdout(), /✕\s+synthetic-error/);
  });

  it('--json → array of Issue objects with the right keys', async () => {
    // The default claude fixture surfaces `reference-broken` at error
    // severity (per the chip-vs-issue policy), so the verb exits 1.
    // The JSON shape assertions below are exit-code-agnostic, the test
    // pins the JSON contract regardless of the per-fixture exit code.
    const fixture = freshFixture('check-json');
    await plantClaudeFixture(fixture);
    const dbPath = freshDbPath('check-json');
    await primeDb(fixture, dbPath);

    const cap = captureContext();
    const cmd = buildCheck({ db: dbPath, json: true });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 1, `expected exit 1 with the default broken-ref fixture, got ${code}; stderr=${cap.stderr()}`);
    const parsed = JSON.parse(cap.stdout()) as Array<Record<string, unknown>>;
    ok(Array.isArray(parsed));
    ok(parsed.length > 0, 'fixture should yield at least one issue');
    for (const issue of parsed) {
      ok('analyzerId' in issue);
      ok('severity' in issue);
      ok('nodeIds' in issue);
      ok('message' in issue);
    }
  });
});

// --- scan flag rejection ---------------------------------------------------

describe('sm scan --changed --no-built-ins', () => {
  it('rejected combination → exit 2, stderr explains why', async () => {
    // Documented incoherent combination per spec/cli-contract.md and the
    // `ScanCommand.execute` flag-combinatorics block: --no-built-ins
    // yields a zero-filled ScanResult, so there's nothing for --changed
    // to merge against. Expect exit 2 and an explanatory stderr, the
    // handler must NOT touch the DB or run a scan.
    const cap = captureContext();
    const cmd = buildScan({ changed: true, noBuiltIns: true });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 2);
    match(cap.stderr(), /--changed and --no-built-ins cannot be combined/);
    strictEqual(cap.stdout(), '', 'no stdout when the combination is rejected');
  });
});

// --- scan empty / invalid roots & --allow-empty guard ---------------------
//
// Layered defenses against the destructive `sm scan -- --dry-run` bug:
// (B6 in `.tmp/sandbox/` e2e). Clipanion treats `--` as the positional-
// args separator, so `sm scan -- --dry-run` parses as `scan` with
// `roots = ['--dry-run']`, a non-existent path. Without these guards
// the claude adapter's `walk()` swallowed ENOENT, the scan returned
// zero rows, and `persistScanResult` wiped the populated DB. The CLI
// now refuses both: orchestrator rejects bad roots up front, and the
// handler refuses to overwrite a populated DB with a zero-result scan
// unless `--allow-empty` is passed.

describe('sm scan empty / invalid roots & --allow-empty guard', () => {
  it('non-existent root → exit 2, stderr names the path; DB untouched', async () => {
    const fixture = freshFixture('scan-bad-root');
    const missing = join(fixture, 'definitely-not-here');

    const originalCwd = process.cwd();
    process.chdir(fixture);
    try {
      const cap = captureContext();
      const cmd = buildScan({ roots: [missing] });
      cmd.context = cap.context;
      const code = await cmd.execute();

      strictEqual(code, 2);
      match(cap.stderr(), /sm scan:/);
      match(cap.stderr(), /does not exist or is not a directory/);
      ok(cap.stderr().includes(missing), 'stderr names the bad root path');
      strictEqual(cap.stdout(), '', 'no stdout on validation failure');
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('reproducer `sm scan -- --dry-run` (positional `--dry-run`) → exit 2, DB untouched', async () => {
    // Drive the exact failure mode the user hit: clipanion treats `--`
    // as the positional separator, so the trailing `--dry-run` arrives
    // as `roots = ['--dry-run']`. The handler must reject it with
    // exit 2, NOT silently wipe the DB.
    const fixture = freshFixture('scan-dashdash-trap');
    await plantClaudeFixture(fixture);
    // Prime an existing DB so we can assert it survives.
    const dbPath = join(fixture, '.skill-map', 'skill-map.db');
    mkdirSync(join(dbPath, '..'), { recursive: true });
    await primeDb(fixture, dbPath);

    const adapterBefore = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapterBefore.init();
    const beforeCount = await adapterBefore.db
      .selectFrom('scan_nodes')
      .selectAll()
      .execute();
    await adapterBefore.close();
    ok(beforeCount.length > 0, 'precondition: DB has nodes before the bad scan');

    const originalCwd = process.cwd();
    process.chdir(fixture);
    try {
      const cap = captureContext();
      // Simulating clipanion's parse output for `sm scan -- --dry-run`.
      // The CLI never sets `cmd.dryRun` here, `--dry-run` is positional.
      const cmd = buildScan({ roots: ['--dry-run'] });
      cmd.context = cap.context;
      const code = await cmd.execute();

      strictEqual(code, 2, `expected exit 2, got ${code}; stderr=${cap.stderr()}`);
      match(cap.stderr(), /does not exist or is not a directory/);
    } finally {
      process.chdir(originalCwd);
    }

    // DB must be unchanged.
    const adapterAfter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapterAfter.init();
    const afterCount = await adapterAfter.db
      .selectFrom('scan_nodes')
      .selectAll()
      .execute();
    await adapterAfter.close();
    strictEqual(
      afterCount.length,
      beforeCount.length,
      'DB row count must survive a rejected scan',
    );
  });

  it('zero-result scan over populated DB → exit 2, refuses to wipe; DB survives', async () => {
    // Prime a populated DB by scanning a real fixture, then run a fresh
    // scan against an EMPTY fixture (the orchestrator allows it, the
    // dir exists). Without --allow-empty the handler must refuse to
    // wipe the prior snapshot.
    const populated = freshFixture('scan-guard-populated');
    await plantClaudeFixture(populated);
    const dbPath = join(populated, '.skill-map', 'skill-map.db');
    mkdirSync(join(dbPath, '..'), { recursive: true });
    await primeDb(populated, dbPath);

    const empty = freshFixture('scan-guard-empty');

    const originalCwd = process.cwd();
    process.chdir(populated);
    try {
      const cap = captureContext();
      const cmd = buildScan({ roots: [empty] });
      cmd.context = cap.context;
      const code = await cmd.execute();

      strictEqual(code, 2, `expected exit 2, got ${code}; stderr=${cap.stderr()}`);
      match(cap.stderr(), /Refusing to wipe a populated DB/i);
      match(cap.stderr(), /--allow-empty/);
    } finally {
      process.chdir(originalCwd);
    }

    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    const rows = await adapter.db.selectFrom('scan_nodes').selectAll().execute();
    await adapter.close();
    ok(rows.length > 0, 'DB must still have nodes after the refusal');
  });

  it('zero-result scan + --allow-empty over populated DB → clears DB and exits 0', async () => {
    const populated = freshFixture('scan-allow-empty');
    await plantClaudeFixture(populated);
    const dbPath = join(populated, '.skill-map', 'skill-map.db');
    mkdirSync(join(dbPath, '..'), { recursive: true });
    await primeDb(populated, dbPath);

    const empty = freshFixture('scan-allow-empty-target');

    const originalCwd = process.cwd();
    process.chdir(populated);
    try {
      const cap = captureContext();
      const cmd = buildScan({ roots: [empty], allowEmpty: true });
      cmd.context = cap.context;
      const code = await cmd.execute();

      strictEqual(code, 0, `expected exit 0, got ${code}; stderr=${cap.stderr()}`);
    } finally {
      process.chdir(originalCwd);
    }

    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    const rows = await adapter.db.selectFrom('scan_nodes').selectAll().execute();
    await adapter.close();
    strictEqual(rows.length, 0, '--allow-empty must clear the DB');
  });

  it('zero-result scan over EMPTY DB (first-ever scan) → exits 0, no guard trip', async () => {
    // The first scan of a fresh repo is allowed to "wipe" zero rows
    // with zero rows. Guard must NOT fire when the DB is empty (or
    // missing), the natural empty-repo path stays painless.
    const empty = freshFixture('scan-first-empty');

    const originalCwd = process.cwd();
    process.chdir(empty);
    try {
      const cap = captureContext();
      const cmd = buildScan({ roots: [empty] });
      cmd.context = cap.context;
      const code = await cmd.execute();

      strictEqual(code, 0, `expected exit 0 on first-ever empty scan, got ${code}; stderr=${cap.stderr()}`);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('--dry-run over a populated DB does NOT trip the guard', async () => {
    // Dry-run skips persistence entirely (the `willPersist` block
    // never opens the DB). The guard sits inside that block, so the
    // pure read-only dry-run path bypasses it by construction. This
    // test pins that invariant: even with zero result rows + populated
    // DB, --dry-run exits 0 without writing.
    const populated = freshFixture('scan-dry-populated');
    await plantClaudeFixture(populated);
    const dbPath = join(populated, '.skill-map', 'skill-map.db');
    mkdirSync(join(dbPath, '..'), { recursive: true });
    await primeDb(populated, dbPath);

    const empty = freshFixture('scan-dry-empty-target');

    const originalCwd = process.cwd();
    process.chdir(populated);
    try {
      const cap = captureContext();
      const cmd = buildScan({ roots: [empty], dryRun: true });
      cmd.context = cap.context;
      const code = await cmd.execute();

      strictEqual(code, 0, `expected exit 0 on dry-run, got ${code}; stderr=${cap.stderr()}`);
    } finally {
      process.chdir(originalCwd);
    }

    // DB must be unchanged.
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    const rows = await adapter.db.selectFrom('scan_nodes').selectAll().execute();
    await adapter.close();
    ok(rows.length > 0, 'dry-run must not touch the DB');
  });
});

// --- scan --no-tokens ------------------------------------------------------
//
// `sm scan` always persists to `<cwd>/.skill-map/skill-map.db` (no --db
// override on this verb today). To exercise the CLI flag path end-to-end
// we chdir into a fresh temp fixture, run the handler, then re-open the
// resulting DB to assert what landed in scan_nodes.tokens_*. The cwd is
// restored in `finally`.

describe('sm scan --no-tokens (CLI handler)', () => {
  it('default tokenize → tokens_total populated; --no-tokens → null; default again → repopulated', async () => {
    const fixture = freshFixture('scan-no-tokens');
    await plantClaudeFixture(fixture);

    const originalCwd = process.cwd();
    process.chdir(fixture);
    try {
      // Run 1: default (tokenize on).
      {
        const cap = captureContext();
        const cmd = buildScan({});
        cmd.context = cap.context;
        const code = await cmd.execute();
        // Exit 1: `plantClaudeFixture` includes broken `@`/`/` triggers
        // which `reference-broken` now emits at `error` severity (per
        // the chip-vs-issue policy). The scan still persists the DB;
        // exit-code semantics are exercised in dedicated tests above.
        strictEqual(code, 1, `unexpected exit ${code}; stderr=${cap.stderr()}`);
      }
      const dbPath = join(fixture, '.skill-map', 'skill-map.db');
      {
        const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
        await adapter.init();
        try {
          const rows = await adapter.db
            .selectFrom('scan_nodes')
            .select(['path', 'tokensTotal', 'tokensFrontmatter', 'tokensBody'])
            .execute();
          ok(rows.length > 0, 'fixture should yield nodes');
          for (const r of rows) {
            ok(
              r.tokensTotal !== null,
              `default scan: ${r.path} should have tokens_total populated`,
            );
            ok(r.tokensFrontmatter !== null);
            ok(r.tokensBody !== null);
          }
        } finally {
          await adapter.close();
        }
      }

      // Run 2: --no-tokens.
      {
        const cap = captureContext();
        const cmd = buildScan({ noTokens: true });
        cmd.context = cap.context;
        const code = await cmd.execute();
        strictEqual(code, 1, `unexpected exit ${code}; stderr=${cap.stderr()}`);
      }
      {
        const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
        await adapter.init();
        try {
          const rows = await adapter.db
            .selectFrom('scan_nodes')
            .select(['path', 'tokensTotal', 'tokensFrontmatter', 'tokensBody'])
            .execute();
          ok(rows.length > 0);
          for (const r of rows) {
            strictEqual(
              r.tokensTotal,
              null,
              `--no-tokens: ${r.path} should have tokens_total null`,
            );
            strictEqual(r.tokensFrontmatter, null);
            strictEqual(r.tokensBody, null);
          }
        } finally {
          await adapter.close();
        }
      }

      // Run 3: default again, tokens repopulate.
      {
        const cap = captureContext();
        const cmd = buildScan({});
        cmd.context = cap.context;
        const code = await cmd.execute();
        strictEqual(code, 1, `unexpected exit ${code}; stderr=${cap.stderr()}`);
      }
      {
        const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
        await adapter.init();
        try {
          const rows = await adapter.db
            .selectFrom('scan_nodes')
            .select(['path', 'tokensTotal'])
            .execute();
          ok(rows.length > 0);
          for (const r of rows) {
            ok(
              r.tokensTotal !== null,
              `re-enabled: ${r.path} should have tokens_total populated again`,
            );
          }
        } finally {
          await adapter.close();
        }
      }
    } finally {
      process.chdir(originalCwd);
    }
  });
});
