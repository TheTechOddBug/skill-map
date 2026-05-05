/**
 * CLI-only DB path helpers (`assertDbExists`, `requireDbOrExit`) and a
 * re-export bridge for the pure path primitives that moved to
 * `core/paths/db-path.ts` so the BFF can consume them without crossing
 * the CLI boundary.
 *
 * The two helpers below stay in CLI-land because they take a stderr
 * stream and an `ExitCode` — both CLI-only concerns. Every other helper
 * (resolveDbPath, defaultProjectDbPath, …) is a pure function and
 * lives under `core/paths/db-path.ts`.
 *
 * Global-flag semantics (`-g/--global`, `--db <path>`) live on
 * `cli/util/sm-command.ts` — the file that actually declares the
 * Clipanion options. This module just consumes the resolved values.
 */

import { existsSync } from 'node:fs';

import { tx } from '../../kernel/util/tx.js';
import { UTIL_TEXTS } from '../i18n/util.texts.js';
import { ExitCode, type TExitCode } from './exit-codes.js';

export {
  defaultDbPath,
  defaultIgnoreFilePath,
  defaultLocalSettingsPath,
  defaultProjectDbPath,
  defaultProjectJobsDir,
  defaultProjectPluginsDir,
  defaultSettingsPath,
  defaultUserPluginsDir,
  GITIGNORE_ENTRIES,
  resolveDbPath,
  SKILL_MAP_DIR,
  type IDbLocationOptions,
} from '../../core/paths/db-path.js';

/**
 * Read-side guard: returns true if the DB file exists (or is `:memory:`),
 * otherwise writes a clear hint to stderr and returns false. Callers
 * should propagate exit code 5 (not-found) on a false return per
 * `spec/cli-contract.md` §Exit codes.
 */
export function assertDbExists(path: string, stderr: NodeJS.WritableStream): boolean {
  if (path === ':memory:' || existsSync(path)) return true;
  stderr.write(tx(UTIL_TEXTS.dbNotFound, { path }));
  return false;
}

/**
 * Sugar over `assertDbExists` that returns the exit code directly.
 *
 *   const exit = requireDbOrExit(path, this.context.stderr);
 *   if (exit !== null) return exit;
 *
 * supersedes the 14 hand-rolled
 *
 *   if (!assertDbExists(path, this.context.stderr)) return ExitCode.NotFound;
 *
 * branches that drift across verbs (one site logs an extra hint, one
 * site forgets to honour `:memory:`). Returns `null` when the DB is
 * available so the caller proceeds; otherwise the spec-pinned
 * `ExitCode.NotFound` after the helper has already written the
 * not-found hint to stderr.
 */
export function requireDbOrExit(
  path: string,
  stderr: NodeJS.WritableStream,
): TExitCode | null {
  if (assertDbExists(path, stderr)) return null;
  return ExitCode.NotFound;
}
