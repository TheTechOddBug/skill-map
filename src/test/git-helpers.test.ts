/**
 * Unit tests for `cli/util/git.ts`, the three git side-effect helpers
 * used by `sm bump --staged`. Each helper is tested against a real
 * tempdir: `isInsideGitRepo` is a pure FS walk; `ensureGitForStaged`
 * spawns `git --version`; `stageSidecar` runs `git add`.
 *
 * The no-binary branch of `ensureGitForStaged` is impossible to
 * trigger without mocking the PATH; it is covered by inspection in
 * the helper itself and via the integration test in
 * `bump-cli.test.ts` (which checks the `--staged --pending in a real
 * repo runs git add per bump` path). These tests focus on the
 * branches that ARE reachable with a stock test environment.
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { ensureGitForStaged, isInsideGitRepo, stageSidecar } from '../cli/util/git.js';

let scratch: string;

before(() => {
  scratch = mkdtempSync(join(tmpdir(), 'sm-git-helpers-'));
});

after(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('isInsideGitRepo()', () => {
  it('returns true when the cwd contains a `.git/` directory', () => {
    const root = mkdtempSync(join(scratch, 'has-git-'));
    mkdirSync(join(root, '.git'), { recursive: true });
    assert.equal(isInsideGitRepo(root), true);
  });

  it('returns true when a parent contains a `.git/` directory (worktree-style walk)', () => {
    const root = mkdtempSync(join(scratch, 'has-git-deep-'));
    mkdirSync(join(root, '.git'), { recursive: true });
    const deep = join(root, 'a', 'b', 'c');
    mkdirSync(deep, { recursive: true });
    assert.equal(isInsideGitRepo(deep), true);
  });

  it('returns true when `.git` is a file (git worktree convention)', () => {
    const root = mkdtempSync(join(scratch, 'worktree-'));
    writeFileSync(join(root, '.git'), 'gitdir: /elsewhere/.git/worktrees/foo\n');
    assert.equal(isInsideGitRepo(root), true);
  });

  it('returns false when no parent has a `.git/` entry', () => {
    // mkdtemp under the tempdir root, the tempdir itself is not a
    // git repo, so the walk reaches `/` and bails.
    const root = mkdtempSync(join(scratch, 'no-git-'));
    assert.equal(isInsideGitRepo(root), false);
  });
});

describe('ensureGitForStaged()', () => {
  it("returns 'no-repo' when no `.git/` parent is found", () => {
    const root = mkdtempSync(join(scratch, 'preflight-no-repo-'));
    assert.equal(ensureGitForStaged(root), 'no-repo');
  });

  it("returns 'ok' when a `.git/` parent exists AND the git binary is available", () => {
    const probe = spawnSync('git', ['--version'], { stdio: 'ignore' });
    if (probe.error !== undefined) {
      // Hosts without git on PATH cannot exercise the 'ok' branch.
      // Skip rather than fail, the no-binary branch documents the
      // alternative behaviour in the helper itself.
      return;
    }
    const root = mkdtempSync(join(scratch, 'preflight-ok-'));
    mkdirSync(join(root, '.git'), { recursive: true });
    assert.equal(ensureGitForStaged(root), 'ok');
  });
});

describe('stageSidecar()', () => {
  it('returns null on a successful `git add`', () => {
    const probe = spawnSync('git', ['--version'], { stdio: 'ignore' });
    if (probe.error !== undefined) return; // skip, see ensureGitForStaged note

    const repo = mkdtempSync(join(scratch, 'stage-ok-'));
    spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    spawnSync('git', ['config', 'user.email', 'sm@test'], { cwd: repo });
    spawnSync('git', ['config', 'user.name', 'sm'], { cwd: repo });
    const sidecar = join(repo, 'docs', 'example.sm');
    mkdirSync(join(repo, 'docs'), { recursive: true });
    writeFileSync(sidecar, 'annotations:\n  version: 1\n');

    const result = stageSidecar(repo, sidecar);
    assert.equal(result, null);

    // Confirm the file actually got staged.
    const status = spawnSync('git', ['status', '--porcelain'], {
      cwd: repo,
      encoding: 'utf8',
    });
    assert.match(status.stdout ?? '', /^A\s+docs\/example\.sm/m);
  });

  it('returns a stderr string when `git add` fails (file does not exist)', () => {
    const probe = spawnSync('git', ['--version'], { stdio: 'ignore' });
    if (probe.error !== undefined) return;

    const repo = mkdtempSync(join(scratch, 'stage-fail-'));
    spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    spawnSync('git', ['config', 'user.email', 'sm@test'], { cwd: repo });
    spawnSync('git', ['config', 'user.name', 'sm'], { cwd: repo });
    const missing = join(repo, 'never-existed.sm');

    const result = stageSidecar(repo, missing);
    assert.ok(result !== null, 'expected a stderr string, got null');
    assert.match(result!, /did not match any files|pathspec/i);
  });
});
