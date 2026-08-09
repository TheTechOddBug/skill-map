/**
 * Lens-change invalidation (`spec/architecture.md` §Provider dispatch
 * rule 3, `spec/db-schema.md` §scan_meta `active_provider`).
 *
 * The active lens decides per-node classification (which Provider
 * claims a file, as which kind) and gates the provider-specific
 * Extractors, so a node cached under one lens is stale under another.
 * Switching the lens through `sm config set activeProvider` or the BFF
 * route drops the whole `scan_*` zone, but that defends the invariant
 * only at the mutation sites; the lens can also change OUT OF BAND (a
 * hand-edited or pulled `settings.json`), which is what this guard
 * covers: each scan records its lens in `scan_meta.active_provider`,
 * and the next one compares before reusing anything.
 *
 * Pinned here:
 *   - `claude` then `agent-skills` on an UNCHANGED fixture: the
 *     `.claude/agents/foo.md` node is re-classified (claude no longer
 *     participates, so `core/markdown` claims it as `markdown`) instead
 *     of keeping its stale `agent` kind and `claude` provider.
 *   - the same lens twice: nodes ARE served from cache, no spurious
 *     rebuild.
 *   - `ScanResult.activeProvider` round-trips through the DB, which is
 *     what makes the comparison possible at all.
 *
 * Uses temp file-based SQLite DBs (not `:memory:`, per
 * `feedback_sqlite_in_memory_workaround.md`).
 */

import { describe, it, before, after } from 'node:test';
import { strictEqual, ok } from 'node:assert';
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

const AGENT_PATH = '.claude/agents/foo.md';
const NOTE_PATH = 'notes.md';

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-lens-invalidation-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function freshFixture(label: string): string {
  const fixture = mkdtempSync(join(tmpRoot, `${label}-`));
  const write = (rel: string, body: string): void => {
    const abs = join(fixture, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, body);
  };
  write(AGENT_PATH, ['---', 'name: foo', 'description: D', '---', 'Body.'].join('\n'));
  write(NOTE_PATH, 'Plain note.\n');
  return fixture;
}

async function fullScan(fixture: string, activeProvider: string): Promise<ScanResult> {
  const kernel = createKernel();
  for (const m of listBuiltIns()) kernel.registry.register(m);
  return runScan(kernel, { roots: [fixture], activeProvider, extensions: builtIns() });
}

/**
 * Incremental scan against a DB-loaded prior, mirroring the production
 * `sm scan` path: persist the prior, reload it (so the prior carries the
 * persisted `activeProvider`), then scan with cache enabled.
 */
async function incrementalScanViaDb(
  fixture: string,
  prior: ScanResult,
  activeProvider: string | null,
  emitter?: InMemoryProgressEmitter,
  incrementalChangedPaths?: { changed: Set<string>; removed: Set<string> },
): Promise<ScanResult> {
  counter += 1;
  const dbPath = join(tmpRoot, `prior-${counter}.db`);
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
    activeProvider,
    extensions: builtIns(),
    priorSnapshot: priorFromDb,
    enableCache: true,
  };
  if (emitter) opts.emitter = emitter;
  if (incrementalChangedPaths) opts.incrementalChangedPaths = incrementalChangedPaths;
  return runScan(kernel, opts);
}

function pairOf(result: ScanResult, path: string): string {
  const node = result.nodes.find((n) => n.path === path);
  ok(node, `${path} should be present`);
  return `${node.provider}/${node.kind}`;
}

describe('lens-change invalidation', () => {
  it('re-classifies every node when the lens changed between scans', async () => {
    const fixture = freshFixture('changed');

    const first = await fullScan(fixture, 'claude');
    strictEqual(first.activeProvider, 'claude');
    strictEqual(pairOf(first, AGENT_PATH), 'claude/agent');
    strictEqual(pairOf(first, NOTE_PATH), 'markdown/markdown');

    // Re-scan the UNCHANGED fixture under a different lens.
    const second = await incrementalScanViaDb(fixture, first, 'agent-skills');
    strictEqual(second.activeProvider, 'agent-skills');
    strictEqual(
      pairOf(second, AGENT_PATH),
      'markdown/markdown',
      'claude no longer participates: the universal base must reclaim the file',
    );
    strictEqual(pairOf(second, NOTE_PATH), 'markdown/markdown');

    // Sanity: identical to a fresh full scan under the new lens.
    const reference = await fullScan(fixture, 'agent-skills');
    strictEqual(pairOf(second, AGENT_PATH), pairOf(reference, AGENT_PATH));

    // The user-visible symptom of a stale pairing: `(provider, kind)`
    // stops resolving to a declared per-kind schema, so the node picks up
    // a phantom `frontmatter-invalid: no-schema`.
    ok(
      !second.issues.some((i) => i.analyzerId === 'frontmatter-invalid'),
      'a re-classified node must not be validated against a schema-less pairing',
    );
  });

  it('reports a full walk on the lens change, never the scoped incremental mode', async () => {
    const fixture = freshFixture('mode');
    const first = await fullScan(fixture, 'claude');

    const events: ProgressEvent[] = [];
    const emitter = new InMemoryProgressEmitter();
    emitter.subscribe((e) => events.push(e));
    // A caller handing the watcher's changed-paths set still gets a FULL
    // walk: a scoped read would skip the nodes the lens change must
    // rebuild (spec/job-events.md §scan.started, a fallback reports
    // `full`).
    await incrementalScanViaDb(fixture, first, 'agent-skills', emitter, {
      changed: new Set([NOTE_PATH]),
      removed: new Set(),
    });

    const started = events.find((e) => e.type === 'scan.started');
    ok(started, 'scan.started should be emitted');
    strictEqual((started.data as { mode: string }).mode, 'full');
  });

  it('treats a prior that recorded no lens as a change (the upgrade path)', async () => {
    const fixture = freshFixture('legacy');
    const first = await fullScan(fixture, 'claude');

    // A snapshot written before `scan_meta.active_provider` existed: the
    // comparison has nothing to trust, so it must rebuild rather than
    // reuse a pairing of unknown provenance.
    const { activeProvider: _dropped, ...withoutLens } = first;
    const legacyPrior: ScanResult = withoutLens;
    const events: ProgressEvent[] = [];
    const emitter = new InMemoryProgressEmitter();
    emitter.subscribe((e) => events.push(e));
    await incrementalScanViaDb(fixture, legacyPrior, 'claude', emitter);

    const cached = events
      .filter((e) => e.type === 'scan.progress')
      .filter((e) => (e.data as { cached?: boolean }).cached === true);
    strictEqual(cached.length, 0, 'nothing may be served from a prior of unknown lens');
  });

  it('does not invalidate when neither scan resolved a lens', async () => {
    const fixture = freshFixture('lensless');
    const kernel = createKernel();
    for (const m of listBuiltIns()) kernel.registry.register(m);
    const first = await runScan(kernel, {
      roots: [fixture],
      activeProvider: null,
      extensions: builtIns(),
    });
    strictEqual(first.activeProvider, null);

    const events: ProgressEvent[] = [];
    const emitter = new InMemoryProgressEmitter();
    emitter.subscribe((e) => events.push(e));
    const second = await incrementalScanViaDb(fixture, first, null, emitter);
    strictEqual(second.activeProvider, null);

    const cached = events
      .filter((e) => e.type === 'scan.progress')
      .filter((e) => (e.data as { cached?: boolean }).cached === true);
    ok(cached.length > 0, 'two lensless scans in a row must still reuse the cache');
  });

  it('keeps serving the cache when the lens is unchanged', async () => {
    const fixture = freshFixture('unchanged');

    const first = await fullScan(fixture, 'claude');

    const events: ProgressEvent[] = [];
    const emitter = new InMemoryProgressEmitter();
    emitter.subscribe((e) => events.push(e));
    const second = await incrementalScanViaDb(fixture, first, 'claude', emitter);

    const cached = events
      .filter((e) => e.type === 'scan.progress')
      .filter((e) => (e.data as { cached?: boolean }).cached === true)
      .map((e) => (e.data as { path: string }).path);
    ok(cached.includes(AGENT_PATH), 'unchanged node under the same lens is served from cache');
    strictEqual(pairOf(second, AGENT_PATH), 'claude/agent');
  });

  it('round-trips the recorded lens through the DB', async () => {
    const fixture = freshFixture('roundtrip');
    const first = await fullScan(fixture, 'claude');

    counter += 1;
    const dbPath = join(tmpRoot, `roundtrip-${counter}.db`);
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      await persistScanResult(adapter.db, first);
      const loaded = await loadScanResult(adapter.db);
      strictEqual(loaded.activeProvider, 'claude');
    } finally {
      await adapter.close();
    }
  });
});
