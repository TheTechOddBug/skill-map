/**
 * Tokenizer-change invalidation (project-config.schema.json §tokenizer
 * "Changing this invalidates prior counts on next scan").
 *
 * The incremental cache reuses per-node `tokens` for unchanged nodes.
 * Those counts were produced by whatever encoder the prior scan recorded
 * in `scan_meta.tokenizer` / `ScanResult.tokenizer`. When the resolved
 * encoder for the next scan differs, the cached counts are stale and the
 * walker must force a fresh token recompute (bypass cache reuse) so the
 * counts reflect the new encoder.
 *
 * Pinned here:
 *   - cl100k_base then o200k_base on an UNCHANGED fixture: the node's
 *     token counts change (cache did not serve the stale cl100k_base
 *     counts), and `result.tokenizer` reports the new encoder.
 *   - cl100k_base then cl100k_base (same encoder) on an unchanged
 *     fixture: the node IS served from cache (`cached: true`) and the
 *     counts are byte-identical (no spurious recompute).
 *
 * The fixture body is CJK text because cl100k_base and o200k_base
 * disagree on its token count (18 vs 15 at authoring time); short ASCII
 * strings tokenize identically under both encoders.
 *
 * Uses temp file-based SQLite DBs (not `:memory:`, per
 * `feedback_sqlite_in_memory_workaround.md`).
 */

import { describe, it, before, after } from 'node:test';
import { strictEqual, ok, notStrictEqual, deepStrictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createKernel, runScan, InMemoryProgressEmitter } from '../../kernel/index.js';
import type { ScanResult } from '../../kernel/index.js';
import { builtIns, listBuiltIns } from '../../plugins/built-ins.js';
import { SqliteStorageAdapter } from '../../kernel/adapters/sqlite/index.js';
import { persistScanResult } from '../../kernel/adapters/sqlite/scan-persistence.js';
import { loadScanResult } from '../../kernel/adapters/sqlite/scan-load.js';
import type { ProgressEvent } from '../../kernel/ports/progress-emitter.js';

let tmpRoot: string;
let counter = 0;

// CJK body: the two encoders disagree on its token count, so the per-node
// `tokens.body` is the discriminator after an encoder switch.
const CJK_BODY = '日本語のテキストをトークン化する例文です';
const NODE_PATH = '.claude/skills/probe/SKILL.md';

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-tok-invalidation-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function freshFixture(label: string): string {
  const fixture = mkdtempSync(join(tmpRoot, `${label}-`));
  const abs = join(fixture, NODE_PATH);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(
    abs,
    ['---', 'name: probe', 'description: D', '---', CJK_BODY].join('\n'),
  );
  return fixture;
}

function freshDbPath(label: string): string {
  counter += 1;
  return join(tmpRoot, `${label}-${counter}.db`);
}

async function fullScan(fixture: string, tokenizer: string): Promise<ScanResult> {
  const kernel = createKernel();
  for (const m of listBuiltIns()) kernel.registry.register(m);
  return runScan(kernel, { roots: [fixture], tokenizer, extensions: builtIns() });
}

/**
 * Incremental scan against a DB-loaded prior, mirroring the production
 * `sm scan --changed` path: persist the prior, reload it (so the prior
 * carries the persisted `tokenizer`), then scan with cache enabled.
 */
async function incrementalScanViaDb(
  fixture: string,
  prior: ScanResult,
  tokenizer: string,
  emitter?: InMemoryProgressEmitter,
): Promise<ScanResult> {
  const dbPath = freshDbPath('prior');
  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  let priorFromDb: ScanResult;
  try {
    await persistScanResult(adapter.db, prior);
    priorFromDb = await loadScanResult(adapter.db);
  } finally {
    await adapter.close();
  }

  const kernel = createKernel();
  for (const m of listBuiltIns()) kernel.registry.register(m);
  const opts: Parameters<typeof runScan>[1] = {
    roots: [fixture],
    tokenizer,
    extensions: builtIns(),
    priorSnapshot: priorFromDb,
    enableCache: true,
  };
  if (emitter) opts.emitter = emitter;
  return runScan(kernel, opts);
}

function bodyTokensOf(result: ScanResult): number {
  const node = result.nodes.find((n) => n.path === NODE_PATH);
  ok(node, 'fixture skill node should be present');
  ok(node.tokens, 'node should carry token counts when tokenization is on');
  return node.tokens.body;
}

describe('tokenizer-change invalidation', () => {
  it('recomputes token counts when the tokenizer changes between scans (cache does not serve stale counts)', async () => {
    const fixture = freshFixture('changed');

    const first = await fullScan(fixture, 'cl100k_base');
    strictEqual(first.tokenizer, 'cl100k_base');
    const clCount = bodyTokensOf(first);

    // Re-scan the UNCHANGED fixture under a different encoder.
    const second = await incrementalScanViaDb(fixture, first, 'o200k_base');
    strictEqual(second.tokenizer, 'o200k_base');
    const o2Count = bodyTokensOf(second);

    notStrictEqual(
      o2Count,
      clCount,
      'token counts must be recomputed with the new encoder, not reused from cache',
    );

    // Sanity: the recomputed count matches a fresh full scan under
    // o200k_base (i.e. it really is the o200k_base count).
    const reference = await fullScan(fixture, 'o200k_base');
    strictEqual(o2Count, bodyTokensOf(reference));
  });

  it('keeps the cached counts intact when the tokenizer is unchanged', async () => {
    const fixture = freshFixture('unchanged');

    const first = await fullScan(fixture, 'cl100k_base');
    const firstCount = bodyTokensOf(first);

    const events: ProgressEvent[] = [];
    const emitter = new InMemoryProgressEmitter();
    emitter.subscribe((e) => events.push(e));
    const second = await incrementalScanViaDb(fixture, first, 'cl100k_base', emitter);

    // Same encoder + unchanged body → the node is served from cache.
    const progress = events.filter((e) => e.type === 'scan.progress');
    const node = progress.find(
      (e) => (e.data as { path: string }).path === NODE_PATH,
    );
    ok(node, 'progress event for the probe node should exist');
    strictEqual((node.data as { cached: boolean }).cached, true);

    // Counts are byte-identical (no spurious recompute).
    deepStrictEqual(
      second.nodes.find((n) => n.path === NODE_PATH)?.tokens,
      first.nodes.find((n) => n.path === NODE_PATH)?.tokens,
    );
    strictEqual(bodyTokensOf(second), firstCount);
  });
});
