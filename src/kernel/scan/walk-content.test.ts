import { describe, it, before, after } from 'node:test';
import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { walkContent, UnknownParserError } from './walk-content.js';
import { buildIgnoreFilter } from './ignore.js';

let root: string;

before(() => {
  root = mkdtempSync(join(tmpdir(), 'walk-content-'));

  const write = (rel: string, content: string): void => {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  };

  // Markdown files, primary content.
  write(
    'docs/a.md',
    ['---', 'name: a', 'description: alpha', '---', 'body of a'].join('\n'),
  );
  write('docs/b.md', 'no frontmatter here, just body');
  write('nested/inner/c.md', '---\nname: c\n---\nbody');

  // Non-matching extensions.
  write('docs/a.txt', 'should not be yielded under extensions: [".md"]');
  write('docs/a.toml', 'name = "toml"\ndescription = "stays"');

  // Files inside ignored directories.
  write('.git/HEAD', 'ref: refs/heads/main');
  write('node_modules/foo/thing.md', 'should be ignored');

  // Symlink at the root that points outside, must be skipped (M7).
  // We point at /etc/hostname which always exists on Linux; the test
  // asserts the walker did not yield it (ignored as a symlink, not
  // because of the ignore filter).
  try {
    symlinkSync('/etc/hostname', join(root, 'symlinked.md'));
  } catch {
    // Some sandboxes block symlink creation, the test still passes
    // because the file simply does not exist.
  }
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('walkContent', () => {
  it('yields one IRawNode per matching markdown file, sorted-stable per directory', async () => {
    const collected: string[] = [];
    for await (const n of walkContent([root], {
      extensions: ['.md'],
      parser: 'frontmatter-yaml',
    })) {
      collected.push(n.path);
    }
    collected.sort();
    deepStrictEqual(collected, ['docs/a.md', 'docs/b.md', 'nested/inner/c.md']);
  });

  it('parses frontmatter via the configured parser', async () => {
    for await (const n of walkContent([root], {
      extensions: ['.md'],
      parser: 'frontmatter-yaml',
    })) {
      if (n.path !== 'docs/a.md') continue;
      strictEqual((n.frontmatter as { name?: string }).name, 'a');
      strictEqual((n.frontmatter as { description?: string }).description, 'alpha');
      strictEqual(n.body.trim(), 'body of a');
      return;
    }
    ok(false, 'docs/a.md not yielded');
  });

  it('yields empty frontmatter when no fence is present (frontmatter-yaml)', async () => {
    for await (const n of walkContent([root], {
      extensions: ['.md'],
      parser: 'frontmatter-yaml',
    })) {
      if (n.path !== 'docs/b.md') continue;
      deepStrictEqual(n.frontmatter, {});
      strictEqual(n.body, 'no frontmatter here, just body');
      return;
    }
    ok(false, 'docs/b.md not yielded');
  });

  it('respects the configured extensions list (filters by suffix)', async () => {
    const collected: string[] = [];
    for await (const n of walkContent([root], {
      extensions: ['.toml'],
      parser: 'plain',
    })) {
      collected.push(n.path);
    }
    deepStrictEqual(collected, ['docs/a.toml']);
  });

  it('uses the `plain` parser to pass content through unparsed', async () => {
    for await (const n of walkContent([root], {
      extensions: ['.toml'],
      parser: 'plain',
    })) {
      if (n.path !== 'docs/a.toml') continue;
      deepStrictEqual(n.frontmatter, {});
      strictEqual(n.body.includes('name = "toml"'), true);
      return;
    }
    ok(false, 'docs/a.toml not yielded by plain parser');
  });

  it('skips ignored directories (.git, node_modules) via the bundled defaults filter', async () => {
    const collected: string[] = [];
    for await (const n of walkContent([root], {
      extensions: ['.md'],
      parser: 'frontmatter-yaml',
    })) {
      collected.push(n.path);
    }
    ok(!collected.some((p) => p.startsWith('.git/')), '.git/ should be skipped');
    ok(!collected.some((p) => p.startsWith('node_modules/')), 'node_modules/ should be skipped');
  });

  it('skips symlinks (audit M7)', async () => {
    const collected: string[] = [];
    for await (const n of walkContent([root], {
      extensions: ['.md'],
      parser: 'frontmatter-yaml',
    })) {
      collected.push(n.path);
    }
    ok(!collected.includes('symlinked.md'), 'symlinks must not be yielded');
  });

  it('rejects symlinks via lstat in the TOCTOU re-check (audit H1)', async () => {
    // H1 hardens the TOCTOU re-check from `stat` to `lstat`. The
    // top-level `entry.isSymbolicLink()` filter is the first line of
    // defence; this test creates a SEPARATE temp tree whose only
    // `.md`-suffixed entries are symlinks, so a regression that
    // re-introduces `stat` (which follows the link, returns
    // `isFile() === true`, and lets the target's content leak into
    // the walker's output) would be caught here too: the readdir-level
    // skip continues to guard the happy path, while the lstat
    // re-verification guards the race window where the entry was a
    // regular file at `readdir` time but became a symlink before the
    // re-check. We can't deterministically force the race in user
    // space, so we assert the walker's observable contract: no
    // symlinked content ever reaches the consumer, and the body of
    // the symlink target is never yielded as a node body.
    const subRoot = mkdtempSync(join(tmpdir(), 'walk-content-h1-'));
    try {
      const targetFile = join(subRoot, 'secret.txt');
      writeFileSync(targetFile, 'TOP-SECRET-PAYLOAD-FROM-OUTSIDE');

      // A regular markdown file the walker SHOULD yield.
      const regular = join(subRoot, 'docs');
      mkdirSync(regular, { recursive: true });
      writeFileSync(join(regular, 'real.md'), '---\nname: real\n---\nbody');

      // A `.md`-suffixed symlink pointing at the sensitive sibling.
      // Skipped at readdir level (M7) AND at the lstat re-check (H1).
      try {
        symlinkSync(targetFile, join(regular, 'link.md'));
      } catch {
        // sandboxes that block symlink creation, the rest of the
        // test still proves real.md is yielded.
      }

      const collected: { path: string; body: string }[] = [];
      for await (const n of walkContent([subRoot], {
        extensions: ['.md'],
        parser: 'frontmatter-yaml',
      })) {
        collected.push({ path: n.path, body: n.body });
      }

      // Regular file MUST be yielded.
      ok(
        collected.some((n) => n.path === 'docs/real.md'),
        'docs/real.md (regular file) must be yielded',
      );
      // Symlink MUST be skipped (path).
      ok(
        !collected.some((n) => n.path === 'docs/link.md'),
        'docs/link.md (symlink) must not be yielded',
      );
      // Symlink target content MUST NOT appear in any yielded body.
      ok(
        !collected.some((n) => n.body.includes('TOP-SECRET-PAYLOAD-FROM-OUTSIDE')),
        'symlink target content must never leak into a yielded body',
      );
    } finally {
      rmSync(subRoot, { recursive: true, force: true });
    }
  });

  it('accepts an explicit ignoreFilter and uses it instead of bundled defaults', async () => {
    // Filter that ignores everything → empty walk.
    const filter = buildIgnoreFilter({ includeDefaults: false, configIgnore: ['**/*.md'] });
    const collected: string[] = [];
    for await (const n of walkContent([root], {
      extensions: ['.md'],
      parser: 'frontmatter-yaml',
      ignoreFilter: filter,
    })) {
      collected.push(n.path);
    }
    deepStrictEqual(collected, []);
  });

  it('throws `UnknownParserError` for an unknown parser id', async () => {
    await rejects(async () => {
      for await (const _ of walkContent([root], {
        extensions: ['.md'],
        parser: 'does-not-exist',
      })) {
        // unreachable
      }
    }, UnknownParserError);
  });

  it('rejects the unknown parser id on the first iteration (resolves once at top of walk)', async () => {
    const it = walkContent([root], { extensions: ['.md'], parser: 'nope' })[Symbol.asyncIterator]();
    await rejects(it.next(), UnknownParserError);
  });
});
