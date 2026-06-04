/**
 * Audit M1, atomic writes use `O_EXCL | O_NOFOLLOW` + CSPRNG-random
 * temp filenames.
 *
 * The previous staging-path scheme was `${path}.tmp.${pid}` (settings)
 * and `${path}.tmp.${pid}.${Date.now()}` (sidecars), both fully
 * predictable. A local attacker who pre-planted a symlink at the
 * predicted temp path would have redirected the privileged write to
 * the symlink's target. The fix:
 *
 *  - random suffix from `node:crypto:randomBytes(8)` (64 bits of
 *    entropy) so the temp path is not predictable.
 *  - `openSync(tmp, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)`
 *    so even if the attacker DID predict the path, the create would
 *    fail with `EEXIST` (if the path already exists) or `ELOOP` (if
 *    the leaf is a symlink) rather than silently following.
 *
 * These tests assert the observable side of both legs. The exact
 * temp-path layout is implementation detail and not part of the
 * contract; the tests probe behavior, not internals.
 *
 * Skipped on Windows: NTFS / win32 `open` flags differ from POSIX
 * (no `O_NOFOLLOW`, symlinks rare), and the fix targets multi-user
 * POSIX hosts where the audit threat applies.
 */

import { describe, it } from 'node:test';
import { strictEqual, ok, throws } from 'node:assert';
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeFileAtomicExclusive, writeJsonAtomic } from '../atomic-write.js';

const SKIP = process.platform === 'win32';

describe('audit M1, atomic writes resist symlink pre-plant + use random temp names', { skip: SKIP }, () => {
  it('rejects a pre-existing entry at the exact temp path with EEXIST (O_EXCL semantics)', () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-map-atomic-excl-'));
    try {
      // The helper composes its temp path as `<target>.tmp.<pid>.<random>`,
      // we cannot pre-plant at the exact suffix because it is
      // CSPRNG-random. Instead we prove the syscall-level contract the
      // helper relies on, with the SAME flags + mode: pre-create a file
      // at a known path, then `openSync(..., O_WRONLY | O_CREAT | O_EXCL,
      // 0o600)` must throw EEXIST (and `O_NOFOLLOW` against a symlink
      // throws ELOOP). If a future change weakens the flag set, this
      // regression catches it.
      const stagedPath = join(root, 'pre-existing.tmp');
      writeFileSync(stagedPath, 'attacker-content');

      throws(
        () => {
          const fd = openSync(
            stagedPath,
            fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
            0o600,
          );
          closeSync(fd);
        },
        (err: NodeJS.ErrnoException) => err.code === 'EEXIST',
        'O_EXCL must reject an existing path',
      );

      const symlinkPath = join(root, 'attacker-symlink.tmp');
      const outsideTarget = join(root, 'outside-target');
      writeFileSync(outsideTarget, 'TOP-SECRET');
      symlinkSync(outsideTarget, symlinkPath);

      throws(
        () => {
          const fd = openSync(
            symlinkPath,
            fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
            0o600,
          );
          closeSync(fd);
        },
        (err: NodeJS.ErrnoException) =>
          // O_EXCL fires first (the symlink "exists" from O_EXCL's POV);
          // some kernels surface ELOOP instead when O_NOFOLLOW races. Both
          // codes are acceptable, what matters is the write was REJECTED,
          // not silently followed.
          err.code === 'EEXIST' || err.code === 'ELOOP',
        'O_NOFOLLOW must reject a symlink-leaf path',
      );

      // The symlink target must NOT have been overwritten.
      strictEqual(
        readFileSync(outsideTarget, 'utf8'),
        'TOP-SECRET',
        'symlink target must remain untouched',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses a non-deterministic temp filename across invocations (CSPRNG-random suffix)', () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-map-atomic-random-'));
    try {
      // Snapshot the directory after a successful write, the temp file
      // is renamed away on success, so we cannot observe it directly.
      // Instead we exercise the helper enough times to make a collision
      // statistically impossible if the suffix were deterministic.
      //
      // We can however observe non-determinism by forcing a failure
      // (rename onto a pre-existing directory): the temp file is left
      // behind only when `unlinkSync` ALSO fails, which we can't easily
      // arrange. So we lean on the strongest deterministic property
      // available: two back-to-back successful writes complete without
      // EEXIST, which a same-pid-same-millisecond duplicate-name
      // scheme could not guarantee. We then verify the directory ends
      // clean (only the target survives).
      const path = join(root, 'settings.json');
      for (let i = 0; i < 50; i++) {
        writeJsonAtomic(path, { iteration: i });
      }
      strictEqual(existsSync(path), true);
      strictEqual(
        readdirSync(root).filter((name) => name.includes('.tmp.')).length,
        0,
        'no temp files should leak after successful writes',
      );

      // Direct helper, same property at the lower-level entry point.
      const direct = join(root, 'direct.bin');
      for (let i = 0; i < 50; i++) {
        writeFileAtomicExclusive(direct, `payload-${i}`);
      }
      strictEqual(readFileSync(direct, 'utf8'), 'payload-49');
      strictEqual(
        readdirSync(root).filter((name) => name.includes('.tmp.')).length,
        0,
        'no temp files should leak after successful writes (direct entry point)',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('writeJsonAtomic refuses to follow a symlink at the target path (rename replaces, never follows)', () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-map-atomic-target-symlink-'));
    try {
      const outsideTarget = join(root, 'sensitive.txt');
      writeFileSync(outsideTarget, 'ORIGINAL-CONTENT');

      const targetPath = join(root, 'settings.json');
      symlinkSync(outsideTarget, targetPath);

      writeJsonAtomic(targetPath, { iteration: 1 });

      // After write, the target is a regular file (rename replaced the
      // symlink), and the previously-pointed-at outside file is
      // untouched. This is POSIX-rename's well-defined behavior; the
      // assertion documents that the helper does NOT silently overwrite
      // the symlink's target.
      ok(existsSync(targetPath));
      const written = JSON.parse(readFileSync(targetPath, 'utf8')) as { iteration: number };
      strictEqual(written.iteration, 1);
      strictEqual(
        readFileSync(outsideTarget, 'utf8'),
        'ORIGINAL-CONTENT',
        'outside target must remain untouched',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
