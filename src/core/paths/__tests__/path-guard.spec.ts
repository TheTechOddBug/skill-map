/**
 * Unit tests for `core/paths/path-guard.ts:assertContained`.
 *
 * Two layers of coverage:
 *
 *   1. The historical string-level containment check, absolute paths and
 *      `..`-laden relatives are rejected before any filesystem read.
 *   2. The audit M1 leaf-symlink guard, after containment passes, an
 *      `lstat` rejects any path whose leaf is a symlink (the typical
 *      TOCTOU-against-the-index swap). ENOENT / ENOTDIR are silently
 *      allowed because the caller's own "not found" branch will surface
 *      a directed error; the guard is not in the business of asserting
 *      existence.
 *
 * Symlink tests skip on Windows where `symlinkSync` needs the
 * SeCreateSymbolicLinkPrivilege CI runners typically lack; the leaf
 * defense is a POSIX `lstat` primitive and the matching `O_NOFOLLOW`
 * read happens in `server/node-body.ts` (covered there).
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join, sep } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { assertContained } from '../path-guard.js';

const skipSymlinkTests = platform() === 'win32';

let scratch: string;

before(() => {
  scratch = mkdtempSync(join(tmpdir(), 'skill-map-path-guard-'));
});

after(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('assertContained() containment', () => {
  it('accepts a simple relative path inside the root', () => {
    writeFileSync(join(scratch, 'note.md'), 'present.\n');
    assert.doesNotThrow(() => assertContained(scratch, 'note.md'));
  });

  it('accepts a nested relative path inside the root', () => {
    mkdirSync(join(scratch, 'sub', 'nested'), { recursive: true });
    writeFileSync(join(scratch, 'sub', 'nested', 'deep.md'), 'present.\n');
    assert.doesNotThrow(() => assertContained(scratch, `sub${sep}nested${sep}deep.md`));
  });

  it('accepts a non-existent relative path (containment is not existence)', () => {
    // A caller that wraps `assertContained` then handles ENOENT itself
    // must be free to ask about a path that does not exist on disk;
    // the guard only refuses traversal / symlinks.
    assert.doesNotThrow(() => assertContained(scratch, 'no-such-file.md'));
  });

  it('rejects an absolute path even if it points inside the root', () => {
    assert.throws(
      () => assertContained(scratch, join(scratch, 'note.md')),
      /absolute/,
    );
  });

  it('rejects a `..`-laden relative path that escapes the root', () => {
    assert.throws(
      () => assertContained(scratch, `..${sep}..${sep}etc${sep}passwd`),
      /escapes/,
    );
  });

  it('rejects a relative path that resolves to a sibling of the root', () => {
    // `<scratch>` -> ascend one, descend back into a sibling. After
    // `resolve()` collapses the segments the absolute path no longer
    // starts with `<scratch>${sep}`.
    assert.throws(
      () => assertContained(scratch, `..${sep}sibling${sep}foo.md`),
      /escapes/,
    );
  });
});

describe('assertContained() symlink guard (audit M1)', () => {
  it(
    'rejects when the resolved leaf is a symlink to a file outside the root',
    { skip: skipSymlinkTests },
    () => {
      const targetDir = mkdtempSync(join(tmpdir(), 'skill-map-path-guard-target-'));
      const targetFile = join(targetDir, 'secret.md');
      writeFileSync(targetFile, '# would-be leak\n');
      const linkPath = join(scratch, 'leak-link.md');
      try {
        rmSync(linkPath, { force: true });
      } catch { /* none */ }
      symlinkSync(targetFile, linkPath);
      try {
        assert.throws(
          () => assertContained(scratch, 'leak-link.md'),
          /symlink/,
        );
      } finally {
        rmSync(linkPath, { force: true });
        rmSync(targetDir, { recursive: true, force: true });
      }
    },
  );

  it(
    'rejects when the resolved leaf is a symlink to a file inside the root',
    { skip: skipSymlinkTests },
    () => {
      // Defense-in-depth: even an in-root symlink target would let an
      // attacker that controls the leaf swap it for a link to a
      // privileged file later. The guard rejects every leaf symlink,
      // regardless of where the link points TODAY.
      writeFileSync(join(scratch, 'real.md'), 'present.\n');
      const linkPath = join(scratch, 'inside-link.md');
      try {
        rmSync(linkPath, { force: true });
      } catch { /* none */ }
      symlinkSync(join(scratch, 'real.md'), linkPath);
      try {
        assert.throws(
          () => assertContained(scratch, 'inside-link.md'),
          /symlink/,
        );
      } finally {
        rmSync(linkPath, { force: true });
      }
    },
  );

  it(
    'rejects when the resolved leaf is a symlink to a directory',
    { skip: skipSymlinkTests },
    () => {
      const linkPath = join(scratch, 'dir-link');
      try {
        rmSync(linkPath, { force: true });
      } catch { /* none */ }
      symlinkSync(scratch, linkPath);
      try {
        assert.throws(
          () => assertContained(scratch, 'dir-link'),
          /symlink/,
        );
      } finally {
        rmSync(linkPath, { force: true });
      }
    },
  );

  it(
    'rejects a dangling symlink (target does not exist)',
    { skip: skipSymlinkTests },
    () => {
      // `lstat` follows the LINK itself, not its target, so a dangling
      // symlink still reports `isSymbolicLink() === true`. The guard
      // must reject regardless of resolvability.
      const linkPath = join(scratch, 'dangling-link.md');
      try {
        rmSync(linkPath, { force: true });
      } catch { /* none */ }
      symlinkSync(join(scratch, 'nope.md'), linkPath);
      try {
        assert.throws(
          () => assertContained(scratch, 'dangling-link.md'),
          /symlink/,
        );
      } finally {
        rmSync(linkPath, { force: true });
      }
    },
  );

  it(
    'allows a regular file living next to a symlink with the same prefix',
    { skip: skipSymlinkTests },
    () => {
      // Sanity check: the symlink check looks at the leaf only, not at
      // siblings. A regression that switched to `realpath` or a recursive
      // walk would falsely reject any scope that ALSO contains a symlink.
      const sibling = join(scratch, 'unrelated-link');
      try {
        rmSync(sibling, { force: true });
      } catch { /* none */ }
      symlinkSync(scratch, sibling);
      writeFileSync(join(scratch, 'real-file.md'), 'present.\n');
      try {
        assert.doesNotThrow(() => assertContained(scratch, 'real-file.md'));
      } finally {
        rmSync(sibling, { force: true });
      }
    },
  );
});

/**
 * Audit L4: the containment test used to compare against the raw `cwd`
 * it was handed. Every caller today passes an already-resolved absolute
 * path, so nothing was exploitable, but a trailing separator or a
 * relative value would have made `startsWith(root + sep)` misjudge, in
 * BOTH directions. The guard now normalises its own root.
 */
describe('assertContained, root normalisation', () => {
  it('accepts a contained path when the root carries a trailing separator', () => {
    writeFileSync(join(scratch, 'kept.md'), 'body\n');
    assert.doesNotThrow(() => assertContained(`${scratch}${sep}`, 'kept.md'));
  });

  it('still refuses an escape when the root carries a trailing separator', () => {
    assert.throws(
      () => assertContained(`${scratch}${sep}`, `..${sep}outside.md`),
      /escapes repo root/,
    );
  });

  it('refuses an escape when the root is unnormalised mid-path', () => {
    assert.throws(
      () => assertContained(join(scratch, 'sub', '..'), `..${sep}..${sep}outside.md`),
      /escapes repo root/,
    );
  });
});
