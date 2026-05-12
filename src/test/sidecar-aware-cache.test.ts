/**
 * Sidecar-aware per-(node, extractor) cache key.
 *
 * Pins the architectural fix that replaced the previous watcher-level
 * `invalidateCache` workaround. The kernel's per-extractor cache tracks
 * `sidecar_annotations_hash_at_run` alongside `body_hash_at_run`; both
 * hashes must match for a cache hit. A sidecar edit therefore re-runs
 * every applicable extractor on that node — universal invalidation by
 * design (an opt-in flag was rejected: silent stale-data bugs if
 * authors forget to declare it).
 *
 * Scenarios:
 *
 *   A. Sidecar edit invalidates the per-extractor cache; registered
 *      probes re-run on the next pass.
 *   B. End-to-end: an operator flips `annotations.stability` and the
 *      next scan emits the new contribution (was the watcher bug).
 *
 * Uses temp file-based SQLite DBs per
 * `feedback_sqlite_in_memory_workaround.md`.
 */

import { describe, it, before, after } from 'node:test';
import { strictEqual, ok, deepStrictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  createKernel,
  runScanWithRenames,
  type IExtractorRunRecord,
  type ScanResult,
} from '../kernel/index.js';
import { builtIns } from '../built-in-plugins/built-ins.js';
import { SqliteStorageAdapter } from '../kernel/adapters/sqlite/index.js';
import { persistScanResult } from '../kernel/adapters/sqlite/scan-persistence.js';
import {
  loadExtractorRuns,
  loadScanResult,
  type IPriorExtractorRun,
} from '../kernel/adapters/sqlite/scan-load.js';
import type { IExtractor, IProvider, IAnalyzer } from '../kernel/extensions/index.js';
import { qualifiedExtensionId } from '../kernel/registry.js';

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

function writeFile(root: string, rel: string, content: string): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
}

const NODE_PATH = '.claude/agents/architect.md';
const SIDECAR_PATH = '.claude/agents/architect.sm';

const BASE_MD = [
  '---',
  'name: architect',
  'description: The architect',
  '---',
  '',
  'Body content here.',
].join('\n');

function writeMd(fixture: string): void {
  writeFile(fixture, NODE_PATH, BASE_MD);
}

function writeSidecar(
  fixture: string,
  bodyHash: string,
  frontmatterHash: string,
  annotations: Record<string, unknown>,
): void {
  const annotationLines: string[] = [];
  for (const [k, v] of Object.entries(annotations)) {
    annotationLines.push(`  ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  }
  writeFile(
    fixture,
    SIDECAR_PATH,
    [
      'identity:',
      `  path: ${NODE_PATH}`,
      `  bodyHash: ${bodyHash}`,
      `  frontmatterHash: ${frontmatterHash}`,
      'annotations:',
      ...annotationLines,
      '',
    ].join('\n'),
  );
}

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-sidecar-cache-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

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
  priorRuns?: Map<string, Map<string, IPriorExtractorRun>>;
}

/**
 * Project the qualified contribution keys declared by the supplied
 * extractors + analyzers so the persistence layer's catalog sweep
 * doesn't drop emitted rows. Mirrors `collectRegisteredContributionKeys`
 * from `core/runtime/plugin-runtime.ts` (which works on the composed
 * bundle, not on a raw extensions object).
 */
function collectKeys(extensions: IScanExtensionsLite): Set<string> {
  const keys = new Set<string>();
  for (const ex of [...extensions.extractors, ...extensions.analyzers]) {
    const raw = (ex as { viewContributions?: unknown }).viewContributions;
    if (typeof raw !== 'object' || raw === null) continue;
    for (const contributionId of Object.keys(raw as Record<string, unknown>)) {
      keys.add(`${qualifiedExtensionId(ex.pluginId, ex.id)}/${contributionId}`);
    }
  }
  return keys;
}

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
    await persistScanResult(
      adapter.db,
      ran.result,
      ran.renameOps,
      ran.extractorRuns,
      ran.enrichments,
      ran.contributions,
      collectKeys(args.extensions),
      ran.freshlyRunTuples,
    );
    const out: IRunOnceResult = {
      result: ran.result,
      extractorRuns: ran.extractorRuns,
    };
    if (priorRuns) out.priorRuns = priorRuns;
    return out;
  } finally {
    await adapter.close();
  }
}

/**
 * Build a probe extractor that records every node it sees. No author
 * flag needed — the kernel hashes the sidecar annotations for every
 * extractor unconditionally.
 */
function buildProbe(opts: {
  id: string;
}): { extractor: IExtractor; seenPaths: string[] } {
  const seenPaths: string[] = [];
  const extractor: IExtractor = {
    kind: 'extractor',
    id: opts.id,
    pluginId: 'test',
    version: '1.0.0',
    emitsLinkKinds: [],
    defaultConfidence: 'low',
    scope: 'frontmatter',
    extract: (ctx): void => {
      seenPaths.push(ctx.node.path);
    },
  };
  return { extractor, seenPaths };
}

describe('sidecar-aware per-(node, extractor) cache key', () => {
  it('A — sidecar edits invalidate the per-extractor cache; body-only edits stay cached', async () => {
    const fixture = freshFixture('sidecar-flip');
    writeMd(fixture);
    const dbPath = freshDbPath('sidecar-flip');

    const probe = buildProbe({ id: 'probe' });
    const baseline = builtIns();

    // First scan: no sidecar yet, probe runs.
    await runOnce({
      fixture,
      dbPath,
      extensions: {
        providers: baseline.providers,
        extractors: [probe.extractor],
        analyzers: baseline.analyzers,
      },
      withFineGrainedCache: true,
    });
    strictEqual(probe.seenPaths.length, 1, 'probe ran on first scan');

    // Capture real hashes from the first scan to author the sidecar.
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    let bodyHash = '';
    let frontmatterHash = '';
    try {
      const loaded = await loadScanResult(adapter.db);
      const node = loaded.nodes.find((n) => n.path === NODE_PATH)!;
      bodyHash = node.bodyHash;
      frontmatterHash = node.frontmatterHash;
    } finally {
      await adapter.close();
    }
    ok(bodyHash, 'captured body hash');

    // Reset probe call list.
    probe.seenPaths.length = 0;

    // Author a sidecar with `stability: experimental`. Body + frontmatter
    // unchanged; sidecar annotations hash flips `{}` → `{stability:experimental}`,
    // so the cache invalidates and the probe re-runs.
    writeSidecar(fixture, bodyHash, frontmatterHash, { stability: 'experimental' });

    await runOnce({
      fixture,
      dbPath,
      extensions: {
        providers: baseline.providers,
        extractors: [probe.extractor],
        analyzers: baseline.analyzers,
      },
      enableCache: true,
      withFineGrainedCache: true,
    });
    strictEqual(
      probe.seenPaths.length,
      1,
      'probe RE-RAN after sidecar created (hash {} → {stability:experimental})',
    );

    // Reset and flip the sidecar value (experimental → deprecated). Body
    // and frontmatter unchanged; sidecar hash changed → re-run.
    probe.seenPaths.length = 0;
    writeSidecar(fixture, bodyHash, frontmatterHash, { stability: 'deprecated' });

    await runOnce({
      fixture,
      dbPath,
      extensions: {
        providers: baseline.providers,
        extractors: [probe.extractor],
        analyzers: baseline.analyzers,
      },
      enableCache: true,
      withFineGrainedCache: true,
    });
    strictEqual(
      probe.seenPaths.length,
      1,
      'probe RE-RAN on sidecar value flip',
    );

    // Final pass with no sidecar edit — both hashes match, full cache hit.
    probe.seenPaths.length = 0;
    await runOnce({
      fixture,
      dbPath,
      extensions: {
        providers: baseline.providers,
        extractors: [probe.extractor],
        analyzers: baseline.analyzers,
      },
      enableCache: true,
      withFineGrainedCache: true,
    });
    strictEqual(
      probe.seenPaths.length,
      0,
      'probe stayed CACHED when neither body, frontmatter, nor sidecar changed',
    );
  });

  it('B — end-to-end: flipping annotations.stability propagates through the built-in core/stability analyzer', async () => {
    const fixture = freshFixture('e2e-stability');
    writeMd(fixture);
    const dbPath = freshDbPath('e2e-stability');

    const baseline = builtIns();

    // First scan to capture hashes.
    await runOnce({ fixture, dbPath, extensions: baseline, withFineGrainedCache: true });

    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    let bodyHash = '';
    let frontmatterHash = '';
    try {
      const loaded = await loadScanResult(adapter.db);
      const node = loaded.nodes.find((n) => n.path === NODE_PATH)!;
      bodyHash = node.bodyHash;
      frontmatterHash = node.frontmatterHash;
    } finally {
      await adapter.close();
    }

    // Author a sidecar with stability: experimental.
    writeSidecar(fixture, bodyHash, frontmatterHash, { stability: 'experimental' });
    await runOnce({
      fixture, dbPath, extensions: baseline, enableCache: true, withFineGrainedCache: true,
    });

    function readStabilityContributions(): string[] {
      const conn = new DatabaseSync(dbPath);
      try {
        const stmt = conn.prepare(
          "SELECT contribution_id FROM scan_contributions WHERE node_path = ? AND plugin_id = 'core' AND extension_id = 'stability' ORDER BY contribution_id",
        );
        const rows = stmt.all(NODE_PATH) as Array<{ contribution_id: string }>;
        return rows.map((r) => r.contribution_id);
      } finally {
        conn.close();
      }
    }

    deepStrictEqual(
      readStabilityContributions(),
      ['experimental'],
      "first sidecar (experimental) wrote contribution_id='experimental'",
    );

    // Flip experimental → deprecated. Body and frontmatter unchanged.
    // The pre-fix bug: the kernel cache reused the prior `experimental`
    // contribution because neither body nor frontmatter changed.
    writeSidecar(fixture, bodyHash, frontmatterHash, { stability: 'deprecated' });
    await runOnce({
      fixture, dbPath, extensions: baseline, enableCache: true, withFineGrainedCache: true,
    });

    // Inspect the contribution row directly. With the fix, the prior
    // `experimental` row was replaced by the freshly-emitted
    // `deprecated` row (because the per-tuple sweep dropped the old
    // contribution when `core/stability` re-ran for this node).
    deepStrictEqual(
      readStabilityContributions(),
      ['deprecated'],
      "post-flip scan shows ONLY the new 'deprecated' contribution — pre-fix bug emitted ['experimental'] from cache",
    );
  });
});
