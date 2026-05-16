/**
 * Coverage for `core/config/service`, the cached layered-config
 * view the BFF mounts at boot so per-request reads don't walk every
 * settings.json + revalidate via AJV.
 *
 * Behaviour pinned by these tests:
 *   - `get()` walks `loadConfig` lazily on the first call.
 *   - Subsequent `get()` calls return the SAME object reference (cache
 *     hit) and do NOT re-read on-disk mutations.
 *   - `reload()` drops the cache so the next `get()` re-reads.
 *   - `effective()` is sugar for `get().effective`.
 */

import { strict as assert } from 'node:assert';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';

import { ConfigService } from '../service.js';

let tempRoot: string;
let cwd: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'sm-config-service-'));
  cwd = join(tempRoot, 'project');
  mkdirSync(join(cwd, '.skill-map'), { recursive: true });
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

function writeProject(content: Record<string, unknown>): void {
  writeFileSync(
    join(cwd, '.skill-map/settings.json'),
    JSON.stringify(content),
    'utf8',
  );
}

describe('ConfigService', () => {
  it('get() returns the same object reference on repeat calls (cache hit)', () => {
    const svc = new ConfigService({ cwd });
    const a = svc.get();
    const b = svc.get();
    assert.equal(a, b, 'cached references must be identical');
  });

  it('get() does NOT see a fresh on-disk mutation without reload()', () => {
    const svc = new ConfigService({ cwd });
    // First read, defaults.
    const first = svc.effective();
    assert.equal(first.tokenizer, 'cl100k_base');
    // Mutate disk.
    writeProject({ tokenizer: 'gpt-4' });
    // Second read, still cached → still defaults.
    const second = svc.effective();
    assert.equal(second.tokenizer, 'cl100k_base');
  });

  it('reload() drops the cache; next get() re-reads from disk', () => {
    const svc = new ConfigService({ cwd });
    svc.get(); // prime the cache
    writeProject({ tokenizer: 'o200k_base' });
    svc.reload();
    const after = svc.effective();
    assert.equal(after.tokenizer, 'o200k_base');
  });

  it('reload() before first get() is a no-op (lazy initialization)', () => {
    const svc = new ConfigService({ cwd });
    // Should not throw.
    svc.reload();
    writeProject({ tokenizer: 'p50k_base' });
    const loaded = svc.effective();
    assert.equal(loaded.tokenizer, 'p50k_base');
  });

  it('effective() exposes the same object as get().effective', () => {
    const svc = new ConfigService({ cwd });
    assert.equal(svc.effective(), svc.get().effective);
  });
});
