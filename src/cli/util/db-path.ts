/**
 * CLI-only DB path helpers (`assertDbExists`, `requireDbOrExit`) and a
 * re-export bridge for the pure path primitives that moved to
 * `core/paths/db-path.ts` so the BFF can consume them without crossing
 * the CLI boundary.
 *
 * The two helpers below stay in CLI-land because they take a stderr
 * stream and an `ExitCode`, both CLI-only concerns. Every other helper
 * (resolveDbPath, defaultProjectDbPath, …) is a pure function and
 * lives under `core/paths/db-path.ts`.
 *
 * The only flag semantics relevant here is `--db <path>` (escape
 * hatch), which lives on `cli/util/sm-command.ts`, the file that
 * actually declares the Clipanion options. Scope is always
 * project-local (no `-g/--global`); see
 * `spec/cli-contract.md` §Scope is always project-local.
 */

import { existsSync } from 'node:fs';

import { tx } from '../../kernel/util/tx.js';
import { UTIL_TEXTS } from '../i18n/util.texts.js';
import { ansiFor } from './ansi.js';
import { ExitCode, type TExitCode } from './exit-codes.js';

export {
  ACTIVITY_BRIDGE_REL,
  backupsDirForDb,
  BACKUPS_DIRNAME,
  defaultActivityBridgePath,
  defaultDbPath,
  defaultIgnoreFilePath,
  defaultLocalSettingsPath,
  defaultProjectActivityDir,
  defaultProjectDbPath,
  defaultProjectJobsDir,
  defaultProjectPluginsDir,
  defaultScopeGitignorePath,
  defaultServeInfoPath,
  defaultSettingsPath,
  resolveDbPath,
  SCOPE_GITIGNORE_ENTRIES,
  SERVE_INFO_FILENAME,
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
  // No noColor flag is reachable from this helper, so color resolution
  // falls back to env / TTY only. Tests pin NO_COLOR=1 in spawnSync
  // shells; production runs see a coloured glyph when stderr is a TTY.
  const stderrTty = stderr as NodeJS.WritableStream & { isTTY?: boolean };
  const ansi = ansiFor({ isTTY: stderrTty.isTTY === true, noColorFlag: false });
  stderr.write(
    tx(UTIL_TEXTS.dbNotFound, {
      glyph: ansi.red('✕'),
      path,
      hint: ansi.dim(UTIL_TEXTS.dbNotFoundHint),
    }),
  );
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
