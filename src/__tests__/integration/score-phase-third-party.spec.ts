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
 *   2. the post-walk lift records `resolvedTarget = target.md`.
 *   3. the built-in `core/score-resolution` scorer sets it to `1.0`.
 *   4. the third-party scorer folds `delta -0.4` (→ 0.6) and a no-op
 *      `floor 0.5` on top.
 *
 * Asserts:
 *   (a) `scan_links.confidence` reflects the fold (`0.6`), not the bare
 *       built-in baseline (`1.0`) nor the bare third-party op;
 *   (b) a `scan_link_scores` row attributed to the external plugin
 *       (`pluginId` / `extensionId`) with its `delta` op;
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

import { createKernel, runScanWithRenames } from '../../kernel/index.js';
import { builtIns } from '../../plugins/built-ins.js';
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
  it('folds the third-party delta on top of the built-in baseline and attributes the op in scan_link_scores', async () => {
    const ran = await scanWithThirdParty();

    // The resolved markdown link: built-in sets 1.0, third-party folds
    // delta -0.4 → 0.6, floor 0.5 is a no-op (0.6 > 0.5).
    const link = ran.result.links.find(
      (l) => l.source === 'source.md' && l.target === 'target.md',
    );
    ok(link, 'expected the source.md → target.md link in the graph');
    strictEqual(link!.resolvedTarget, 'target.md');
    strictEqual(
      link!.confidence,
      0.6,
      'confidence must be the FOLD of built-in set 1.0 + third-party delta -0.4',
    );

    // The buffer carries both the built-in and the third-party op.
    const thirdPartyOps = ran.linkScores.filter(
      (a) => a.pluginId === THIRD_PARTY_PLUGIN_ID,
    );
    ok(thirdPartyOps.length > 0, 'third-party scorer must contribute at least one op');
    const builtInOps = ran.linkScores.filter((a) => a.pluginId === 'core');
    ok(builtInOps.length > 0, 'built-in core/score-resolution must contribute the baseline op');

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

      // The built-in baseline op is also attributed (the dogfood path).
      const builtInRow = scoreRows.find(
        (r) =>
          r.pluginId === 'core' &&
          r.extensionId === 'score-resolution' &&
          r.sourcePath === 'source.md' &&
          r.target === 'target.md',
      );
      ok(builtInRow, 'built-in core/score-resolution row must coexist with the third-party row');
      strictEqual(builtInRow!.opKind, 'set');
      strictEqual(builtInRow!.opValue, 1);
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
});
