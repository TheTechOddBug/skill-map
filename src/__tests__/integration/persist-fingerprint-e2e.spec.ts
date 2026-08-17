/**
 * End-to-end pin of the result-fingerprint skip on the REAL scan
 * pipeline (built-in providers + extractors + analyzers), the exact
 * regression the unit spec cannot see: analyzers re-run on every scan
 * and register freshly-run tuples + contributions unconditionally, so
 * a warm rescan is only skippable because the tuple set participates
 * in the fingerprint as content (a "tuples must be empty" gate never
 * engaged on any real scan).
 *
 * Flow mirrors the CLI runner: `runScanWithRenames` produces the full
 * persist envelope and every side input is threaded into
 * `persistScanResult` the way `core/runtime/scan-runner.ts` does.
 *
 * Probe technique (shared with `persist-fingerprint.spec.ts`): an
 * out-of-band UPDATE on one `scan_nodes` row survives a skipped
 * persist and is wiped by a full replace-all.
 *
 * Uses temp file-based SQLite DBs (`:memory:` is broken per
 * `feedback_sqlite_in_memory_workaround.md`).
 */

import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createKernel, runScanWithRenames } from '../../kernel/index.js';
import type { ScanResult } from '../../kernel/index.js';
import { builtIns, listBuiltIns } from '../../plugins/built-ins.js';
import { SqliteStorageAdapter } from '../../kernel/adapters/sqlite/index.js';
import { persistScanResult } from '../../kernel/adapters/sqlite/scan-persistence.js';

let tmpRoot: string;

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-persist-fp-e2e-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

const PROBE = '__fp-e2e-probe__';
const ALPHA = '.claude/skills/alpha/SKILL.md';

function writeFixture(root: string, rel: string, lines: string[]): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, lines.join('\n'));
}

function seedFixture(root: string): void {
  writeFixture(root, ALPHA, [
    '---',
    'name: alpha',
    'description: refers to beta',
    '---',
    'Use the [beta skill](../beta/SKILL.md) and /missing-command.',
  ]);
  writeFixture(root, '.claude/skills/beta/SKILL.md', [
    '---',
    'name: beta',
    'description: leaf',
    '---',
    'Leaf body.',
  ]);
}

type TScanEnvelope = Awaited<ReturnType<typeof runScanWithRenames>>;

async function scanEnvelope(fixture: string, prior?: ScanResult): Promise<TScanEnvelope> {
  const kernel = createKernel();
  for (const m of listBuiltIns()) kernel.registry.register(m);
  return runScanWithRenames(kernel, {
    roots: [fixture],
    extensions: builtIns(),
    ...(prior ? { priorSnapshot: prior, enableCache: true } : {}),
  });
}

async function persistEnvelope(adapter: SqliteStorageAdapter, env: TScanEnvelope): Promise<void> {
  await persistScanResult(adapter.db, env.result, {
    renameOps: env.renameOps,
    extractorRuns: env.extractorRuns,
    enrichments: env.enrichments,
    contributions: env.contributions,
    contributionErrors: env.contributionErrors,
    linkScores: env.linkScores,
    freshlyRunTuples: env.freshlyRunTuples,
  });
}

async function plantProbe(adapter: SqliteStorageAdapter): Promise<void> {
  await adapter.db.updateTable('scan_nodes').set({ title: PROBE }).where('path', '=', ALPHA).execute();
}

async function probeSurvived(adapter: SqliteStorageAdapter): Promise<boolean> {
  const row = await adapter.db
    .selectFrom('scan_nodes')
    .select('title')
    .where('path', '=', ALPHA)
    .executeTakeFirst();
  return row?.title === PROBE;
}

describe('result-fingerprint skip, end-to-end over the built-in pipeline', () => {
  it('the second warm rescan skips the rewrite; an edit takes the full path again', async () => {
    const fixture = mkdtempSync(join(tmpRoot, 'fixture-'));
    seedFixture(fixture);
    const adapter = new SqliteStorageAdapter({
      databasePath: join(tmpRoot, 'e2e.db'),
      autoBackup: false,
    });
    await adapter.init();
    try {
      // Cold scan, then a first warm rescan: the tuple set differs
      // between cold (extract ran) and warm (analyzers only), so this
      // persist legitimately takes the full path and stores the
      // warm-shape fingerprint.
      const cold = await scanEnvelope(fixture);
      await persistEnvelope(adapter, cold);
      const warm1 = await scanEnvelope(fixture, cold.result);
      assert.ok(warm1.freshlyRunTuples.size > 0, 'analyzers must register tuples on a warm scan');
      assert.ok(warm1.contributions.length > 0, 'analyzers must emit contributions on a warm scan');
      await persistEnvelope(adapter, warm1);

      // Second warm rescan: identical content, identical tuple set,
      // the skip must engage.
      await plantProbe(adapter);
      const warm2 = await scanEnvelope(fixture, warm1.result);
      await persistEnvelope(adapter, warm2);
      assert.equal(await probeSurvived(adapter), true, 'warm rescan must skip the node rewrite');

      const meta = await adapter.db
        .selectFrom('scan_meta')
        .select(['scannedAt', 'resultFingerprint'])
        .execute();
      assert.equal(meta.length, 1, 'scan_meta stays single-row on a skip');
      assert.equal(meta[0]!.scannedAt, warm2.result.scannedAt, 'scanned_at refreshes on a skip');
      assert.ok(meta[0]!.resultFingerprint, 'the stored fingerprint stays populated');

      // Negative control: a real edit changes the result, the full
      // path runs and the probe is wiped.
      writeFixture(fixture, '.claude/skills/beta/SKILL.md', [
        '---',
        'name: beta',
        'description: leaf',
        '---',
        'Leaf body, edited.',
      ]);
      const warm3 = await scanEnvelope(fixture, warm2.result);
      await persistEnvelope(adapter, warm3);
      assert.equal(await probeSurvived(adapter), false, 'an edited corpus must take the full path');
    } finally {
      await adapter.close();
    }
  });
});
