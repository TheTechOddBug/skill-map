/**
 * Step 14.5.a, `node-body.ts` unit tests.
 *
 * The route layer (`/api/nodes/:pathB64?include=body`) is exercised
 * end-to-end in `server-endpoints.test.ts`. These tests cover the
 * pure helpers in isolation: `stripFrontmatter` and `readNodeBody`'s
 * path-traversal / missing-file branches.
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { readNodeBody, stripFrontmatter } from '../node-body.js';

let scratch: string;

before(() => {
  scratch = mkdtempSync(join(tmpdir(), 'skill-map-node-body-'));
});

after(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('stripFrontmatter()', () => {
  it('returns the input unchanged when no leading `---` is present', () => {
    const raw = '# Heading\n\nbody text.\n';
    assert.equal(stripFrontmatter(raw), raw);
  });

  it('strips a standard `---\\n…\\n---\\n` block (preserves the blank line the author placed under the closer)', () => {
    const raw = ['---', 'name: foo', 'description: bar', '---', '', 'body line 1', 'body line 2', ''].join('\n');
    // The blank line between `---` and `body line 1` is part of the
    // body, the author wrote it. The stripper removes ONLY the
    // delimiter pair plus its trailing newline.
    assert.equal(stripFrontmatter(raw), '\nbody line 1\nbody line 2\n');
  });

  it('strips a trailing-CRLF frontmatter block', () => {
    const raw = '---\r\nname: foo\r\n---\r\nhello\r\n';
    assert.equal(stripFrontmatter(raw), 'hello\r\n');
  });

  it('returns the input unchanged when the closing delimiter is missing', () => {
    // No closing `---`, treat the leading line as part of the body so
    // the user sees something rather than getting silently emptied out.
    const raw = '---\nname: foo\nbody but no closer\n';
    assert.equal(stripFrontmatter(raw), raw);
  });

  it('does NOT strip a `---` thematic break in the middle of a document', () => {
    const raw = 'intro\n\n---\n\nrest\n';
    assert.equal(stripFrontmatter(raw), raw);
  });

  it('handles an empty frontmatter block', () => {
    const raw = '---\n---\nbody.\n';
    assert.equal(stripFrontmatter(raw), 'body.\n');
  });
});

describe('readNodeBody()', () => {
  it('reads a markdown file and returns its post-frontmatter body', async () => {
    writeFileSync(
      join(scratch, 'note.md'),
      ['---', 'name: note', '---', 'hello body.', ''].join('\n'),
    );
    const body = await readNodeBody(scratch, 'note.md');
    assert.equal(body, 'hello body.\n');
  });

  it('returns null when the relative path does not exist on disk', async () => {
    const body = await readNodeBody(scratch, 'no-such-file.md');
    assert.equal(body, null);
  });

  it('returns null when the resolved path is a directory (EISDIR)', async () => {
    mkdirSync(join(scratch, 'dir-node'), { recursive: true });
    const body = await readNodeBody(scratch, 'dir-node');
    assert.equal(body, null);
  });

  it('refuses paths that escape the scope root via `..`', async () => {
    // Plant a file OUTSIDE the scratch root that an attacker would want
    // to leak. `readNodeBody` must refuse the traversal regardless of
    // whether the target exists.
    const body = await readNodeBody(scratch, '../../etc/passwd');
    assert.equal(body, null);
  });

  it('refuses an absolute path even when it points inside the root', async () => {
    // Defense in depth: even if the absolute path happens to resolve
    // inside the root, the API contract is "node.path is relative",
    // accepting absolute paths would let a corrupted DB row leak any
    // file the server process can read.
    const abs = join(scratch, 'note.md');
    const body = await readNodeBody(scratch, abs);
    assert.equal(body, null);
  });

  it('returns the raw file content when the file has no frontmatter', async () => {
    writeFileSync(join(scratch, 'plain.md'), '# just a heading\n\nno fm here.\n');
    const body = await readNodeBody(scratch, 'plain.md');
    assert.equal(body, '# just a heading\n\nno fm here.\n');
  });

  // Audit M2 / O_NOFOLLOW: the open is guarded with `O_RDONLY |
  // O_NOFOLLOW` so a leaf-swap race between the indexed `scan_nodes.path`
  // and the on-disk file cannot leak symlink targets to the SPA. The
  // suite is skipped on Windows because `symlinkSync` there needs the
  // SeCreateSymbolicLinkPrivilege which CI runners typically lack; the
  // POSIX-only coverage is sufficient because `O_NOFOLLOW` is a POSIX
  // primitive and the residual surface on Windows is governed by
  // `CreateFile`'s reparse-point handling we do not opt into.
  const skipSymlinkTests = platform() === 'win32';

  it(
    'returns null when the resolved path is a symlink (audit M2: ELOOP from O_NOFOLLOW)',
    { skip: skipSymlinkTests },
    async () => {
      // Stage a regular file outside the scope as the symlink target so
      // the test reads through the link if the guard ever regresses,
      // never the link itself.
      const targetDir = mkdtempSync(join(tmpdir(), 'skill-map-node-body-target-'));
      const targetFile = join(targetDir, 'secret.md');
      writeFileSync(targetFile, '# would-be leak\n\nshould never read this.\n');
      try {
        const linkPath = join(scratch, 'leaked.md');
        // Try / clean previous symlink at the same name to keep the test
        // idempotent across re-runs.
        try { rmSync(linkPath, { force: true }); } catch { /* none */ }
        symlinkSync(targetFile, linkPath);
        const body = await readNodeBody(scratch, 'leaked.md');
        assert.equal(body, null, 'O_NOFOLLOW must reject the symlink leaf');
      } finally {
        rmSync(targetDir, { recursive: true, force: true });
        rmSync(join(scratch, 'leaked.md'), { force: true });
      }
    },
  );

  it(
    'still reads regular files through a directory whose siblings are symlinks',
    { skip: skipSymlinkTests },
    async () => {
      // Sanity check that the O_NOFOLLOW posture only rejects the LEAF,
      // not unrelated symlinks elsewhere in the project. A regression
      // that switched to a full-tree `realpath` walk would falsely
      // reject every scope that happens to contain ANY symlink.
      const sibling = join(scratch, 'sibling-link');
      try { rmSync(sibling, { force: true }); } catch { /* none */ }
      symlinkSync(scratch, sibling);
      try {
        writeFileSync(join(scratch, 'reachable.md'), 'present.\n');
        const body = await readNodeBody(scratch, 'reachable.md');
        assert.equal(body, 'present.\n');
      } finally {
        rmSync(sibling, { force: true });
        rmSync(join(scratch, 'reachable.md'), { force: true });
      }
    },
  );
});
