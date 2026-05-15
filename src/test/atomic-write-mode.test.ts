/**
 * Audit M1, `writeJsonAtomic` + sidecar `atomicWriteFile` must land
 * files with mode 0o600.
 *
 * Settings files (`settings.json`, `settings.local.json`) and `.sm`
 * sidecars carry privacy-sensitive paths from `scan.extraFolders` /
 * `referencePaths` and the per-plugin config; on multi-user hosts the
 * default umask would leave them world-readable. The fix sets
 * `mode: 0o600` on the temp file so the rename inherits owner-only
 * permissions.
 *
 * Skipped on Windows: NTFS / `chmod` on win32 ignores POSIX mode
 * bits; the production code still passes the option, but the
 * resulting `stat.mode` is implementation-defined. Linux-only
 * verification is sufficient for our CI matrix.
 */

import { describe, it } from 'node:test';
import { strictEqual } from 'node:assert';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeJsonAtomic } from '../core/config/atomic-write.js';
import { FilesystemSidecarStore } from '../kernel/sidecar/store.js';

const SKIP = process.platform === 'win32';

function modeOf(path: string): number {
  return statSync(path).mode & 0o777;
}

describe('audit M1, atomic writes land mode 0o600', { skip: SKIP }, () => {
  it('writeJsonAtomic writes a 0o600 settings file', () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-map-atomic-mode-'));
    try {
      const path = join(root, 'settings.json');
      writeJsonAtomic(path, { updateCheck: { enabled: false } });
      strictEqual(existsSync(path), true);
      strictEqual(modeOf(path), 0o600);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('FilesystemSidecarStore.applyPatch writes a 0o600 sidecar', async () => {
    const sidecarRoot = mkdtempSync(join(tmpdir(), 'skill-map-sidecar-mode-'));
    const consentRoot = mkdtempSync(join(tmpdir(), 'skill-map-sidecar-mode-consent-'));
    try {
      // Pre-grant write consent so the store's pre-flight gate passes
      // without prompting (mirrors `sidecar-store.test.ts:consentBag`).
      mkdirSync(join(consentRoot, '.skill-map'), { recursive: true });
      writeFileSync(
        join(consentRoot, '.skill-map', 'settings.local.json'),
        JSON.stringify({ allowEditSmFiles: true }),
        'utf8',
      );

      const target = join(sidecarRoot, 'foo.sm');
      const store = new FilesystemSidecarStore();
      await store.applyPatch(
        target,
        {
          identity: {
            path: 'foo.md',
            bodyHash: 'a'.repeat(64),
            frontmatterHash: 'b'.repeat(64),
          },
          annotations: { version: 1 },
        },
        { confirm: false, cwd: consentRoot},
      );
      strictEqual(existsSync(target), true);
      strictEqual(modeOf(target), 0o600);
    } finally {
      rmSync(sidecarRoot, { recursive: true, force: true });
      rmSync(consentRoot, { recursive: true, force: true });
    }
  });
});
