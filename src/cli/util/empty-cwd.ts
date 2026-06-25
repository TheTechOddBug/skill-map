/**
 * Shared helpers for verbs that scaffold a self-contained scenario into
 * an empty cwd (`sm tutorial`, `sm example`): the empty-directory guard
 * plus the human-facing cwd / entry-list rendering their success and
 * refusal messages interpolate. Extracted so both verbs share one
 * implementation (a future scaffold verb reuses it too).
 */

import { readdirSync } from 'node:fs';

/** True when `dir` has no entries at all (including dotfiles). */
export function isDirEmpty(dir: string): boolean {
  return readdirSync(dir).length === 0;
}

/**
 * Render the cwd's entries for a `notEmpty` error: the first few names,
 * sorted, with a trailing `, ...` when there are more. Keeps the
 * message to a single line even in a busy directory.
 */
export function listCwdEntries(dir: string): string {
  const entries = readdirSync(dir).sort();
  const shown = entries.slice(0, 5);
  const more = entries.length > shown.length ? ', ...' : '';
  return shown.join(', ') + more;
}

/**
 * Render the cwd as `./<basename>/` so the user sees orienting info
 * without an absolute path eating the line. Falls back to `./` when
 * the cwd is the filesystem root (`/`), defensive, never observed.
 */
export function displayCwd(cwd: string): string {
  const segments = cwd.split('/').filter((s) => s.length > 0);
  if (segments.length === 0) return './';
  return `./${segments[segments.length - 1]}/`;
}
