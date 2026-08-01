/**
 * Containment guards for filesystem paths the CLI dereferences from
 * persisted state (typically `node.path` rows from a SQLite snapshot).
 *
 * Pure path primitive, lives under `core/paths/` so both the CLI
 * (`src/cli/`) and the BFF (`src/server/`) can consume it without
 * crossing the CLI boundary. Pattern matches `db-path.ts`: pure
 * helpers move here, CLI-only siblings (those taking stderr / an
 * `ExitCode`) stay under `cli/util/`. This file has no CLI-only
 * sibling, every caller wraps the throw into its own error surface.
 *
 * The threat model: a manually-tampered `.skill-map/skill-map.db` (or a
 * future plugin migration that writes raw rows) could land an absolute
 * path or a `../../`-laden relative path into `scan_nodes.path`. Verbs
 * that resolve the path against `cwd` and read the result (`sm enrich`,
 * future enrichment / export verbs) would then read files anywhere on
 * the disk.
 *
 * `assertContained` rejects both shapes before the read happens. It is
 * deliberately strict: relative paths only, no segment may escape the
 * supplied root after `resolve` collapses `..` segments. Internal
 * messages are English crude, they bubble up as `throw new Error(...)`,
 * not `tx(...)`, because they signal a tampered DB rather than a user
 * input problem.
 */

import { lstatSync } from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';

/**
 * Throw when `rel` does not stay inside `cwd` after path resolution.
 * The caller is expected to wrap the throw into a verb-specific error
 * surface; the helper deliberately does not return a discriminated
 * union because the failure mode (tampered DB) is exceptional, not
 * routine.
 *
 * Symlink defense (audit M1): after the string-level containment check
 * passes, an `lstat` rejects any path whose leaf is a symlink. The
 * walker (`walk-content.ts`) deliberately skips symlinks during
 * indexing, so a row whose leaf is a symlink today means either an
 * attacker swapped a regular file for a symlink after the scan
 * recorded it (the classic TOCTOU-against-the-index scenario) or a
 * future Provider / plugin persisted a row the walker would have
 * rejected. Either way, dereferencing the path through `readFile` /
 * `writeFile` would follow the link to its target and leak / clobber
 * whatever the link points at. ENOENT / ENOTDIR are silently allowed:
 * a missing leaf is the caller's problem (they will surface their own
 * 404 / "not found" error), not a containment violation. The check
 * only covers the leaf, intermediate-directory symlinks would need
 * `O_NOFOLLOW` at the open site to be fully closed; the BFF's
 * `readNodeBody` does that already.
 */
export function assertContained(cwd: string, rel: string): void {
  if (isAbsolute(rel)) {
    throw new Error(`node path is absolute, refusing to read: ${rel}`);
  }
  // Normalise the root before comparing: every current caller passes an
  // already-resolved cwd, but a trailing separator or a relative value
  // would make the `startsWith(root + sep)` test misbehave (accept an
  // escape, or reject a contained path). Resolving here keeps the guard
  // correct regardless of what a future caller hands it.
  const root = resolve(cwd);
  const abs = resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error(`node path escapes repo root: ${rel}`);
  }
  let isSymlink: boolean;
  try {
    isSymlink = lstatSync(abs).isSymbolicLink();
  } catch (err) {
    if (isAllowedLstatError(err)) return;
    throw err;
  }
  if (isSymlink) {
    throw new Error(`node path is a symlink, refusing to dereference: ${rel}`);
  }
}

const ALLOWED_LSTAT_ERROR_CODES = new Set(['ENOENT', 'ENOTDIR']);

function isAllowedLstatError(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && ALLOWED_LSTAT_ERROR_CODES.has(code);
}
