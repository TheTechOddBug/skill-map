/**
 * Validate that a `sm db restore <source>` candidate is a SQLite database
 * the running CLI can safely swap into place.
 *
 * `spec/cli-contract.md` § Database states that `sm db restore --dry-run`
 * "validates the source file (existence, header, schema version) and
 * reports what would be overwritten". The existence leg lives in the
 * verb; this module owns the other two:
 *
 *   - Header: a non-empty file MUST start with the 16-byte SQLite magic
 *     string, otherwise restoring it would swap a non-DB (a text file, a
 *     truncated copy) into place and only fail later on the next open. A
 *     zero-length file is a valid empty SQLite database, so it passes.
 *   - Schema version: when the source carries scan metadata, the version
 *     that wrote it is classified with the SAME rules `sm scan` / `sm
 *     serve` apply on open (`classifyVersionSkew`). A backup written by a
 *     NEWER minor or a DIFFERENT major is refused, restoring it would
 *     leave a DB this CLI cannot read forward. A source with no scan
 *     metadata (fresh / never-scanned) has no signal and passes.
 *
 * Read-only throughout: opens nothing for write, runs no migrations,
 * leaves no WAL sidecars. Pure enough to call from both the dry-run
 * preview and the live swap so the two paths never diverge.
 */

import { open } from 'node:fs/promises';

import { classifyVersionSkew, readScannedByVersion } from './db-version-check.js';

/**
 * The first 15 bytes of every SQLite database header: the ASCII text
 * "SQLite format 3". The full 16-byte magic adds a trailing NUL (byte
 * 15), checked separately so this source carries no embedded NUL.
 */
const SQLITE_MAGIC_PREFIX = 'SQLite format 3';

export type TRestoreValidation =
  | { ok: true }
  | { ok: false; reason: 'not-sqlite' }
  | {
      ok: false;
      reason: 'version-newer' | 'version-major';
      dbVersion: string;
      currentVersion: string;
    };

/**
 * Validate `sourcePath` as a restorable DB for a CLI at `currentVersion`.
 * The caller has already confirmed the file exists. Returns `{ ok: true }`
 * for a valid, compatible (or signal-less) source, or a discriminated
 * failure the verb renders + maps to a non-zero exit.
 */
export async function validateRestorableDb(
  sourcePath: string,
  currentVersion: string,
): Promise<TRestoreValidation> {
  if (!(await hasSqliteHeader(sourcePath))) {
    return { ok: false, reason: 'not-sqlite' };
  }

  const dbVersion = readScannedByVersion(sourcePath);
  if (dbVersion === null) return { ok: true };

  const outcome = classifyVersionSkew(dbVersion, currentVersion);
  if (outcome.kind === 'error-newer') {
    return { ok: false, reason: 'version-newer', dbVersion, currentVersion };
  }
  if (outcome.kind === 'error-major') {
    return { ok: false, reason: 'version-major', dbVersion, currentVersion };
  }
  return { ok: true };
}

/**
 * True when the file is a plausible SQLite database by its header: empty
 * (a valid empty DB) or starting with the 16-byte magic (15 ASCII bytes
 * + a NUL terminator). Reads the first 16 bytes only; never throws (a
 * read failure resolves to `false`).
 */
async function hasSqliteHeader(sourcePath: string): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(sourcePath, 'r');
    const buf = Buffer.alloc(16);
    const { bytesRead } = await handle.read(buf, 0, 16, 0);
    if (bytesRead === 0) return true; // zero-length file is a valid empty DB
    return buf.toString('latin1', 0, 15) === SQLITE_MAGIC_PREFIX && buf[15] === 0;
  } catch {
    return false;
  } finally {
    await handle?.close();
  }
}
