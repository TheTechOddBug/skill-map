/**
 * `core/generated-folder-gitignore.ts`, the ignore file dropped inside a
 * materialised skill folder (`spec/cli-contract.md` §Scope ignore file →
 * Materialised skill folders).
 *
 * The contract worth pinning: the body hides the whole folder INCLUDING
 * the ignore file itself, an existing file is never overwritten (it can
 * only be the operator's), and an unwritable target is reported rather
 * than thrown, since the install that called us must not fail over it.
 */

import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { ensureGeneratedFolderGitignore } from '../generated-folder-gitignore.js';

function freshFolder(): string {
  const root = mkdtempSync(join(tmpdir(), 'sm-generated-gitignore-'));
  const folder = join(root, 'sm-process-jobs');
  mkdirSync(folder);
  return folder;
}

function bodyOf(folder: string): string {
  return readFileSync(join(folder, '.gitignore'), 'utf8');
}

describe('ensureGeneratedFolderGitignore', () => {
  it('creates a .gitignore that ignores everything in the folder', () => {
    const folder = freshFolder();

    assert.equal(ensureGeneratedFolderGitignore(folder), true);

    const lines = bodyOf(folder)
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'));
    // A bare `*` also matches `.gitignore` itself, so git sees no
    // trackable file at all and the folder disappears rather than
    // leaving a one-line husk behind.
    assert.deepEqual(lines, ['*']);
  });

  it('explains itself so the operator knows how to opt out', () => {
    const folder = freshFolder();
    ensureGeneratedFolderGitignore(folder);

    const comments = bodyOf(folder)
      .split('\n')
      .filter((l) => l.startsWith('#'))
      .join(' ');
    assert.match(comments, /Managed by skill-map/);
    assert.match(comments, /Delete this file/);
  });

  it('never overwrites an existing file', () => {
    const folder = freshFolder();
    // The operator's own decision: commit the folder except one file.
    writeFileSync(join(folder, '.gitignore'), '*.local\n', 'utf8');

    assert.equal(ensureGeneratedFolderGitignore(folder), false);
    assert.equal(bodyOf(folder), '*.local\n');
  });

  it('reports a failed write instead of throwing', () => {
    const root = mkdtempSync(join(tmpdir(), 'sm-generated-gitignore-ro-'));
    const folder = join(root, 'sm-process-jobs');
    mkdirSync(folder);
    chmodSync(folder, 0o500); // read + execute, no write
    try {
      assert.equal(ensureGeneratedFolderGitignore(folder), false);
      assert.equal(existsSync(join(folder, '.gitignore')), false);
    } finally {
      chmodSync(folder, 0o700);
    }
  });
});
