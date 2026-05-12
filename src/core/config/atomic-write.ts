/**
 * Atomic file I/O for `.skill-map/settings.json` writes.
 *
 * Promoted from `src/cli/commands/config.ts` (`writeJsonAtomic` +
 * `readJsonObjectOrEmpty`) so the config-helper module and any other
 * settings-mutating code path can share one implementation. Behavior
 * is unchanged from the previous inline definitions.
 *
 * Lives under `src/core/config/` so `cli/` and `server/` (BFF) can
 * both import it; the module reads no `process.env` /
 * `process.cwd()` (every input is an explicit parameter), so the
 * kernel-boundary lint rule (`src/eslint.config.js:233`) holds.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
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
 * Write `content` to `path` atomically. The body is staged into a
 * sibling `<path>.tmp.<pid>` file (same directory so the rename never
 * crosses filesystems) and `renameSync`'d into place, POSIX
 * guarantees rename is atomic on the same fs, so a crash mid-write
 * leaves the destination either at its prior content or at the new
 * content, never half-written.
 *
 * The pre-rename stage is owner-only (`mode: 0o600`, audit M1).
 * Settings files (`settings.json`, `settings.local.json`) carry
 * privacy-sensitive paths from `scan.extraFolders` / `referencePaths`
 * and the per-plugin config; on multi-user hosts the default umask
 * would leave them world-readable. `db restore` already uses 0o600
 * for the same reason. The mode is set on the temp file and survives
 * the rename (POSIX rename preserves the inode + its mode).
 *
 * On failure the temp file is best-effort removed so we do not leak
 * `<path>.tmp.<pid>` siblings if e.g. the rename target is read-only.
 */
export function writeJsonAtomic(path: string, content: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}`;
  try {
    writeFileSync(tmp, JSON.stringify(content, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, path);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // Best effort, the staged file may not exist (writeFileSync
      // could have failed before the inode was created).
    }
    throw err;
  }
}
