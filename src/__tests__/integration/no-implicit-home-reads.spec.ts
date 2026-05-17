/**
 * Defensive regression test: skill-map MUST NOT touch `$HOME` by
 * default. The principle is normative in `spec/cli-contract.md`
 * §Scope is always project-local; this test guards it from accidental
 * regressions by spawning the real CLI binary with `HOME` redirected
 * to a tmpdir and asserting nothing lands there.
 *
 * Why: every other test in the suite exercises a specific code path.
 * A future refactor that adds an implicit `os.homedir()` read in some
 * unrelated module (a new analyzer, a new BFF route, a kernel
 * shortcut) would slip through those tests because none of them owns
 * the "and no other module reads home either" invariant. This file
 * owns that invariant.
 *
 * Strategy:
 *   - `SM_NO_UPDATE_CHECK=1` disables the one legitimate home writer
 *     (`src/cli/util/user-settings-store.ts`, see AGENTS.md
 *     §Analyzers / no-home-reads). With the gate closed, no module
 *     in the codebase should write to `$HOME` at all.
 *   - The verb sweep covers the canonical hot paths: `init`, `scan`,
 *     `list`, `version`, `graph`, `show`, `check`. Long-running verbs
 *     (`serve`, `watch`) and verbs that explicitly opt into home
 *     reads (`scan.referencePaths` with `~/...`) are out of scope.
 *   - The sanity-check at the end re-enables `SM_NO_UPDATE_CHECK` and
 *     asserts that IF anything was written, it lands ONLY under
 *     `~/.skill-map/settings.json` (the documented exception). Catches
 *     the inverse regression where the exception path stops working.
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(HERE, '..', '..', 'bin', 'sm.js');

let root: string;
let counter = 0;

interface IScope {
  cwd: string;
  home: string;
}

function freshScope(label: string): IScope {
  counter += 1;
  const dir = join(root, `${label}-${counter}`);
  const cwd = join(dir, 'cwd');
  const home = join(dir, 'home');
  mkdirSync(cwd, { recursive: true });
  mkdirSync(home, { recursive: true });
  return { cwd, home };
}

function sm(
  args: string[],
  scope: IScope,
  extraEnv: Record<string, string> = {},
): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: scope.cwd,
    env: {
      ...process.env,
      HOME: scope.home,
      USERPROFILE: scope.home,
      NO_COLOR: '1',
      SM_NO_UPDATE_CHECK: '1',
      ...extraEnv,
    },
  });
  return {
    status: r.status ?? 0,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  };
}

/**
 * Walk the home tmpdir and return the relative path of every file or
 * directory found. Empty array means HOME was untouched.
 */
function homeContents(home: string): string[] {
  const result: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      result.push(rel);
      if (entry.isDirectory()) walk(join(dir, entry.name), rel);
    }
  };
  walk(home, '');
  return result.sort();
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'sm-no-implicit-home-reads-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('Default verb paths must not touch $HOME', () => {
  it('sm init leaves HOME empty', () => {
    const scope = freshScope('init');
    const r = sm(['init', '--no-scan'], scope);
    assert.equal(r.status, 0, `sm init failed: ${r.stderr}`);
    assert.deepEqual(homeContents(scope.home), [], 'HOME must stay empty');
  });

  it('sm scan leaves HOME empty', () => {
    const scope = freshScope('scan');
    sm(['init', '--no-scan'], scope);
    const r = sm(['scan'], scope);
    assert.equal(r.status, 0, `sm scan failed: ${r.stderr}`);
    assert.deepEqual(homeContents(scope.home), [], 'HOME must stay empty');
  });

  it('sm list leaves HOME empty', () => {
    const scope = freshScope('list');
    sm(['init', '--no-scan'], scope);
    const r = sm(['list'], scope);
    assert.equal(r.status, 0, `sm list failed: ${r.stderr}`);
    assert.deepEqual(homeContents(scope.home), [], 'HOME must stay empty');
  });

  it('sm version leaves HOME empty', () => {
    const scope = freshScope('version');
    const r = sm(['version'], scope);
    assert.equal(r.status, 0, `sm version failed: ${r.stderr}`);
    assert.deepEqual(homeContents(scope.home), [], 'HOME must stay empty');
  });

  it('sm graph leaves HOME empty (on a fresh-init empty project)', () => {
    const scope = freshScope('graph');
    sm(['init', '--no-scan'], scope);
    const r = sm(['graph'], scope);
    // graph MAY exit non-zero on an empty graph; the contract this test
    // owns is "no home leaks", not "graph succeeds on empty input".
    assert.deepEqual(homeContents(scope.home), [], 'HOME must stay empty');
    void r;
  });

  it('sm show on a non-existent node leaves HOME empty', () => {
    const scope = freshScope('show');
    sm(['init', '--no-scan'], scope);
    // Plant a markdown file the scan can pick up, so `show` has
    // something to query.
    writeFileSync(join(scope.cwd, 'note.md'), '# note\n');
    sm(['scan'], scope);
    const r = sm(['show', 'note.md'], scope);
    assert.deepEqual(homeContents(scope.home), [], 'HOME must stay empty');
    void r;
  });

  it('sm check leaves HOME empty', () => {
    const scope = freshScope('check');
    sm(['init', '--no-scan'], scope);
    const r = sm(['check'], scope);
    assert.deepEqual(homeContents(scope.home), [], 'HOME must stay empty');
    void r;
  });

  it('sm plugins list (default) leaves HOME empty (no user-scope plugin discovery)', () => {
    const scope = freshScope('plugins-list');
    sm(['init', '--no-scan'], scope);
    const r = sm(['plugins', 'list'], scope);
    assert.equal(r.status, 0, `sm plugins list failed: ${r.stderr}`);
    assert.deepEqual(homeContents(scope.home), [], 'HOME must stay empty');
  });

  it('sm config list leaves HOME empty (no user-scope config merge)', () => {
    const scope = freshScope('config-list');
    sm(['init', '--no-scan'], scope);
    const r = sm(['config', 'list'], scope);
    assert.equal(r.status, 0, `sm config list failed: ${r.stderr}`);
    assert.deepEqual(homeContents(scope.home), [], 'HOME must stay empty');
  });
});

describe('Documented HOME exception: settings.json write path', () => {
  it('when SM_NO_UPDATE_CHECK is NOT set, the ONLY allowed write is `~/.skill-map/settings.json`', () => {
    const scope = freshScope('settings-allowed');
    // Re-enable update-check explicitly.
    const r = sm(['init', '--no-scan'], scope, { SM_NO_UPDATE_CHECK: '0' });
    assert.equal(r.status, 0, `sm init failed: ${r.stderr}`);
    // The update-check is throttled (once-per-day), so the file MAY or
    // MAY NOT exist after one invocation. The invariant is: if anything
    // is in HOME, it must be exactly `.skill-map/settings.json`, no
    // other paths.
    const contents = homeContents(scope.home);
    if (contents.length === 0) {
      // Acceptable: probe skipped (e.g. network gate, stderr not a TTY).
      return;
    }
    const allowed = new Set(['.skill-map', '.skill-map/settings.json']);
    for (const path of contents) {
      assert.ok(
        allowed.has(path),
        `unexpected path under HOME: ${path} (allowed: only .skill-map/settings.json)`,
      );
    }
  });
});
