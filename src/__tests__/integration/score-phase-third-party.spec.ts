/**
 * End-to-end acceptance for a THIRD-PARTY `score`-phase analyzer.
 *
 * The link-confidence scoring mechanism is plugin-extensible: any analyzer
 * declaring `phase: 'score'` may call `ctx.adjustConfidence(link, op)`, and
 * the orchestrator folds every op (built-in + third-party) into the final
 * `link.confidence` deterministically. This test proves an EXTERNAL plugin
 * (its body written to a temp dir and loaded via dynamic `import()`, the
 * same way the on-disk plugin loader projects a manifest into a runtime
 * descriptor) participates in that fold as a first-class citizen.
 *
 * The fixture seeds a `source.md` whose `[text](./target.md)` link resolves
 * to `target.md`. Through the pipeline:
 *
 *   1. `core/markdown-link` emits the link.
 *   2. the kernel seeds the 1.0 baseline on every link, and the post-walk
 *      lift records `resolvedTarget = target.md`.
 *   3. NO built-in score-phase op fires on this clean resolved link (the
 *      1.0 baseline is the kernel's, not an analyzer op): the reserved and
 *      broken detectors only touch reserved / broken edges.
 *   4. the third-party scorer folds `delta -0.4` (→ 0.6) and a no-op
 *      `floor 0.5` on top.
 *
 * Asserts:
 *   (a) `scan_links.confidence` reflects the fold (`0.6`), the kernel 1.0
 *       baseline plus the third-party `delta -0.4`;
 *   (b) the ONLY `scan_link_scores` row for this link is attributed to the
 *       external plugin (`pluginId` / `extensionId`) with its `delta` op;
 *       no built-in op rides along on a clean resolved link;
 *   (c) determinism: two independent scans produce identical confidence
 *       AND identical adjustment ordering.
 *
 * Uses a temp file-based SQLite (`mkdtempSync`); `:memory:` does not work
 * with the adapter's two-`DatabaseSync` design (see
 * `feedback_sqlite_in_memory_workaround`).
 */

import { describe, it, before, after } from 'node:test';
import { strictEqual, ok, deepStrictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createKernel, runScan, runScanWithRenames } from '../../kernel/index.js';
import { builtIns, listBuiltIns } from '../../plugins/built-ins.js';
import { SqliteStorageAdapter } from '../../kernel/adapters/sqlite/index.js';
import { persistScanResult } from '../../kernel/adapters/sqlite/scan-persistence.js';
import type { IAnalyzer } from '../../kernel/extensions/index.js';

const THIRD_PARTY_PLUGIN_ID = 'thirdparty-scorer';
const THIRD_PARTY_EXTENSION_ID = 'demote';

let fixture: string;
let pluginDir: string;
let dbRoot: string;
let dbCounter = 0;

/**
 * On-disk body of the external `score`-phase analyzer, written to a temp
 * file and dynamically imported below. Pure ESM, no test-only imports, so
 * `import()` resolves it exactly like the real plugin loader would.
 */
const SCORER_SOURCE = `export default {
  version: '2.3.0',
  description: 'third-party scorer: delta -0.4 then floor 0.5 on every link',
  mode: 'deterministic',
  phase: 'score',
  evaluate(ctx) {
    for (const link of ctx.links) {
      ctx.adjustConfidence?.(link, { kind: 'delta', value: -0.4 });
      ctx.adjustConfidence?.(link, { kind: 'floor', value: 0.5 });
    }
    return [];
  },
};
`;

function freshDbPath(label: string): string {
  dbCounter += 1;
  return join(dbRoot, `${label}-${dbCounter}.db`);
}

/**
 * Load the external analyzer body from disk and wrap it as a runtime
 * `IAnalyzer`, stamping the `pluginId` / `kind` / `id` the on-disk loader
 * derives from the plugin folder structure. This is the EXTERNAL plugin
 * the scan registers alongside the built-ins.
 */
async function loadThirdPartyScorer(): Promise<IAnalyzer> {
  const mod = (await import(pathToFileURL(join(pluginDir, 'index.js')).href)) as {
    default: Omit<IAnalyzer, 'pluginId' | 'kind' | 'id'>;
  };
  return {
    ...mod.default,
    pluginId: THIRD_PARTY_PLUGIN_ID,
    kind: 'analyzer',
    id: THIRD_PARTY_EXTENSION_ID,
  };
}

before(() => {
  fixture = mkdtempSync(join(tmpdir(), 'skill-map-score-3p-fixture-'));
  pluginDir = mkdtempSync(join(tmpdir(), 'skill-map-score-3p-plugin-'));
  dbRoot = mkdtempSync(join(tmpdir(), 'skill-map-score-3p-db-'));

  const write = (rel: string, content: string): void => {
    const abs = join(fixture, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  };
  write(
    'source.md',
    [
      '---',
      'name: source',
      'description: Source whose link resolves to target.md.',
      '---',
      '',
      'Read [the target file](./target.md) for more context.',
    ].join('\n'),
  );
  write(
    'target.md',
    ['---', 'name: target', 'description: Resolution target.', '---', '', 'Body.'].join('\n'),
  );

  writeFileSync(join(pluginDir, 'index.js'), SCORER_SOURCE);
});

after(() => {
  rmSync(fixture, { recursive: true, force: true });
  rmSync(pluginDir, { recursive: true, force: true });
  rmSync(dbRoot, { recursive: true, force: true });
});

async function scanWithThirdParty(): Promise<
  Awaited<ReturnType<typeof runScanWithRenames>>
> {
  const kernel = createKernel();
  const scorer = await loadThirdPartyScorer();
  const exts = builtIns();
  return runScanWithRenames(kernel, {
    roots: [fixture],
    extensions: {
      providers: exts.providers,
      extractors: exts.extractors,
      analyzers: [...exts.analyzers, scorer],
    },
    tokenize: false,
  });
}

describe('third-party score-phase analyzer (end-to-end)', () => {
  it('folds the third-party delta on top of the kernel baseline and attributes the op in scan_link_scores', async () => {
    const ran = await scanWithThirdParty();

    // The resolved markdown link: kernel seeds 1.0, third-party folds
    // delta -0.4 → 0.6, floor 0.5 is a no-op (0.6 > 0.5). No built-in op
    // fires on a clean resolved edge (the 1.0 baseline is the kernel's).
    const link = ran.result.links.find(
      (l) => l.source === 'source.md' && l.target === 'target.md',
    );
    ok(link, 'expected the source.md → target.md link in the graph');
    strictEqual(link!.resolvedTarget, 'target.md');
    strictEqual(
      link!.confidence,
      0.6,
      'confidence must be the FOLD of kernel baseline 1.0 + third-party delta -0.4',
    );

    // The buffer carries the third-party ops (the delta -0.4 AND the no-op
    // floor 0.5, both emitted by the scorer). A clean resolved link gets
    // NO built-in score-phase op (the 1.0 baseline is the kernel's, and
    // the reserved / broken detectors do not touch a clean edge).
    const thirdPartyOps = ran.linkScores.filter(
      (a) => a.pluginId === THIRD_PARTY_PLUGIN_ID && a.link.target === 'target.md',
    );
    strictEqual(
      thirdPartyOps.length,
      2,
      'the third-party scorer contributes its delta -0.4 and floor 0.5 on this link',
    );
    ok(
      thirdPartyOps.some((a) => a.op.kind === 'delta' && a.op.value === -0.4),
      'the third-party delta -0.4 is buffered',
    );
    const builtInOpsOnLink = ran.linkScores.filter(
      (a) => a.pluginId === 'core' && a.link.target === 'target.md',
    );
    strictEqual(
      builtInOpsOnLink.length,
      0,
      'no built-in op rides along on a clean resolved link (1.0 is the kernel baseline)',
    );

    const adapter = new SqliteStorageAdapter({
      databasePath: freshDbPath('score-3p'),
      autoBackup: false,
    });
    await adapter.init();
    try {
      await persistScanResult(adapter.db, ran.result, {
        renameOps: ran.renameOps,
        extractorRuns: ran.extractorRuns,
        enrichments: ran.enrichments,
        linkScores: ran.linkScores,
      });

      // (a) persisted scan_links.confidence reflects the fold.
      const linkRows = await adapter.db.selectFrom('scan_links').selectAll().execute();
      const persistedLink = linkRows.find(
        (l) => l.sourcePath === 'source.md' && l.targetPath === 'target.md',
      );
      ok(persistedLink, 'persisted scan_links row for the resolved link');
      strictEqual(persistedLink!.confidence, 0.6);

      // (b) a scan_link_scores row attributed to the EXTERNAL plugin, with
      //     its delta op and the folded result denormalised onto the row.
      const scoreRows = await adapter.db
        .selectFrom('scan_link_scores')
        .selectAll()
        .execute();
      const thirdPartyRow = scoreRows.find(
        (r) =>
          r.pluginId === THIRD_PARTY_PLUGIN_ID &&
          r.extensionId === THIRD_PARTY_EXTENSION_ID &&
          r.sourcePath === 'source.md' &&
          r.target === 'target.md',
      );
      ok(thirdPartyRow, 'expected a scan_link_scores row attributed to the third-party scorer');
      strictEqual(thirdPartyRow!.opKind, 'delta');
      strictEqual(thirdPartyRow!.opValue, -0.4);
      strictEqual(
        thirdPartyRow!.resultConfidence,
        0.6,
        'denormalised result_confidence mirrors the folded scan_links.confidence',
      );

      // No built-in score-phase row for this clean resolved link: the 1.0
      // baseline is the kernel's, not an analyzer op, so the third-party
      // delta is the ONLY attribution on this edge.
      const builtInRow = scoreRows.find(
        (r) =>
          r.pluginId === 'core' &&
          r.sourcePath === 'source.md' &&
          r.target === 'target.md',
      );
      strictEqual(
        builtInRow,
        undefined,
        'no built-in score row on a clean resolved link (kernel baseline, not an op)',
      );
    } finally {
      await adapter.close();
    }
  });

  it('is deterministic: two scans produce identical confidence and identical adjustment ordering', async () => {
    const first = await scanWithThirdParty();
    const second = await scanWithThirdParty();

    const confidenceFor = (
      ran: Awaited<ReturnType<typeof runScanWithRenames>>,
    ): number => {
      const link = ran.result.links.find(
        (l) => l.source === 'source.md' && l.target === 'target.md',
      );
      ok(link, 'expected the resolved link on every scan');
      return link!.confidence;
    };
    strictEqual(confidenceFor(first), confidenceFor(second));
    strictEqual(confidenceFor(first), 0.6);

    // Adjustment ordering: the same (pluginId, extensionId, opKind, opValue)
    // sequence on both runs. Project the buffer to its attribution shape and
    // deep-compare in emission order.
    const projection = (ran: Awaited<ReturnType<typeof runScanWithRenames>>) =>
      ran.linkScores.map((a) => ({
        pluginId: a.pluginId,
        extensionId: a.extensionId,
        source: a.link.source,
        target: a.link.target,
        opKind: a.op.kind,
        opValue: a.op.value,
      }));
    deepStrictEqual(
      projection(first),
      projection(second),
      'two scans must buffer the same adjustments in the same order',
    );
    // Sanity: the buffer actually contains the third-party op (guards
    // against the projection silently comparing two empty arrays).
    ok(
      projection(first).some((p) => p.pluginId === THIRD_PARTY_PLUGIN_ID),
      'the third-party op must be present in the deterministic buffer',
    );
  });

  // Positive-delta composition: deltas fold together AND a third-party
  // scorer can RAISE confidence, even on a link a built-in already pushed
  // down. A `/help` slash resolves to a reserved command, so
  // `core/name-reserved` applies `delta -0.9` (kernel 1.0 baseline → 0.1).
  // A third-party scorer adds `delta +0.3` on top; the fold sums every
  // delta (1.0 - 0.9 + 0.3 = 0.4) before the single clamp, so the reserved
  // edge lands at 0.4 instead of the bare 0.1. This pins that confidence is
  // genuinely plugin-extensible in BOTH directions.
  it('a positive third-party delta lifts a built-in-penalised (reserved) link: 0.1 folds to 0.4', async () => {
    const local = mkdtempSync(join(tmpdir(), 'skill-map-score-3p-positive-'));
    try {
      const writeLocal = (rel: string, content: string): void => {
        const abs = join(local, rel);
        mkdirSync(join(abs, '..'), { recursive: true });
        writeFileSync(abs, content);
      };
      writeLocal(
        '.claude/agents/operator.md',
        ['---', 'name: operator', 'description: The operator.', '---', 'Run /help.'].join('\n'),
      );
      // Plant the reserved-name target so `/help` resolves to it and
      // `core/name-reserved` fires its -0.9 delta.
      writeLocal(
        '.claude/commands/help.md',
        ['---', 'name: help', 'description: Shadow of built-in /help.', '---', 'Body.'].join('\n'),
      );

      const kernel = createKernel();
      for (const manifest of listBuiltIns()) kernel.registry.register(manifest);

      // A third-party scorer that ADDS 0.3 to every link.
      const positiveScorer: IAnalyzer = {
        version: '1.0.0',
        description: 'third-party scorer: delta +0.3 on every link',
        mode: 'deterministic',
        phase: 'score',
        pluginId: 'thirdparty-booster',
        kind: 'analyzer',
        id: 'boost',
        evaluate(ctx) {
          for (const link of ctx.links) {
            ctx.adjustConfidence?.(link, { kind: 'delta', value: 0.3 });
          }
          return [];
        },
      } as IAnalyzer;

      const exts = builtIns();
      const result = await runScan(kernel, {
        roots: [local],
        extensions: {
          providers: exts.providers,
          extractors: exts.extractors,
          analyzers: [...exts.analyzers, positiveScorer],
        },
      });

      const helpLink = result.links.find(
        (l) =>
          l.source === '.claude/agents/operator.md' &&
          l.kind === 'invokes' &&
          l.target === '/help',
      );
      ok(helpLink, 'expected the /help slash link');
      strictEqual(
        helpLink!.resolvedTarget,
        '.claude/commands/help.md',
        'the reserved command must resolve so core/name-reserved penalises it',
      );
      // fold = kernel 1.0 + name-reserved delta -0.9 + third-party delta
      // +0.3 = 0.4 (float-tolerant: the delta sum is binary-FP).
      ok(
        Math.abs(helpLink!.confidence - 0.4) < 1e-9,
        `expected ~0.4 (1.0 - 0.9 + 0.3), got ${helpLink!.confidence}`,
      );
    } finally {
      rmSync(local, { recursive: true, force: true });
    }
  });
});
