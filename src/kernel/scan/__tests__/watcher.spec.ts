/**
 * Chokidar watcher unit tests.
 *
 * Real filesystem (mkdtemp) and real chokidar, the wrapper logic
 * (debounce, batch coalescing, ignore-filter integration, clean
 * teardown) doesn't lend itself to mocks. Each test creates its own
 * temp directory and tears the watcher down explicitly.
 *
 * Timing is the touchy part: chokidar emits events asynchronously,
 * and the debounce window collapses bursts. The tests use small
 * windows (50–80ms) and `waitForBatch` helpers that resolve as soon
 * as the wrapper invokes `onBatch`.
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, unlinkSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { createChokidarWatcher } from '../watcher.js';
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
    if (waiters.length > 0) {
      const w = waiters.shift();
      w?.(batch);
    } else {
      batches.push(batch);
    }
  };
  const next = (): Promise<IWatchBatch> => {
    const b = batches.shift();
    if (b !== undefined) return Promise.resolve(b);
    return new Promise((r) => waiters.push(r));
  };
  return { collector: { batches, next }, onBatch };
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-map-watcher-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('createChokidarWatcher', () => {
  it('coalesces a burst of writes into a single debounced batch', async () => {
    const dir = freshScope('debounce');
    const { collector, onBatch } = makeCollector();
    const watcher: IFsWatcher = createChokidarWatcher({
      cwd: root,
      roots: [dir],
      debounceMs: 80,
      onBatch,
    });
    try {
      await watcher.ready;
      writeFileSync(join(dir, 'a.md'), '# a');
      writeFileSync(join(dir, 'b.md'), '# b');
      writeFileSync(join(dir, 'c.md'), '# c');
      const batch = await collector.next();
      assert.equal(batch.paths.length, 3, 'three distinct paths in the batch');
      assert.deepEqual(
        batch.paths.map((p) => p.split('/').pop()).sort(),
        ['a.md', 'b.md', 'c.md'],
      );
      // No leftover batches after the burst settles.
      await delay(150);
      assert.equal(collector.batches.length, 0, 'no follow-up batch');
    } finally {
      await watcher.close();
    }
  });

  it('follows a symlinked directory INSIDE the root (live events behind the link)', async () => {
    // Live updates behind an internal symlinked directory are the whole
    // reason `--watch-backend chokidar` is selectable over parcel, so
    // the containment gate below must not cost us this. The link target
    // stays inside the watched root, so the walker indexes it and the
    // watcher watches it.
    const dir = freshScope('symlink-internal');
    const inside = join(dir, 'real-target');
    mkdirSync(inside, { recursive: true });
    let linked = true;
    try {
      symlinkSync(inside, join(dir, 'skills'));
    } catch {
      linked = false;
    }
    if (!linked) return; // sandbox without symlink support
    const { collector, onBatch } = makeCollector();
    const watcher: IFsWatcher = createChokidarWatcher({
      cwd: dir,
      roots: [dir],
      debounceMs: 60,
      onBatch,
    });
    try {
      await watcher.ready;
      writeFileSync(join(inside, 'x.md'), '# x');
      const batch = await collector.next();
      assert.ok(
        batch.paths.some((p) => p.endsWith('x.md')),
        'a change behind the internal symlink reaches onBatch',
      );
    } finally {
      await watcher.close();
    }
  });

  it('refuses a symlink ESCAPING the root (audit finding, 2026-08-01)', async () => {
    // chokidar dereferences symlinks by default, so a committed
    // `docs/x -> ~/` armed inotify watches across the operator's whole
    // home directory: no content leaked (the walker's read gate still
    // refused it) but the WATCH escaped containment, which exhausts
    // inotify and turns out-of-tree edits into an activity oracle.
    // This test previously asserted the opposite, that the escaping
    // link WAS followed; the assertion was the vulnerability.
    const dir = freshScope('symlink-escape');
    const outside = mkdtempSync(join(root, 'symlink-target-'));
    let linked = true;
    try {
      symlinkSync(outside, join(dir, 'skills'));
    } catch {
      linked = false;
    }
    if (!linked) return; // sandbox without symlink support
    const { collector, onBatch } = makeCollector();
    const watcher: IFsWatcher = createChokidarWatcher({
      cwd: dir,
      roots: [dir],
      debounceMs: 60,
      onBatch,
    });
    try {
      await watcher.ready;
      writeFileSync(join(outside, 'x.md'), '# x'); // reachable only via dir/skills
      // A same-root write proves the watcher is alive: without it, a
      // silently dead watcher would pass this test for the wrong reason.
      writeFileSync(join(dir, 'inside.md'), '# inside');
      const batch = await collector.next();
      assert.ok(
        batch.paths.some((p) => p.endsWith('inside.md')),
        'the watcher is alive and still reports in-root changes',
      );
      assert.ok(
        !batch.paths.some((p) => p.endsWith('x.md')),
        'the escaping symlink produced no event',
      );
    } finally {
      await watcher.close();
    }
  });

  it('follows an escaping symlink once followExternalSymlinks opts in', async () => {
    // The escape hatch is the same key the walker reads, so watch scope
    // and read scope agree in both directions.
    const dir = freshScope('symlink-optin');
    const outside = mkdtempSync(join(root, 'symlink-target-'));
    let linked = true;
    try {
      symlinkSync(outside, join(dir, 'skills'));
    } catch {
      linked = false;
    }
    if (!linked) return; // sandbox without symlink support
    const { collector, onBatch } = makeCollector();
    const watcher: IFsWatcher = createChokidarWatcher({
      cwd: dir,
      roots: [dir],
      debounceMs: 60,
      followExternalSymlinks: true,
      onBatch,
    });
    try {
      await watcher.ready;
      writeFileSync(join(outside, 'x.md'), '# x');
      const batch = await collector.next();
      assert.ok(
        batch.paths.some((p) => p.endsWith('x.md')),
        'the opt-in restores the pre-gate behaviour',
      );
    } finally {
      await watcher.close();
    }
  });

  it('produces a second batch when changes arrive after the first', async () => {
    const dir = freshScope('multi-batch');
    const { collector, onBatch } = makeCollector();
    const watcher = createChokidarWatcher({
      cwd: root,
      roots: [dir],
      debounceMs: 60,
      onBatch,
    });
    try {
      await watcher.ready;
      writeFileSync(join(dir, 'first.md'), '# first');
      const first = await collector.next();
      assert.equal(first.paths.length, 1);

      writeFileSync(join(dir, 'second.md'), '# second');
      const second = await collector.next();
      assert.equal(second.paths.length, 1);
      assert.match(second.paths[0]!, /second\.md$/);
    } finally {
      await watcher.close();
    }
  });

  it('respects the ignoreFilter, ignored paths never fire onBatch', async () => {
    const dir = freshScope('ignore');
    const ignoreFilter = buildIgnoreFilter({
      includeDefaults: false,
      configIgnore: ['*.tmp'],
    });
    const { collector, onBatch } = makeCollector();
    const watcher = createChokidarWatcher({
      cwd: root,
      roots: [dir],
      debounceMs: 60,
      ignoreFilter,
      onBatch,
    });
    try {
      await watcher.ready;
      writeFileSync(join(dir, 'kept.md'), 'x');
      writeFileSync(join(dir, 'noise.tmp'), 'x');
      writeFileSync(join(dir, 'also-kept.md'), 'x');
      const batch = await collector.next();
      const names = batch.paths.map((p) => p.split('/').pop()).sort();
      assert.deepEqual(names, ['also-kept.md', 'kept.md']);
      await delay(120);
      assert.equal(collector.batches.length, 0, 'noise.tmp never fires a batch');
    } finally {
      await watcher.close();
    }
  });

  it('with watchedExtensions, only those file types fire onBatch (dirs still traversed)', async () => {
    const dir = freshScope('ext-gate');
    // Pre-create the subdir so chokidar watches it from the initial walk;
    // the gate MUST let directories pass so it descends to the .md inside.
    mkdirSync(join(dir, 'sub'));
    const { collector, onBatch } = makeCollector();
    const watcher = createChokidarWatcher({
      cwd: root,
      roots: [dir],
      debounceMs: 60,
      watchedExtensions: ['.md', '.toml', '.sm'],
      onBatch,
    });
    try {
      await watcher.ready;
      writeFileSync(join(dir, 'note.md'), 'x');
      writeFileSync(join(dir, 'agent.toml'), 'x');
      writeFileSync(join(dir, 'side.sm'), 'x');
      writeFileSync(join(dir, 'sub', 'deep.md'), 'x');
      writeFileSync(join(dir, 'data.json'), 'x'); // gated out
      writeFileSync(join(dir, 'readme.txt'), 'x'); // gated out
      const batch = await collector.next();
      const names = batch.paths.map((p) => p.split('/').pop()).sort();
      assert.deepEqual(names, ['agent.toml', 'deep.md', 'note.md', 'side.sm']);
      await delay(120);
      assert.equal(collector.batches.length, 0, 'non-watched extensions never fire');
    } finally {
      await watcher.close();
    }
  });

  it('the extension gate composes with the ignore filter', async () => {
    const dir = freshScope('ext-gate-ignore');
    mkdirSync(join(dir, 'private'));
    const { collector, onBatch } = makeCollector();
    const watcher = createChokidarWatcher({
      cwd: root,
      roots: [dir],
      debounceMs: 60,
      watchedExtensions: ['.md'],
      ignoreFilter: buildIgnoreFilter({ includeDefaults: false, configIgnore: ['private/'] }),
      onBatch,
    });
    try {
      await watcher.ready;
      writeFileSync(join(dir, 'kept.md'), 'x');
      writeFileSync(join(dir, 'private', 'secret.md'), 'x'); // ignore-filtered
      writeFileSync(join(dir, 'note.json'), 'x'); // extension-gated
      const batch = await collector.next();
      const names = batch.paths.map((p) => p.split('/').pop()).sort();
      assert.deepEqual(names, ['kept.md']);
      await delay(120);
      assert.equal(collector.batches.length, 0);
    } finally {
      await watcher.close();
    }
  });

  it('respects a getter ignoreFilter, swapping the filter at runtime updates ignored paths', async () => {
    // Pin for the BFF live-rebuild flow: the meta-file watcher in
    // `src/server/watcher.ts` swaps the ignore filter when the user
    // edits `.skillmapignore`, and chokidar's `ignored` predicate must
    // pick up the new filter on the very next event without tearing the
    // watcher down. Static `IIgnoreFilter` captures by reference at
    // construction; the getter form re-evaluates per call.
    const dir = freshScope('ignore-getter');
    let activeFilter = buildIgnoreFilter({
      includeDefaults: false,
      configIgnore: [],
    });
    const { collector, onBatch } = makeCollector();
    const watcher = createChokidarWatcher({
      cwd: root,
      roots: [dir],
      debounceMs: 60,
      ignoreFilter: (): ReturnType<typeof buildIgnoreFilter> => activeFilter,
      onBatch,
    });
    try {
      await watcher.ready;

      // 1. Initial filter excludes nothing → a.md fires a batch.
      writeFileSync(join(dir, 'a.md'), 'x');
      const first = await collector.next();
      assert.deepEqual(
        first.paths.map((p) => p.split('/').pop()).sort(),
        ['a.md'],
      );

      // 2. Swap the active filter to exclude *.tmp at runtime.
      activeFilter = buildIgnoreFilter({
        includeDefaults: false,
        configIgnore: ['*.tmp'],
      });

      // 3. After the swap, *.tmp must not fire while *.md still does.
      writeFileSync(join(dir, 'noise.tmp'), 'x');
      writeFileSync(join(dir, 'b.md'), 'x');
      const second = await collector.next();
      assert.deepEqual(
        second.paths.map((p) => p.split('/').pop()).sort(),
        ['b.md'],
      );
      await delay(120);
      assert.equal(
        collector.batches.length,
        0,
        'noise.tmp filtered by the swapped getter result',
      );
    } finally {
      await watcher.close();
    }
  });

  it('treats a getter that returns undefined as no filter (everything fires)', async () => {
    const dir = freshScope('ignore-getter-undefined');
    const { collector, onBatch } = makeCollector();
    const watcher = createChokidarWatcher({
      cwd: root,
      roots: [dir],
      debounceMs: 60,
      ignoreFilter: () => undefined,
      onBatch,
    });
    try {
      await watcher.ready;
      writeFileSync(join(dir, 'a.tmp'), 'x');
      writeFileSync(join(dir, 'b.md'), 'x');
      const batch = await collector.next();
      assert.deepEqual(
        batch.paths.map((p) => p.split('/').pop()).sort(),
        ['a.tmp', 'b.md'],
      );
    } finally {
      await watcher.close();
    }
  });

  it('deduplicates repeated events on the same path within one batch', async () => {
    const dir = freshScope('dedupe');
    const { collector, onBatch } = makeCollector();
    const watcher = createChokidarWatcher({
      cwd: root,
      roots: [dir],
      debounceMs: 80,
      onBatch,
    });
    try {
      await watcher.ready;
      const file = join(dir, 'churn.md');
      writeFileSync(file, '1');
      writeFileSync(file, '2');
      writeFileSync(file, '3');
      const batch = await collector.next();
      assert.equal(batch.paths.length, 1, 'only one unique path');
      assert.ok(batch.events.length >= 1, 'at least one event recorded');
      assert.match(batch.paths[0]!, /churn\.md$/);
    } finally {
      await watcher.close();
    }
  });

  it('captures unlink events for files added after the watcher was ready', async () => {
    const dir = freshScope('unlink');
    const { collector, onBatch } = makeCollector();
    const watcher = createChokidarWatcher({
      cwd: root,
      roots: [dir],
      debounceMs: 60,
      onBatch,
    });
    try {
      await watcher.ready;
      // Create the file post-ready so chokidar definitively tracks it
      // before we delete it. (Pre-ready files plus `ignoreInitial:
      // true` is platform-flaky on inotify, the file is registered
      // but native unlink events may race the watch handle install.)
      writeFileSync(join(dir, 'transient.md'), 'seed');
      const addBatch = await collector.next();
      assert.equal(addBatch.events.length, 1);
      assert.equal(addBatch.events[0]!.kind, 'add');

      unlinkSync(join(dir, 'transient.md'));
      const unlinkBatch = await collector.next();
      const kinds = unlinkBatch.events.map((e) => e.kind);
      assert.ok(kinds.includes('unlink'), `expected unlink, got ${kinds.join(',')}`);
    } finally {
      await watcher.close();
    }
  });

  it('close() drops pending events without firing onBatch', async () => {
    const dir = freshScope('close-pending');
    const { collector, onBatch } = makeCollector();
    const watcher = createChokidarWatcher({
      cwd: root,
      roots: [dir],
      debounceMs: 200,
      onBatch,
    });
    await watcher.ready;
    writeFileSync(join(dir, 'late.md'), '# late');
    // Close before the debounce window expires.
    await watcher.close();
    await delay(300);
    assert.equal(collector.batches.length, 0, 'no batch after close');
  });

  it('debounceMs: 0 fires onBatch on every tick', async () => {
    const dir = freshScope('zero-debounce');
    const { collector, onBatch } = makeCollector();
    const watcher = createChokidarWatcher({
      cwd: root,
      roots: [dir],
      debounceMs: 0,
      onBatch,
    });
    try {
      await watcher.ready;
      writeFileSync(join(dir, 'a.md'), 'a');
      const first = await collector.next();
      assert.equal(first.paths.length, 1);
      // Give the loop a moment, then write again.
      await delay(20);
      writeFileSync(join(dir, 'b.md'), 'b');
      const second = await collector.next();
      assert.equal(second.paths.length, 1);
      assert.notEqual(first.paths[0], second.paths[0], 'two separate batches');
    } finally {
      await watcher.close();
    }
  });
});
