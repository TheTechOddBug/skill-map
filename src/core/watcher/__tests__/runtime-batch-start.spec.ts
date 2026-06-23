/**
 * `createWatcherRuntime` `onBatchStart` ordering test.
 *
 * Pins the contract that `events.onBatchStart` fires exactly once,
 * synchronously, BEFORE `events.onBatch`, for each batch (here exercised
 * through the initial-batch path). The BFF spinner wiring in
 * `src/server/watcher.ts` depends on this ordering: `onBatchStart` lights
 * the spinner and `onBatch` clears it, so an out-of-order or missing
 * `onBatchStart` would leave the spinner stuck or never started.
 *
 * Drives the runtime against a real temp-dir cwd + a temp file-based
 * SQLite DB (not `:memory:`, per `feedback_sqlite_in_memory_workaround.md`),
 * with `runInitialBatch: true`. The watcher subscribes chokidar AFTER the
 * initial batch (CLI ordering, the default), so we `stop()` right after
 * `start()` resolves to tear chokidar down cleanly. No real file-change
 * loop is driven (the watcher prohibition holds): only the deterministic
 * initial batch is exercised.
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { InMemoryProgressEmitter } from '../../../kernel/adapters/in-memory-progress.js';
import type { IWatcherEvents } from '../runtime.js';
import { createWatcherRuntime } from '../runtime.js';

let tmpRoot: string;
let counter = 0;

function freshCwd(label: string): string {
  counter += 1;
  const dir = join(tmpRoot, `${label}-${counter}`);
  mkdirSync(dir, { recursive: true });
  // A minimal scannable fixture so the batch has something to walk.
  writeFileSync(join(dir, 'note.md'), '# note\n\nbody\n');
  return dir;
}

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-watcher-runtime-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('createWatcherRuntime onBatchStart', () => {
  it('fires once, before onBatch, for the initial batch', async () => {
    const cwd = freshCwd('batch-start');
    const dbPath = join(cwd, '.skill-map', 'graph.db');
    mkdirSync(join(cwd, '.skill-map'), { recursive: true });

    const order: string[] = [];
    const events: IWatcherEvents = {
      onBatchStart: () => order.push('start'),
      onBatch: (outcome) => order.push(`batch:${outcome.kind}`),
    };

    const runtime = createWatcherRuntime({
      dbPath,
      roots: ['.'],
      runtimeContext: { cwd },
      noBuiltIns: false,
      noPlugins: true,
      emitterFactory: () => new InMemoryProgressEmitter(),
      runInitialBatch: true,
      // CLI ordering (default): initial batch runs, THEN chokidar
      // subscribes. We stop() immediately after so chokidar is torn down.
      subscribeBeforeInitial: false,
      events,
    });

    try {
      await runtime.start();
    } finally {
      await runtime.stop();
    }

    // Exactly one start, immediately followed by one ok batch, in order.
    assert.deepEqual(order, ['start', 'batch:ok']);
  });
});
