/**
 * Coverage for the dev-build detection helper. The flag threads into
 * three surfaces the operator reads at a glance, the `sm version` /
 * `sm serve` banner `[dev]` marker, and the SPA topbar's yellow `dev`
 * chip via `/api/health.dev`. A regression that flipped the rule
 * (saying "dev" when actually on a published install, or vice versa)
 * would lie about which build the operator is hitting, the test
 * suite pins the boundary explicitly.
 *
 * `isDevBuild()` itself is filesystem-bound (it captures the helper's
 * own `import.meta.url` once at module load), so the tests target the
 * exported `isDevBuildFromPath(filePath, separator?)` pure helper.
 * Both POSIX and Windows separators are exercised.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { isDevBuild, isDevBuildFromPath } from '../dev-mode.js';

describe('isDevBuildFromPath (pure)', () => {
  describe('POSIX paths', () => {
    it('returns true for a repo checkout (no /node_modules/ segment)', () => {
      // The compiled helper lives at `<repo>/src/dist/kernel/util/dev-mode.js`
      // when shipped via the CLI, and `<repo>/src/kernel/util/dev-mode.ts`
      // during a tsx import. Neither path includes a `/node_modules/`
      // segment because the parent workspace's `node_modules/` is a
      // SIBLING of the source tree, not an ancestor.
      assert.equal(
        isDevBuildFromPath('/home/dev/skill-map/src/dist/kernel/util/dev-mode.js', '/'),
        true,
      );
      assert.equal(
        isDevBuildFromPath('/home/dev/skill-map/src/kernel/util/dev-mode.ts', '/'),
        true,
      );
    });

    it('returns false for a published install (path contains /node_modules/)', () => {
      // Global install: `<npm-prefix>/lib/node_modules/@skill-map/cli/dist/...`.
      assert.equal(
        isDevBuildFromPath(
          '/usr/local/lib/node_modules/@skill-map/cli/dist/kernel/util/dev-mode.js',
          '/',
        ),
        false,
      );
      // Local install via pnpm/npm: `<project>/node_modules/@skill-map/cli/dist/...`.
      assert.equal(
        isDevBuildFromPath(
          '/home/dev/some-project/node_modules/@skill-map/cli/dist/kernel/util/dev-mode.js',
          '/',
        ),
        false,
      );
    });

    it('returns false for pnpm-content-addressed installs (.pnpm/<pkg>/node_modules/...)', () => {
      // pnpm's store-linked layout nests another `node_modules/` under
      // the content-addressed directory. The segment match still fires.
      assert.equal(
        isDevBuildFromPath(
          '/home/dev/some-project/node_modules/.pnpm/@skill-map+cli@1.0.0/node_modules/@skill-map/cli/dist/kernel/util/dev-mode.js',
          '/',
        ),
        false,
      );
    });

    it('returns true for `pnpm link`-style consumers (link target is the checkout, not node_modules)', () => {
      // `pnpm link` creates a symlink, but `import.meta.url` resolves
      // to the link TARGET, which lives in the checkout (no
      // node_modules ancestor). The flag stays `true` so the operator
      // still sees the dev marker when iterating against a linked
      // project, which is the whole point of the link workflow.
      assert.equal(
        isDevBuildFromPath('/home/dev/skill-map/src/dist/kernel/util/dev-mode.js', '/'),
        true,
      );
    });
  });

  describe('Windows paths', () => {
    it('returns true for a repo checkout (no \\node_modules\\ segment)', () => {
      assert.equal(
        isDevBuildFromPath(
          'C:\\Users\\dev\\skill-map\\src\\dist\\kernel\\util\\dev-mode.js',
          '\\',
        ),
        true,
      );
    });

    it('returns false for a published install (path contains \\node_modules\\)', () => {
      assert.equal(
        isDevBuildFromPath(
          'C:\\Users\\dev\\some-project\\node_modules\\@skill-map\\cli\\dist\\kernel\\util\\dev-mode.js',
          '\\',
        ),
        false,
      );
    });
  });

  describe('separator discipline (only the configured separator triggers detection)', () => {
    it('a literal `node_modules` segment with the WRONG separator does NOT flip the flag', () => {
      // Defensive: a POSIX path that happens to contain the substring
      // "node_modules" without proper `/` separators (e.g. a folder
      // someone named `my-node_modules-mirror`) must not trip the
      // check. Surrounding sep boundaries are load-bearing.
      assert.equal(
        isDevBuildFromPath('/home/dev/my-node_modules-mirror/sm/dist/...', '/'),
        true,
      );
    });

    it('falls back to the host `sep` when not supplied (matches production behaviour)', () => {
      // The default-argument branch (no `separator` passed) reads
      // `path.sep`. We can't reliably assert against the host's own
      // value without coupling the test to OS, but we can pin that
      // the SAME invocation is deterministic and uses some separator,
      // by passing `undefined` explicitly and comparing against the
      // same-path-with-explicit-sep result.
      const path = '/home/dev/skill-map/src/dist/kernel/util/dev-mode.js';
      const implicit = isDevBuildFromPath(path);
      const explicit = isDevBuildFromPath(path, '/');
      // On POSIX hosts both should agree; on Windows, the implicit
      // branch reads `\\` while the explicit one reads `/`, but both
      // happen to evaluate true for this path (no separator-wrapped
      // `node_modules` segment matches), so the test stays cross-OS.
      assert.equal(implicit, true);
      assert.equal(explicit, true);
    });
  });

  it('empty input is treated as a dev build (no node_modules segment present)', () => {
    // The boundary case lands on the "true" branch: an empty string
    // can't contain the segment. The caller (production: a
    // non-empty `import.meta.url`) will never hit this, but pinning
    // it keeps the helper total.
    assert.equal(isDevBuildFromPath('', '/'), true);
  });
});

describe('isDevBuild (production binding)', () => {
  it('returns a stable boolean across calls within a single process', () => {
    // The helper captures the path once at module load; subsequent
    // calls must return the same value (no transient FS read per
    // invocation, no shape drift).
    const first = isDevBuild();
    const second = isDevBuild();
    assert.equal(typeof first, 'boolean');
    assert.equal(first, second);
  });

  it('returns true under the test runner (the helper module sits inside the repo checkout)', () => {
    // When the spec runs from `<repo>/src/kernel/util/__tests__/...`
    // (tsx import) or its dist sibling, the helper module's own path
    // also lives under `<repo>/src/...` without a `node_modules`
    // ancestor. So the production binding must report dev=true. If
    // this ever flips, either the helper's path resolution changed
    // or the build moved into a `node_modules`-shaped location and
    // the detection rule needs revisiting.
    assert.equal(isDevBuild(), true);
  });
});
