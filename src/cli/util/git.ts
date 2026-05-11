/**
 * Thin wrappers around the `git` binary used by `sm bump --staged`.
 *
 * The three helpers used to live inline in `cli/commands/bump.ts`. They
 * are the only place in the CLI that shells out to git, so isolating
 * them in their own module: (a) keeps `bump.ts` focused on the verb
 * flow, (b) makes the side-effect surface easy to find when a new
 * caller appears (`sm changelog`, future `sm publish`), (c) lets the
 * helpers be tested in isolation by stubbing `spawnSync` if needed.
 *
 * Every helper is synchronous (`spawnSync`) because the verb runs in a
 * single-pass loop and the git operations are short-lived (`--version`
 * probe, single-file `add`). Switching to async would force the loop
 * into a Promise chain without buying anything.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { formatErrorMessage } from '../../kernel/util/format-error.js';

/**
 * Walk up from `cwd` looking for a `.git/` entry (file or directory —
 * worktrees use a `.git` file). Returns true on first hit, false when
 * the walk reaches the filesystem root.
 *
 * Pure FS walk, no spawn. Safe to call without git installed.
 */
export function isInsideGitRepo(cwd: string): boolean {
  let current = cwd;
  // Bound the walk by the root: `dirname('/')` returns `'/'` so the
  // loop terminates without hitting an infinite check.
  while (true) {
    if (existsSync(resolve(current, '.git'))) return true;
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

/**
 * Combined preflight for `--staged`. Returns `'ok'` when both checks
 * pass, `'no-repo'` when no `.git/` parent is found, `'no-binary'`
 * when the `git` binary is not on PATH (spawn ENOENT).
 *
 * Spawns `git --version` (cheapest probe). All non-ENOENT spawn errors
 * are mapped to `'no-binary'` because the caller's user-facing
 * recovery is the same ("install git").
 */
export function ensureGitForStaged(cwd: string): 'ok' | 'no-repo' | 'no-binary' {
  if (!isInsideGitRepo(cwd)) return 'no-repo';
  const probe = spawnSync('git', ['--version'], { stdio: 'ignore' });
  if (probe.error !== undefined) {
    const code = (probe.error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return 'no-binary';
    // Other spawn errors are unexpected — treat as no-binary so the
    // caller surfaces the missing-binary message; the underlying
    // error stays in `probe.error.message` for debugging.
    return 'no-binary';
  }
  return 'ok';
}

/**
 * `git add <abs sidecar path>`. Returns `null` on success or the
 * stderr message on failure. Failures degrade to a warning at the
 * caller — the batch keeps running.
 */
export function stageSidecar(cwd: string, sidecarAbsPath: string): string | null {
  const result = spawnSync('git', ['add', '--', sidecarAbsPath], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  if (result.error !== undefined) return formatErrorMessage(result.error);
  if (result.status !== 0) {
    const stderr = (result.stderr ?? '').trim();
    return stderr.length > 0 ? stderr : `git add exited with code ${result.status}`;
  }
  return null;
}
