/**
 * Phase 4 / A.8, universal enrichment layer.
 *
 * The orchestrator persists `ctx.enrichNode(partial)` outputs into a
 * dedicated `node_enrichments` table, strictly separate from the
 * author-supplied frontmatter on `scan_nodes.frontmatter_json`, which the
 * Extractor pipeline NEVER mutates.
 *
 * Extractors are deterministic-only; rows regenerate via the A.9
 * fine-grained scan cache and overwrite the prior row on PK conflict
 * when the body changes. The `stale` and `is_probabilistic` columns are
 * reserved on the row (always `0` in this revision) for a future
 * Action-issued probabilistic enrichment revision.
 *
 * Guarantees pinned by these tests:
 *
 *   (a) Enrichment persists with `is_probabilistic = 0`, `stale = 0`,
 *       and the body hash the extractor saw at run time.
 *   (b) Two extractors enriching the same node land as two distinct rows
 *       (attribution preserved); `mergeNodeWithEnrichments` folds them
 *       last-write-wins per field at read time.
 *   (c) Body change: the row updates via PK conflict on the next scan;
 *       `stale` stays 0 (extractors are deterministic; the A.9 cache
 *       drives regeneration).
 *   (e) `mergeNodeWithEnrichments` filters stale rows by default, sorts
 *       by `enriched_at` ASC, and applies last-write-wins per field on
 *       top of the immutable author frontmatter. Hand-built stale rows
 *       drive this test, the merge contract is preserved for the
 *       future Action-prob revision even though no Extractor write
 *       lands a stale row today.
 *   (f) `sm refresh <node>` re-runs Extractors and persists rows; exit 0.
 *
 * Uses temp file-based SQLite DBs (not `:memory:`, per
 * `feedback_sqlite_in_memory_workaround.md`).
 */

import { describe, it, before, after } from 'node:test';
import { strictEqual, ok, deepStrictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  createKernel,
  mergeNodeWithEnrichments,
  runScanWithRenames,
  type IEnrichmentRecord,
  type IExtractorRunRecord,
  type IPersistedEnrichment,
  type Node,
  type ScanResult,
} from '../../kernel/index.js';
import { builtIns } from '../../plugins/built-ins.js';
import { SqliteStorageAdapter } from '../../kernel/adapters/sqlite/index.js';
import { persistScanResult } from '../../kernel/adapters/sqlite/scan-persistence.js';
import {
  loadExtractorRuns,
  loadNodeEnrichments,
  loadScanResult,
} from '../../kernel/adapters/sqlite/scan-load.js';
import type { IExtractor, IProvider, IAnalyzer } from '../../kernel/extensions/index.js';

interface IScanExtensionsLite {
  providers: IProvider[];
  extractors: IExtractor[];
  analyzers: IAnalyzer[];
}

let tmpRoot: string;
let dbCounter = 0;

function freshDbPath(label: string): string {
  dbCounter += 1;
  return join(tmpRoot, `${label}-${dbCounter}.db`);
}

function freshFixture(label: string): string {
  return mkdtempSync(join(tmpRoot, `${label}-`));
}

function writeFixtureFile(root: string, rel: string, content: string): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
}

function fullFixture(root: string): void {
  writeFixtureFile(
    root,
    '.claude/agents/architect.md',
    [
      '---',
      'name: architect',
      'description: The architect',
      '---',
      '',
      'Architect body content.',
    ].join('\n'),
  );
  writeFixtureFile(
    root,
    '.claude/commands/deploy.md',
    ['---', 'name: deploy', 'description: Deploy', '---', 'Deploy body.'].join('\n'),
  );
}

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-node-enrichments-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

/**
 * Build a deterministic enrichment-only probe: emits no links, only
 * enriches the node with a `title` field. Tracks calls so tests can
 * assert which nodes the extractor saw.
 */
function buildDetEnricher(opts: {
  id: string;
  pluginId: string;
  /** Override the title value emitted; defaults to `<id>:<node.path>`. */
  title?: (node: Node) => string;
}): { extractor: IExtractor; seenPaths: string[] } {
  const seenPaths: string[] = [];
  const extractor: IExtractor = {
    kind: 'extractor',
    id: opts.id,
    pluginId: opts.pluginId,
    version: '1.0.0',
    description: 'test',
    scope: 'body',
    extract: (ctx): void => {
      seenPaths.push(ctx.node.path);
      const title = opts.title ? opts.title(ctx.node) : `${opts.id}:${ctx.node.path}`;
      // `title` is no longer a typed Node field, these tests use it as
      // an opaque sentinel to verify the enrichment buffer's merge /
      // dedup semantics. The persistence layer JSON-serialises the bag
      // verbatim, so the round-trip works regardless of Node typing.
      ctx.enrichNode({ title } as unknown as Partial<Node>);
    },
  };
  return { extractor, seenPaths };
}

interface IRunOnceArgs {
  fixture: string;
  dbPath: string;
  extensions: IScanExtensionsLite;
  enableCache?: boolean;
  withFineGrainedCache?: boolean;
}

interface IRunOnceResult {
  result: ScanResult;
  extractorRuns: IExtractorRunRecord[];
  enrichments: IEnrichmentRecord[];
  persistedEnrichments: IPersistedEnrichment[];
}

/**
 * One-shot scan + persist + reload-enrichments helper. Mirrors the CLI
 * flow for a single scan; returns the freshly-emitted enrichments AND
 * the rows that landed in `node_enrichments` so tests can assert on
 * both surfaces.
 */
async function runOnce(args: IRunOnceArgs): Promise<IRunOnceResult> {
  const kernel = createKernel();
  const adapter = new SqliteStorageAdapter({
    databasePath: args.dbPath,
    autoBackup: false,
  });
  await adapter.init();
  try {
    const loaded = await loadScanResult(adapter.db);
    const prior = loaded.nodes.length > 0 ? loaded : null;
    const priorRuns = args.withFineGrainedCache
      ? await loadExtractorRuns(adapter.db)
      : undefined;
    const runOptions: Parameters<typeof runScanWithRenames>[1] = {
      roots: [args.fixture],
      extensions: args.extensions,
    };
    if (prior) {
      runOptions.priorSnapshot = prior;
      runOptions.enableCache = args.enableCache === true;
    }
    if (priorRuns) runOptions.priorExtractorRuns = priorRuns;
    const ran = await runScanWithRenames(kernel, runOptions);
    await persistScanResult(adapter.db, ran.result, {
      renameOps: ran.renameOps,
      extractorRuns: ran.extractorRuns,
      enrichments: ran.enrichments,
    });
    const persistedEnrichments = await loadNodeEnrichments(adapter.db);
    return {
      result: ran.result,
      extractorRuns: ran.extractorRuns,
      enrichments: ran.enrichments,
      persistedEnrichments,
    };
  } finally {
    await adapter.close();
  }
}

describe('node_enrichments, universal enrichment layer (A.8)', () => {
  it('Test (a), enrichment persists with is_probabilistic=0, stale=0, current body hash', async () => {
    const fixture = freshFixture('det-persist');
    fullFixture(fixture);
    const dbPath = freshDbPath('det-persist');

    const baseline = builtIns();
    const probe = buildDetEnricher({ id: 'titleizer', pluginId: 'test' });

    const { result, persistedEnrichments } = await runOnce({
      fixture,
      dbPath,
      extensions: {
        providers: baseline.providers,
        extractors: [...baseline.extractors, probe.extractor],
        analyzers: baseline.analyzers,
      },
      withFineGrainedCache: true,
    });

    // Probe ran on every node.
    deepStrictEqual(
      [...probe.seenPaths].sort(),
      ['.claude/agents/architect.md', '.claude/commands/deploy.md'],
    );

    // The probe's rows landed in node_enrichments, one per node.
    const probeRows = persistedEnrichments.filter(
      (e) => e.extractorId === 'test/titleizer',
    );
    strictEqual(probeRows.length, 2, 'one row per node enriched');
    for (const row of probeRows) {
      strictEqual(row.isProbabilistic, false, 'extractor → is_probabilistic = 0');
      strictEqual(row.stale, false, 'fresh row → stale = 0');
      // Body hash matches the live node's body hash.
      const liveNode = result.nodes.find((n) => n.path === row.nodePath);
      ok(liveNode, 'node still in scan result');
      strictEqual(
        row.bodyHashAtEnrichment,
        liveNode!.bodyHash,
        'body_hash_at_enrichment matches the live node body hash',
      );
      // Value carries the title the probe emitted.
      strictEqual((row.value as Record<string, unknown>)['title'], `titleizer:${row.nodePath}`);
    }
  });

  it('Test (b), multi-extractor enrichment: distinct rows per (node, extractor); merge is last-write-wins per field', async () => {
    const fixture = freshFixture('multi-extractor');
    fullFixture(fixture);
    const dbPath = freshDbPath('multi-extractor');

    const baseline = builtIns();
    // Two extractors that BOTH emit a title onto the same node. The later
    // `enriched_at` should win at merge time; both rows should land in the
    // table.
    const first = buildDetEnricher({
      id: 'first',
      pluginId: 'test',
      title: () => 'first-title',
    });
    const second = buildDetEnricher({
      id: 'second',
      pluginId: 'test',
      title: () => 'second-title',
    });

    const { result, persistedEnrichments } = await runOnce({
      fixture,
      dbPath,
      extensions: {
        providers: baseline.providers,
        extractors: [...baseline.extractors, first.extractor, second.extractor],
        analyzers: baseline.analyzers,
      },
      withFineGrainedCache: true,
    });

    // Distinct rows.
    const archPath = '.claude/agents/architect.md';
    const archRows = persistedEnrichments.filter((e) => e.nodePath === archPath);
    const firstRow = archRows.find((e) => e.extractorId === 'test/first');
    const secondRow = archRows.find((e) => e.extractorId === 'test/second');
    ok(firstRow, 'first extractor row persists');
    ok(secondRow, 'second extractor row persists');
    strictEqual((firstRow!.value as Record<string, unknown>)['title'], 'first-title');
    strictEqual((secondRow!.value as Record<string, unknown>)['title'], 'second-title');

    // Merge: last-write-wins. The orchestrator records `enriched_at` via
    // Date.now() at each enrichNode call; on a single scan they are
    // monotonically non-decreasing in extractor registration order. The
    // merge should reflect "second" winning because second was registered
    // after first.
    const archNode = result.nodes.find((n) => n.path === archPath);
    ok(archNode, 'architect node in result');
    const merged = mergeNodeWithEnrichments(archNode!, persistedEnrichments);
    // Author kept their `name` (from frontmatter); enrichment overlay
    // adds `title`. The two enrichers wrote distinct values for `title`;
    // the later-written one wins.
    strictEqual(merged['name'], 'architect', 'author frontmatter survives the merge');
    // Pinning "second" wins: second was registered second AND its
    // record's `enrichedAt` is monotonically >= first's. The mechanic
    // matters, assert against the stronger ground truth (sort by
    // enrichedAt ASC, then last-write-wins).
    const sorted = [firstRow!, secondRow!].sort((a, b) => a.enrichedAt - b.enrichedAt);
    const expectedTitle = (sorted[sorted.length - 1]!.value as Record<string, unknown>)['title'];
    strictEqual(merged['title'], expectedTitle, 'last-written enrichment wins');
  });

  it('Test (c), body change with det enrichment: row updates on next scan; stale stays 0', async () => {
    const fixture = freshFixture('det-body-change');
    fullFixture(fixture);
    const dbPath = freshDbPath('det-body-change');

    const baseline = builtIns();
    const probe = buildDetEnricher({
      id: 'body-mirror',
      pluginId: 'test',
      // Encode the body hash into the title so the test can see the
      // value refresh on rescan.
      title: (node) => `mirror:${node.bodyHash.slice(0, 8)}`,
    });

    const exts = {
      providers: baseline.providers,
      extractors: [...baseline.extractors, probe.extractor],
      analyzers: baseline.analyzers,
    };

    const first = await runOnce({
      fixture,
      dbPath,
      extensions: exts,
      withFineGrainedCache: true,
    });
    const archPath = '.claude/agents/architect.md';
    const firstRow = first.persistedEnrichments.find(
      (e) => e.nodePath === archPath && e.extractorId === 'test/body-mirror',
    );
    ok(firstRow, 'first scan persisted the det enrichment');
    const firstHash = firstRow!.bodyHashAtEnrichment;
    const firstTitle = (firstRow!.value as Record<string, unknown>)['title'];

    // Mutate body.
    writeFixtureFile(
      fixture,
      '.claude/agents/architect.md',
      [
        '---',
        'name: architect',
        'description: The architect',
        '---',
        '',
        'Architect body, UPDATED.',
      ].join('\n'),
    );

    const second = await runOnce({
      fixture,
      dbPath,
      extensions: exts,
      enableCache: true,
      withFineGrainedCache: true,
    });
    const secondRow = second.persistedEnrichments.find(
      (e) => e.nodePath === archPath && e.extractorId === 'test/body-mirror',
    );
    ok(secondRow, 'second scan persisted the det enrichment');
    strictEqual(secondRow!.stale, false, 'det rows never get stale-flagged');
    ok(
      secondRow!.bodyHashAtEnrichment !== firstHash,
      'body hash at enrichment refreshed to the new body',
    );
    ok(
      (secondRow!.value as Record<string, unknown>)['title'] !== firstTitle,
      'value refreshed via PK conflict on the upsert',
    );
  });

  it('Test (e), mergeNodeWithEnrichments: filters stale, sorts by enriched_at, last-write-wins per field', async () => {
    // Synthesise a mini-enrichment list and a node, then drive the helper
    // directly. No DB / kernel involvement, this is a pure unit test of
    // the merge contract.
    const node: Node = {
      path: 'test.md',
      kind: 'markdown',
      provider: 'test',
      bodyHash: 'a'.repeat(64),
      frontmatterHash: 'b'.repeat(64),
      bytes: { frontmatter: 1, body: 1, total: 2 },
      linksOutCount: 0,
      linksInCount: 0,
      externalRefsCount: 0,
      frontmatter: { name: 'author-name', stability: 'stable' },
    };
    const baseTime = 1_000_000;
    const enrichments: IPersistedEnrichment[] = [
      // Older non-stale: writes title=alpha
      {
        nodePath: 'test.md',
        extractorId: 'test/alpha',
        bodyHashAtEnrichment: 'a'.repeat(64),
        value: { title: 'alpha-title' } as unknown as Partial<Node>,
        stale: false,
        enrichedAt: baseTime,
        isProbabilistic: false,
      },
      // Newer non-stale: writes title=beta (should win)
      {
        nodePath: 'test.md',
        extractorId: 'test/beta',
        bodyHashAtEnrichment: 'a'.repeat(64),
        value: { title: 'beta-title', description: 'beta-desc' } as unknown as Partial<Node>,
        stale: false,
        enrichedAt: baseTime + 100,
        isProbabilistic: false,
      },
      // Stale row: writes title=GHOST. Should be filtered out by default.
      {
        nodePath: 'test.md',
        extractorId: 'test/ghost',
        bodyHashAtEnrichment: 'OLD',
        value: { title: 'ghost-title', description: 'ghost-desc' } as unknown as Partial<Node>,
        stale: true,
        enrichedAt: baseTime + 1000,
        isProbabilistic: true,
      },
      // Different node, should never appear in this node's merge.
      {
        nodePath: 'other.md',
        extractorId: 'test/elsewhere',
        bodyHashAtEnrichment: 'X',
        value: { title: 'elsewhere' } as unknown as Partial<Node>,
        stale: false,
        enrichedAt: baseTime + 50,
        isProbabilistic: false,
      },
    ];

    const merged = mergeNodeWithEnrichments(node, enrichments);
    // Author keys preserved.
    strictEqual(merged['name'], 'author-name');
    strictEqual(merged['stability'], 'stable');
    // Last-write-wins between alpha and beta.
    strictEqual(merged['title'], 'beta-title', 'beta wins on later enriched_at');
    // Beta's description stuck (alpha didn't write it).
    strictEqual(merged['description'], 'beta-desc');
    // Stale row excluded.
    ok(
      String(merged['title']) !== 'ghost-title',
      'stale row does not enter merge',
    );

    // includeStale: true → ghost wins (newest).
    const mergedIncludeStale = mergeNodeWithEnrichments(node, enrichments, {
      includeStale: true,
    });
    strictEqual(
      mergedIncludeStale['title'],
      'ghost-title',
      'with includeStale, the newest stale row wins',
    );
    strictEqual(
      mergedIncludeStale['description'],
      'ghost-desc',
      'stale description bleeds through under includeStale',
    );
  });
});

// --- (f) sm refresh stub ---------------------------------------------------

const REPO_ROOT = process.cwd();
const SM_BIN = join(REPO_ROOT, 'bin', 'sm.js');

interface ICliResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runCli(cwd: string, args: string[]): ICliResult {
  const result = spawnSync('node', [SM_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

describe('sm refresh (A.8)', () => {
  it('Test (f), `sm refresh <node>` re-runs extractors, persists rows, exit 0', async () => {
    const fixture = freshFixture('refresh-stub');
    fullFixture(fixture);

    // First a real `sm scan` so the DB has something to refresh against.
    const scanResult = runCli(fixture, ['scan']);
    strictEqual(scanResult.status, 0, `scan failed: ${scanResult.stderr}`);

    // Run refresh against an existing node.
    const refreshResult = runCli(fixture, ['refresh', '.claude/agents/architect.md']);
    strictEqual(
      refreshResult.status,
      0,
      `refresh failed: stderr=${refreshResult.stderr} stdout=${refreshResult.stdout}`,
    );
    // New layout: single-line success on stdout, glyph + count + path.
    // No mid-action banner anymore, the elapsed-time line on stderr
    // covers the duration sense.
    ok(
      refreshResult.stdout.includes('enrichment') &&
        refreshResult.stdout.includes('.claude/agents/architect.md'),
      `expected enrichment count + path in stdout, got: ${refreshResult.stdout}`,
    );
    ok(
      /✓\s+\d+\s+enrichment/.test(refreshResult.stdout),
      `expected ✓ glyph + count in stdout, got: ${refreshResult.stdout}`,
    );
  });

  it('Test (f.2), `sm refresh <missing-node>` exits 5 (not-found)', async () => {
    const fixture = freshFixture('refresh-missing');
    fullFixture(fixture);
    const scanResult = runCli(fixture, ['scan']);
    strictEqual(scanResult.status, 0);

    const refreshResult = runCli(fixture, ['refresh', 'does/not/exist.md']);
    strictEqual(refreshResult.status, 5, `expected NotFound; stderr=${refreshResult.stderr}`);
    // New layout: ✕ glyph + headline + dim hint. Match case-insensitive
    // to stay tolerant of future copy tweaks while still catching the
    // diagnostic intent.
    ok(
      /node not found/i.test(refreshResult.stderr),
      `expected "Node not found" in stderr, got: ${refreshResult.stderr}`,
    );
  });

  it('Test (f.3), `sm refresh --stale` with no stale rows exits 0 with a clear "nothing to do" message', async () => {
    const fixture = freshFixture('refresh-stale-empty');
    fullFixture(fixture);
    const scanResult = runCli(fixture, ['scan']);
    strictEqual(scanResult.status, 0);

    const refreshResult = runCli(fixture, ['refresh', '--stale']);
    strictEqual(
      refreshResult.status,
      0,
      `--stale with empty stale set should exit 0; stderr=${refreshResult.stderr}`,
    );
    ok(
      /no stale enrichment rows/i.test(refreshResult.stdout),
      `expected "no stale enrichment rows" in stdout, got: ${refreshResult.stdout}`,
    );
  });

  it('Test (f.4), argument validation: --stale and <node> are mutually exclusive', async () => {
    const fixture = freshFixture('refresh-mutex');
    fullFixture(fixture);
    const scanResult = runCli(fixture, ['scan']);
    strictEqual(scanResult.status, 0);

    const refreshResult = runCli(fixture, ['refresh', '--stale', 'foo.md']);
    strictEqual(refreshResult.status, 2, `expected Error; stderr=${refreshResult.stderr}`);
    ok(
      refreshResult.stderr.includes('cannot be combined'),
      `expected mutex message; stderr=${refreshResult.stderr}`,
    );
  });

  it('Test (f.5), `sm refresh` accepts external-Provider kinds (open kind contract)', async () => {
    // Defensive guard for the open-kind refactor: refresh loads the
    // node via `loadScanResult` (which now returns `kind: string`), then
    // walks `applicable = extractors.filter(...applicableKinds...)`. No
    // built-in extractor is `applicableKinds: ['cursorRule']`, so the
    // applicable set is empty, refresh persists zero det enrichments
    // and exits 0 without rejecting the kind. A regression that retypes
    // any layer to `NodeKind` would crash here either at load time
    // (cast failure) or at runtime (filter dropping the row).
    const fixture = freshFixture('refresh-external-kind');
    // Plant a body file on disk so refresh's `readFile(node.path)`
    // succeeds. The frontmatter shape is permissive, no built-in
    // extractor reads it for a `cursorRule` node anyway.
    const bodyPath = join(fixture, '.cursor', 'rules', 'strict-mode.md');
    mkdirSync(join(bodyPath, '..'), { recursive: true });
    writeFileSync(bodyPath, ['---', 'name: strict-mode', '---', 'Body.'].join('\n'));

    // Initialise the project DB with `sm init --no-scan` (creates
    // `.skill-map/skill-map.db` migrated to v1, with no rows).
    const initResult = runCli(fixture, ['init', '--no-scan']);
    strictEqual(initResult.status, 0, `init failed: ${initResult.stderr}`);

    // Plant the external-kind row directly. The kernel's persist path
    // would route through the Claude Provider only; raw insert is the
    // simplest way to seed the contract under test.
    const dbAdapter = new SqliteStorageAdapter({
      databasePath: join(fixture, '.skill-map', 'skill-map.db'),
      autoBackup: false,
    });
    await dbAdapter.init();
    try {
      const a64 = 'a'.repeat(64);
      const b64 = 'b'.repeat(64);
      await dbAdapter.db
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
      await dbAdapter.close();
    }

    const refreshResult = runCli(fixture, ['refresh', '.cursor/rules/strict-mode.md']);
    strictEqual(
      refreshResult.status,
      0,
      `refresh of external-kind node failed: status=${refreshResult.status} stderr=${refreshResult.stderr} stdout=${refreshResult.stdout}`,
    );
    // Zero det extractors applied (no built-in extractor declares
    // applicableKinds: ['cursorRule']); the verb still confirms the
    // refresh ran (count = 0) on stdout, under the new layout that's
    // a `✓  0 enrichment rows from <path>` line.
    ok(
      /✓\s+0\s+enrichment/.test(refreshResult.stdout),
      `refresh should still print the success line at zero count: stdout=${refreshResult.stdout}`,
    );
  });
});
