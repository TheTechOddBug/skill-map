/**
 * Atomic file I/O for `.skill-map/settings.json` writes.
 *
 * Promoted from `src/cli/commands/config.ts` (`writeJsonAtomic` +
 * `readJsonObjectOrEmpty`) so the config-helper module and any other
 * settings-mutating code path can share one implementation. Behavior
 * is unchanged from the previous inline definitions.
 *
 * Lives under `src/kernel/util/` as the innermost-layer home for this
 * generic atomic-write primitive: the kernel's sidecar store consumes
 * it, and `core/` (the config helper) plus `cli/` reach DOWN into the
 * kernel for it (the sanctioned `core|cli` -> `kernel` direction), so
 * no layer has to import upward. Pure: only Node built-ins, reads no
 * `process.env` / `process.cwd()` (every input is an explicit
 * parameter).
 */

import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname } from 'node:path';

/**
 * Read `path` as a JSON object. Returns `{}` when the file is absent,
 * malformed, or its top-level value is not a plain object (arrays /
 * scalars). Never throws, callers treat "no settings here" the same
 * as "settings present but empty."
 */
export function readJsonObjectOrEmpty(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return raw as Record<string, unknown>;
    }
  } catch {
    /* fall through to {} */
  }
  return {};
}

/**
 * Stage `content` under `path` via an exclusive, no-follow open and
 * `renameSync` the result into place. Shared by `writeJsonAtomic`
 * (settings) and `kernel/sidecar/store.ts:atomicWriteFile` (`.sm`
 * sidecars), both of which previously composed a predictable temp
 * filename (`<path>.tmp.<pid>` / `<path>.tmp.<pid>.<Date.now()>`)
 * and called `writeFileSync`, which follows symlinks. A local
 * attacker who pre-planted a symlink at the predicted temp path
 * would have redirected the write to the symlink's target.
 *
 * Fix (audit M1):
 *
 *  - The temp name embeds a cryptographically-random suffix
 *    (`randomBytes(8).toString('hex')`) so the path is
 *    unpredictable across invocations.
 *  - `openSync` uses `O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW` with
 *    mode `0o600`. `O_EXCL` makes the syscall fail with `EEXIST` if
 *    anything (file, symlink, directory) already lives at the temp
 *    path; `O_NOFOLLOW` makes it fail with `ELOOP` if the leaf is a
 *    symlink. Together they close the race the previous
 *    `writeFileSync`-with-predictable-name pattern left open.
 *  - The write goes through the returned fd; the rename is the
 *    standard POSIX same-filesystem atomic rename. Mode `0o600`
 *    survives the rename (POSIX rename preserves the inode + its
 *    mode), which is what the settings / sidecar privacy guarantee
 *    relies on.
 *
 * On failure the temp file is best-effort removed so we do not leak
 * `<path>.tmp.<random>` siblings if the rename target is read-only.
 */
export function writeFileAtomicExclusive(
  path: string,
  content: string,
  mode: number = 0o600,
): void {
  // 16 hex chars (64 bits of entropy). The `node:crypto` source is
  // CSPRNG-backed; an attacker cannot pre-plant a symlink at a
  // predicted temp path because they cannot predict the suffix.
  const tmp = `${path}.tmp.${process.pid}.${randomBytes(8).toString('hex')}`;
  let fd: number | null = null;
  try {
    // O_EXCL fails with EEXIST if the path already exists (file,
    // symlink, directory). O_NOFOLLOW fails with ELOOP if the final
    // path component is a symlink. Together they close the audit M1
    // race window. The mode (default 0o600 for settings / sidecars
    // that may carry private paths; callers can opt into 0o644 for
    // files that ship with the repo, e.g. `.skillmapignore`) is set
    // at create time so the inode never carries broader perms than
    // intended, even briefly. On Windows Node.js maps POSIX modes
    // to the readonly attribute (owner-write bit only), so 0o600
    // and 0o644 are functionally identical there; the parameter is
    // a no-op without breaking the call site.
    fd = openSync(
      tmp,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
      mode,
    );
    writeSync(fd, content);
    closeSync(fd);
    fd = null;
    renameSync(tmp, path);
  } catch (err) {
    // Ensure the fd is released even if the rename threw.
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* best-effort */
      }
    }
    try {
      unlinkSync(tmp);
    } catch {
      // Best effort, the staged file may not exist (open could have
      // failed before the inode was created).
    }
    throw err;
  }
}

/**
 * Write `content` to `path` atomically. The body is staged into a
 * sibling `<path>.tmp.<pid>.<random>` file (same directory so the
 * rename never crosses filesystems) and `renameSync`'d into place,
 * POSIX guarantees rename is atomic on the same fs, so a crash
 * mid-write leaves the destination either at its prior content or
 * at the new content, never half-written.
 *
 * The pre-rename stage is owner-only (`mode: 0o600`, audit M1) and
 * opened with `O_EXCL | O_NOFOLLOW` (audit M1) so a pre-planted
 * symlink at the predicted temp path cannot redirect the write.
 * Settings files (`settings.json`, `settings.local.json`) carry
 * privacy-sensitive paths from `scan.referencePaths` and the
 * per-plugin config; on multi-user hosts the default umask
 * would leave them world-readable. `db restore` already uses 0o600
 * for the same reason. The mode is set on the temp file and survives
 * the rename (POSIX rename preserves the inode + its mode).
 */
export function writeJsonAtomic(path: string, content: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileAtomicExclusive(path, JSON.stringify(content, null, 2) + '\n');
}

/**
 * Force `0o600` on a file skill-map owns, swallowing failures.
 *
 * The atomic writer above creates its files owner-only at `open()` time,
 * but two artifacts are produced by primitives that do not take a mode:
 * the SQLite database (created by `DatabaseSync` on first open) and its
 * backups (`copyFileSync`). Both default to `0o666 & ~umask`, i.e. world
 * readable under the common `022`, while carrying the same scanned
 * content as the sidecars we already restrict. This closes that gap so
 * every file the tool creates lands owner-only.
 *
 * Best effort by contract: Windows and non-POSIX filesystems reject
 * `chmod`, and tightening permissions is a hardening pass, never a
 * correctness gate, so a failure must not fail the operation that
 * produced the file.
 */
export function chmodOwnerOnlyBestEffort(path: string): void {
  try {
    chmodSync(path, 0o600);
  } catch {
    // Intentionally silent, see the docstring.
  }
}
