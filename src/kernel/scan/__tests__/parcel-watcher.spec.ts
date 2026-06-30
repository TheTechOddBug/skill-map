/**
 * `@parcel/watcher` wrapper unit tests (the primary scan watcher).
 *
 * Real filesystem (mkdtemp) + real `@parcel/watcher`; the wrapper's
 * debounce / batch / extension-gate / ignore-filter logic does not lend
 * itself to mocks. Each test creates its own temp dir and tears the
 * watcher down explicitly.
 *
 * Parcel emits events asynchronously and coalesces one notification per
 * file; the debounce window collapses bursts. Tests use small windows and
 * a `next()` collector that resolves as soon as the wrapper invokes
 * `onBatch`. The shared debounce machinery is also covered by the chokidar
 * suite; here we focus on the parcel-specific surface (event mapping,
 * per-event extension gate + ignore filter, ready/close).
 */
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { createParcelWatcher, buildParcelIgnore } from '../watcher.js';
import type { IFsWatcher, IWatchBatch } from '../watcher.js';
import { buildIgnoreFilter } from '../ignore.js';

let root: string;
let counter = 0;

function freshScope(label: string): string {
  counter += 1;
  const dir = join(root, `${label}-${counter}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

interface IBatchCollector {
  batches: IWatchBatch[];
  next(): Promise<IWatchBatch>;
}

function makeCollector(): { collector: IBatchCollector; onBatch: (b: IWatchBatch) => void } {
  const batches: IWatchBatch[] = [];
  const waiters: Array<(b: IWatchBatch) => void> = [];
  const onBatch = (batch: IWatchBatch): void => {
    const w = waiters.shift();
    if (w) w(batch);
    else batches.push(batch);
  };
  const next = (): Promise<IWatchBatch> => {
    const b = batches.shift();
    if (b !== undefined) return Promise.resolve(b);
    return new Promise((r) => waiters.push(r));
  };
  return { collector: { batches, next }, onBatch };
}

const base = (p: string): string | undefined => p.split('/').pop();

before(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-map-parcel-watcher-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('createParcelWatcher', () => {
  it('reports add / change / unlink events to onBatch', async () => {
    const dir = freshScope('events');
    const { collector, onBatch } = makeCollector();
    const watcher: IFsWatcher = createParcelWatcher({
      cwd: root,
      roots: [dir],
      debounceMs: 60,
      onBatch,
    });
    try {
      await watcher.ready;
      writeFileSync(join(dir, 'a.md'), '# a');
      let batch = await collector.next();
      assert.ok(
        batch.events.some((e) => e.kind === 'add' && e.absolutePath.endsWith('a.md')),
        'add event fired',
      );

      writeFileSync(join(dir, 'a.md'), '# a v2');
      batch = await collector.next();
      assert.ok(
        batch.events.some((e) => e.kind === 'change' && e.absolutePath.endsWith('a.md')),
        'change event fired',
      );

      unlinkSync(join(dir, 'a.md'));
      batch = await collector.next();
      assert.ok(
        batch.events.some((e) => e.kind === 'unlink' && e.absolutePath.endsWith('a.md')),
        'unlink event fired',
      );
    } finally {
      await watcher.close();
    }
  });

  it('coalesces a burst into one debounced batch with deduped paths', async () => {
    const dir = freshScope('debounce');
    const { collector, onBatch } = makeCollector();
    const watcher = createParcelWatcher({ cwd: root, roots: [dir], debounceMs: 120, onBatch });
    try {
      await watcher.ready;
      writeFileSync(join(dir, 'a.md'), '# a');
      writeFileSync(join(dir, 'b.md'), '# b');
      writeFileSync(join(dir, 'a.md'), '# a v2'); // repeat path within the window
      const batch = await collector.next();
      const names = batch.paths.map(base).sort();
      assert.deepEqual([...new Set(names)], names, 'paths are deduplicated');
      assert.ok(names.includes('a.md') && names.includes('b.md'), 'both files land in one batch');
    } finally {
      await watcher.close();
    }
  });

  it('honours the extension gate (only watched extensions fire)', async () => {
    const dir = freshScope('extgate');
    const { collector, onBatch } = makeCollector();
    const watcher = createParcelWatcher({
      cwd: root,
      roots: [dir],
      debounceMs: 80,
      watchedExtensions: ['.md'],
      onBatch,
    });
    try {
      await watcher.ready;
      writeFileSync(join(dir, 'skip.txt'), 'nope');
      writeFileSync(join(dir, 'keep.md'), '# yes');
      const batch = await collector.next();
      const names = batch.paths.map(base);
      assert.ok(names.includes('keep.md'), '.md fires');
      assert.ok(!names.includes('skip.txt'), '.txt is gated out');
    } finally {
      await watcher.close();
    }
  });

  it('respects a getter ignoreFilter and a runtime swap', async () => {
    const dir = freshScope('ignore');
    const { collector, onBatch } = makeCollector();
    let activeFilter = buildIgnoreFilter({ includeDefaults: false, configIgnore: ['ignored/'] });
    const watcher = createParcelWatcher({
      cwd: dir,
      roots: [dir],
      debounceMs: 80,
      ignoreFilter: (): ReturnType<typeof buildIgnoreFilter> => activeFilter,
      onBatch,
    });
    try {
      await watcher.ready;
      mkdirSync(join(dir, 'ignored'), { recursive: true });
      writeFileSync(join(dir, 'ignored', 'x.md'), '# x'); // ignored
      writeFileSync(join(dir, 'kept.md'), '# kept');
      let batch = await collector.next();
      let names = batch.paths.map(base);
      assert.ok(names.includes('kept.md'), 'non-ignored path fires');
      assert.ok(!names.includes('x.md'), 'ignored path is dropped');

      // Swap the filter at runtime: now nothing is ignored.
      activeFilter = buildIgnoreFilter({ includeDefaults: false });
      writeFileSync(join(dir, 'ignored', 'y.md'), '# y');
      batch = await collector.next();
      names = batch.paths.map(base);
      assert.ok(names.includes('y.md'), 'after the swap a previously-ignored path fires');
    } finally {
      await watcher.close();
    }
  });

  it('close() drops pending events without firing onBatch', async () => {
    const dir = freshScope('close');
    const { collector, onBatch } = makeCollector();
    const watcher = createParcelWatcher({ cwd: root, roots: [dir], debounceMs: 200, onBatch });
    await watcher.ready;
    writeFileSync(join(dir, 'a.md'), '# a');
    await delay(30); // event enqueued, debounce window not yet elapsed
    await watcher.close();
    await delay(260);
    assert.equal(collector.batches.length, 0, 'no batch fires after close');
  });

  it('does not watch node_modules (native ignore prune)', async () => {
    const dir = freshScope('prune');
    mkdirSync(join(dir, 'node_modules', 'junk'), { recursive: true });
    const { collector, onBatch } = makeCollector();
    // No ignoreFilter / extension gate, so the JS `accept` keeps everything;
    // anything that fires proves parcel was NOT pruned natively.
    const watcher = createParcelWatcher({ cwd: dir, roots: [dir], debounceMs: 80, onBatch });
    try {
      await watcher.ready;
      writeFileSync(join(dir, 'node_modules', 'junk', 'a.md'), '# junk');
      writeFileSync(join(dir, 'doc.md'), '# doc');
      const batch = await collector.next();
      const names = batch.paths.map(base);
      assert.ok(names.includes('doc.md'), 'a normal file fires (watcher is alive)');
      assert.ok(!names.includes('a.md'), 'the node_modules edit is pruned and never fires');
      // No straggler batch carrying the node_modules edit after settling.
      await delay(160);
      const stragglers = collector.batches.flatMap((b) => b.paths.map(base));
      assert.ok(!stragglers.includes('a.md'), 'node_modules stays pruned after settle');
    } finally {
      await watcher.close();
    }
  });
});

describe('buildParcelIgnore', () => {
  it('combines default dirs with raw gitignore lines, skipping comments and negations', () => {
    const dir = mkdtempSync(join(tmpdir(), 'parcel-ignore-'));
    try {
      writeFileSync(
        join(dir, '.gitignore'),
        ['mybigdir/', '# a comment', '!keep-me', '*.log', '', 'vendor'].join('\n'),
      );
      const ignore = buildParcelIgnore(dir);
      // Bundled defaults present, bare + depth-agnostic glob.
      assert.ok(
        ignore.includes('node_modules') && ignore.includes('**/node_modules'),
        'default dirs present (bare + ** glob)',
      );
      // Raw gitignore lines folded in, trailing slash stripped.
      assert.ok(ignore.includes('mybigdir'), 'gitignore dir line included (slash stripped)');
      assert.ok(ignore.includes('*.log') && ignore.includes('vendor'), 'gitignore patterns included');
      // Comments and negations dropped.
      assert.ok(!ignore.some((p) => p.startsWith('#')), 'comment lines dropped');
      assert.ok(!ignore.some((p) => p.startsWith('!')), 'negation lines dropped');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
