/**
 * End-to-end: `scan.followSymlinks` routes the primary watcher to chokidar
 * and live edits behind a symlinked directory are picked up.
 *
 * The chain under test: settings `scan.followSymlinks: true` →
 * `resolveWatcherBackend` returns `chokidar` (parcel would not observe a
 * symlinked dir) → the runtime boots chokidar → a file CREATED behind the
 * in-root symlink `.claude/skills -> ../a/skills` surfaces live as a node
 * UNDER THE LINK PATH (`.claude/skills/...`). That link-path node is the
 * isolation: parcel would only ever surface the real `a/skills/...` path,
 * never the link path, so seeing `.claude/skills/new.md` appear after a
 * live create proves chokidar was selected and followed the link.
 *
 * Real temp-dir cwd + file-based SQLite (not `:memory:`, per
 * `feedback_sqlite_in_memory_workaround.md`). `subscribeBeforeInitial: true`
 * so the post-start create fires a follow-up batch. The watcher is torn
 * down via `stop()` in `finally`.
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { InMemoryProgressEmitter } from '../../../kernel/adapters/in-memory-progress.js';
import type { ScanResult } from '../../../kernel/types.js';
import type { IWatcherEvents } from '../runtime.js';
import { createWatcherRuntime } from '../runtime.js';

let tmpRoot: string;
let counter = 0;

function freshCwd(label: string): string {
  counter += 1;
  const dir = join(tmpRoot, `${label}-${counter}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-watcher-symlink-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('createWatcherRuntime, followSymlinks live updates', () => {
  it('indexes content behind an in-root symlinked dir and picks up live creates', async () => {
    const cwd = freshCwd('sym-live');
    // Real skills target inside the root, exposed via an in-root symlink.
    mkdirSync(join(cwd, 'a', 'skills'), { recursive: true });
    writeFileSync(join(cwd, 'a', 'skills', 's.md'), '---\nname: s\n---\nbody\n');
    mkdirSync(join(cwd, '.claude'), { recursive: true });
    let linked = true;
    try {
      symlinkSync('../a/skills', join(cwd, '.claude', 'skills'), 'dir');
    } catch {
      linked = false;
    }
    if (!linked) return; // sandbox without symlink support

    // Opt into following symlinks; backend stays `auto` (→ chokidar here).
    mkdirSync(join(cwd, '.skill-map'), { recursive: true });
    writeFileSync(
      join(cwd, '.skill-map', 'settings.json'),
      JSON.stringify({ schemaVersion: 1, scan: { followSymlinks: true } }),
    );
    const dbPath = join(cwd, '.skill-map', 'graph.db');

    const results: ScanResult[] = [];
    const waiters: Array<(r: ScanResult) => void> = [];
    const events: IWatcherEvents = {
      onBatch: (outcome) => {
        if (outcome.kind !== 'ok') return;
        const w = waiters.shift();
        if (w) w(outcome.result);
        else results.push(outcome.result);
      },
    };
    const nextResult = (): Promise<ScanResult> => {
      const r = results.shift();
      if (r !== undefined) return Promise.resolve(r);
      return new Promise((res) => waiters.push(res));
    };
    // Drain batches until one carries a node at `path`, or time out (so a
    // regression where the symlinked edit is never observed fails fast
    // instead of hanging).
    const waitForNode = async (path: string): Promise<ScanResult> => {
      for (let i = 0; i < 40; i += 1) {
        const r = await Promise.race([
          nextResult(),
          delay(4000).then(() => null),
        ]);
        if (r === null) throw new Error(`timed out waiting for node ${path}`);
        if (r.nodes.some((n) => n.path === path)) return r;
      }
      throw new Error(`node ${path} never appeared`);
    };

    const runtime = createWatcherRuntime({
      dbPath,
      // Absolute root: the orchestrator resolves a relative root against
      // `process.cwd()` (the project for real runs, but the repo under the
      // test runner), so point straight at the temp fixture.
      roots: [cwd],
      runtimeContext: { cwd },
      noBuiltIns: false,
      noPlugins: true,
      emitterFactory: () => new InMemoryProgressEmitter(),
      runInitialBatch: true,
      subscribeBeforeInitial: true,
      debounceMsOverride: 50,
      events,
    });

    try {
      await runtime.start();

      // Initial scan followed the symlink: the link-path node is present.
      const initial = await waitForNode('.claude/skills/s.md');
      assert.ok(
        initial.nodes.some((n) => n.path === '.claude/skills/s.md'),
        'initial scan indexed the file behind the symlinked dir',
      );

      // Live create behind the symlink → surfaces under the link path,
      // which only happens if chokidar (selected by followSymlinks) is
      // observing the symlinked subtree.
      writeFileSync(join(cwd, 'a', 'skills', 'new.md'), '---\nname: new\n---\nfresh\n');
      const after = await waitForNode('.claude/skills/new.md');
      assert.ok(
        after.nodes.some((n) => n.path === '.claude/skills/new.md'),
        'a live create behind the symlinked dir is indexed under the link path',
      );
    } finally {
      await runtime.stop();
    }
  });
});
