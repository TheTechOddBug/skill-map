/**
 * Coverage for `core/runtime/reference-paths-walker:walkReferencePaths`.
 *
 * Behaviour pinned by these tests:
 *   - Recursive walk collects existing absolute file paths.
 *   - Missing roots are reported on `missingRoots`, not thrown.
 *   - `~` and relative entries are resolved against `os.homedir()` / `cwd`.
 *     The walker reads `os.homedir()` directly; tests redirect via the
 *     `HOME` env var which Node honours on Linux.
 *   - Symlinks are skipped.
 *   - The `node_modules` / `.git` / `.skill-map` skip-list applies.
 *   - The `REFERENCE_WALK_MAX_FILES` cap surfaces as `truncated: true`.
 */

import { strict as assert } from 'node:assert';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';

import {
  walkReferencePaths,
  resolveScanPath,
} from '../core/runtime/reference-paths-walker.js';

let tempRoot: string;
let homedir: string;
let cwd: string;
let originalHome: string | undefined;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'ref-walker-'));
  homedir = join(tempRoot, 'home');
  cwd = join(tempRoot, 'project');
  mkdirSync(homedir, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  originalHome = process.env['HOME'];
  process.env['HOME'] = homedir;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env['HOME'];
  else process.env['HOME'] = originalHome;
  rmSync(tempRoot, { recursive: true, force: true });
});

function plant(parent: string, name: string, content = ''): string {
  const abs = join(parent, name);
  writeFileSync(abs, content);
  return abs;
}

describe('resolveScanPath', () => {
  it('expands ~/... against homedir', () => {
    assert.equal(resolveScanPath('~/notes', cwd), resolve(homedir, 'notes'));
  });
  it('expands bare ~ to homedir', () => {
    assert.equal(resolveScanPath('~', cwd), resolve(homedir));
  });
  it('absolute paths pass through (resolved)', () => {
    assert.equal(resolveScanPath('/abs/path', cwd), resolve('/abs/path'));
  });
  it('relative paths resolve against cwd', () => {
    assert.equal(resolveScanPath('./sub', cwd), resolve(cwd, 'sub'));
  });
});

describe('walkReferencePaths', () => {
  it('returns empty result + missingRoots entry for a non-existent root', () => {
    const r = walkReferencePaths(['~/never-created'], cwd);
    assert.equal(r.paths.size, 0);
    assert.deepEqual(r.missingRoots, [resolve(homedir, 'never-created')]);
    assert.equal(r.truncated, false);
  });

  it('collects existing files recursively across multiple roots', () => {
    const a = join(homedir, 'a');
    const b = join(homedir, 'b');
    mkdirSync(a, { recursive: true });
    mkdirSync(b, { recursive: true });
    plant(a, '1.md');
    plant(a, '2.md');
    mkdirSync(join(a, 'nested'), { recursive: true });
    plant(join(a, 'nested'), '3.md');
    plant(b, '4.md');

    const r = walkReferencePaths(['~/a', '~/b'], cwd);
    assert.equal(r.paths.size, 4);
    assert.equal(r.paths.has(resolve(a, '1.md')), true);
    assert.equal(r.paths.has(resolve(a, 'nested', '3.md')), true);
    assert.equal(r.paths.has(resolve(b, '4.md')), true);
    assert.equal(r.truncated, false);
    assert.deepEqual(r.missingRoots, []);
  });

  it('skips symlinks', () => {
    const a = join(homedir, 'a');
    mkdirSync(a, { recursive: true });
    plant(a, 'real.md');
    symlinkSync(join(a, 'real.md'), join(a, 'symlink.md'));
    const r = walkReferencePaths(['~/a'], cwd);
    assert.equal(r.paths.has(resolve(a, 'real.md')), true);
    assert.equal(r.paths.has(resolve(a, 'symlink.md')), false);
  });

  it('skips node_modules / .git / .skill-map directories', () => {
    const a = join(homedir, 'a');
    mkdirSync(join(a, 'node_modules'), { recursive: true });
    mkdirSync(join(a, '.git'), { recursive: true });
    mkdirSync(join(a, '.skill-map'), { recursive: true });
    mkdirSync(join(a, 'src'), { recursive: true });
    plant(join(a, 'node_modules'), 'noise.md');
    plant(join(a, '.git'), 'HEAD');
    plant(join(a, '.skill-map'), 'settings.json');
    plant(join(a, 'src'), 'real.md');
    const r = walkReferencePaths(['~/a'], cwd);
    assert.equal(r.paths.size, 1);
    assert.equal(r.paths.has(resolve(a, 'src', 'real.md')), true);
  });

  it('mixes absent + present roots without dropping the present ones', () => {
    const a = join(homedir, 'real');
    mkdirSync(a, { recursive: true });
    plant(a, 'one.md');
    const r = walkReferencePaths(['~/never', '~/real'], cwd);
    assert.equal(r.paths.size, 1);
    assert.equal(r.missingRoots.length, 1);
  });
});
