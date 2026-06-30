import { describe, it, before, after } from 'node:test';
import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { walkContent, UnknownParserError } from '../walk-content.js';
import { buildIgnoreFilter } from '../ignore.js';
import type { IRawNode } from '../../extensions/provider.js';

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

  // Codex-flavoured TOML: the markdown prompt lives in the
  // `developer_instructions` field, exercised by the `read.bodyField` path.
  write(
    'agents/codex.toml',
    [
      'name = "codex"',
      'description = "a codex agent"',
      'developer_instructions = "read docs/guide.md, ask @helper"',
    ].join('\n'),
  );

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

  it('stamps each node with the file mtime in whole Unix ms', async () => {
    for await (const n of walkContent([root], {
      extensions: ['.md'],
      parser: 'frontmatter-yaml',
    })) {
      ok(typeof n.modifiedAtMs === 'number', `${n.path} carries a numeric mtime`);
      ok(n.modifiedAtMs! > 0, `${n.path} mtime is positive`);
      strictEqual(n.modifiedAtMs, Math.round(n.modifiedAtMs!), `${n.path} mtime is integral`);
    }
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
    collected.sort();
    deepStrictEqual(collected, ['agents/codex.toml', 'docs/a.toml']);
  });

  it('sources the node body from read.bodyField when the field is a string', async () => {
    const byPath = new Map<string, IRawNode>();
    for await (const n of walkContent([root], {
      extensions: ['.toml'],
      parser: 'toml',
      bodyField: 'developer_instructions',
    })) {
      byPath.set(n.path, n);
    }
    const codex = byPath.get('agents/codex.toml');
    ok(codex, 'agents/codex.toml must be yielded under extensions: [".toml"]');
    // The TOML `developer_instructions` field becomes the node body (Codex prompts).
    strictEqual(codex!.body, 'read docs/guide.md, ask @helper');
    // The field stays in frontmatter too, so frontmatter-scoped extractors
    // (e.g. core/mcp-tools reading `tools`) are unaffected.
    strictEqual(codex!.frontmatter['developer_instructions'], 'read docs/guide.md, ask @helper');
    // A TOML file without the field falls back to the parser body (empty).
    strictEqual(byPath.get('docs/a.toml')!.body, '');
  });

  it('falls back to the parser body when bodyField is absent', async () => {
    let codexBody: string | null = null;
    for await (const n of walkContent([root], {
      extensions: ['.toml'],
      parser: 'toml',
    })) {
      if (n.path === 'agents/codex.toml') codexBody = n.body;
    }
    // No bodyField → the toml parser's own (empty) body is used unchanged.
    strictEqual(codexBody, '');
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

  it('skips files larger than maxFileSizeBytes and fires onOversizedFile (path + bytes)', async () => {
    const sub = mkdtempSync(join(tmpdir(), 'walk-content-size-'));
    try {
      // Small file (under the limit) and a big file (over it). The big
      // file carries a sentinel body, the test asserts that sentinel
      // never reaches a yielded node (the walker must not read it).
      const small = '---\nname: small\n---\ntiny body';
      writeFileSync(join(sub, 'small.md'), small);
      const big = '---\nname: big\n---\n' + 'X'.repeat(4096);
      writeFileSync(join(sub, 'big.md'), big);

      const oversized: { path: string; bytes: number }[] = [];
      const collected: { path: string; body: string }[] = [];
      for await (const n of walkContent([sub], {
        extensions: ['.md'],
        parser: 'frontmatter-yaml',
        maxFileSizeBytes: 1024,
        onOversizedFile: (info) => oversized.push(info),
      })) {
        collected.push({ path: n.path, body: n.body });
      }

      // Small file yielded, big file skipped.
      deepStrictEqual(collected.map((n) => n.path), ['small.md']);
      // Skipped file content never read into a yielded body.
      ok(
        !collected.some((n) => n.body.includes('XXXX')),
        'oversized file body must never be read / yielded',
      );
      // onOversizedFile fired once with the root-relative path + real bytes.
      strictEqual(oversized.length, 1);
      strictEqual(oversized[0]!.path, 'big.md');
      strictEqual(oversized[0]!.bytes, Buffer.byteLength(big));
    } finally {
      rmSync(sub, { recursive: true, force: true });
    }
  });

  it('does NOT skip a file whose size is exactly at the limit', async () => {
    const sub = mkdtempSync(join(tmpdir(), 'walk-content-size-eq-'));
    try {
      // Body sized so the on-disk file is EXACTLY 1024 bytes; the guard
      // is strictly-greater-than, so an equal-size file is kept.
      const prefix = '---\nname: eq\n---\n';
      const body = 'Y'.repeat(1024 - Buffer.byteLength(prefix));
      const content = prefix + body;
      writeFileSync(join(sub, 'eq.md'), content);
      strictEqual(Buffer.byteLength(content), 1024);

      const oversized: { path: string; bytes: number }[] = [];
      const collected: string[] = [];
      for await (const n of walkContent([sub], {
        extensions: ['.md'],
        parser: 'frontmatter-yaml',
        maxFileSizeBytes: 1024,
        onOversizedFile: (info) => oversized.push(info),
      })) {
        collected.push(n.path);
      }
      deepStrictEqual(collected, ['eq.md']);
      deepStrictEqual(oversized, []);
    } finally {
      rmSync(sub, { recursive: true, force: true });
    }
  });

  it('applies no size limit when maxFileSizeBytes is absent', async () => {
    const sub = mkdtempSync(join(tmpdir(), 'walk-content-size-off-'));
    try {
      writeFileSync(join(sub, 'big.md'), '---\nname: big\n---\n' + 'Z'.repeat(8192));
      const collected: string[] = [];
      for await (const n of walkContent([sub], {
        extensions: ['.md'],
        parser: 'frontmatter-yaml',
      })) {
        collected.push(n.path);
      }
      deepStrictEqual(collected, ['big.md']);
    } finally {
      rmSync(sub, { recursive: true, force: true });
    }
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

describe('walkContent, incremental priorMtimes fast path', () => {
  /** Capture the current on-disk mtimes via a plain (non-incremental) walk. */
  async function captureMtimes(): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    for await (const n of walkContent([root], { extensions: ['.md'], parser: 'frontmatter-yaml' })) {
      map.set(n.path, n.modifiedAtMs!);
    }
    return map;
  }

  it('yields an `unchanged` record (no body read) when a file mtime matches priorMtimes', async () => {
    const priorMtimes = await captureMtimes();
    const byPath = new Map<string, IRawNode>();
    for await (const n of walkContent([root], {
      extensions: ['.md'],
      parser: 'frontmatter-yaml',
      priorMtimes,
    })) {
      byPath.set(n.path, n);
    }

    const a = byPath.get('docs/a.md');
    ok(a, 'docs/a.md yielded');
    strictEqual(a!.unchanged, true, 'matching mtime marks the record unchanged');
    strictEqual(a!.body, '', 'unchanged record carries no body (read was skipped)');
    deepStrictEqual(a!.frontmatter, {}, 'unchanged record carries empty frontmatter');
    strictEqual(typeof a!.reread, 'function', 'unchanged record exposes a lazy reread');
  });

  it('reread() pulls the real body + frontmatter on demand', async () => {
    const priorMtimes = await captureMtimes();
    for await (const n of walkContent([root], {
      extensions: ['.md'],
      parser: 'frontmatter-yaml',
      priorMtimes,
    })) {
      if (n.path !== 'docs/a.md') continue;
      const re = await n.reread!();
      strictEqual((re.frontmatter as { name?: string }).name, 'a');
      strictEqual((re.frontmatter as { description?: string }).description, 'alpha');
      strictEqual(re.body.trim(), 'body of a');
      return;
    }
    ok(false, 'docs/a.md not yielded');
  });

  it('reads the body normally when the mtime does NOT match (changed file)', async () => {
    // A deliberately stale mtime for one file forces the full read path.
    const stale = new Map<string, number>([['docs/a.md', 1]]);
    for await (const n of walkContent([root], {
      extensions: ['.md'],
      parser: 'frontmatter-yaml',
      priorMtimes: stale,
    })) {
      if (n.path !== 'docs/a.md') continue;
      ok(n.unchanged !== true, 'a mismatched mtime is not marked unchanged');
      strictEqual(n.body.trim(), 'body of a', 'the body is read for a changed file');
      return;
    }
    ok(false, 'docs/a.md not yielded');
  });

  it('treats a file absent from priorMtimes as new (full read)', async () => {
    // Only b.md is known; a.md + c.md are new to the prior and must read.
    const partial = new Map<string, number>();
    const all = await captureMtimes();
    partial.set('docs/b.md', all.get('docs/b.md')!);
    for await (const n of walkContent([root], {
      extensions: ['.md'],
      parser: 'frontmatter-yaml',
      priorMtimes: partial,
    })) {
      if (n.path === 'docs/a.md') {
        ok(n.unchanged !== true, 'a.md (not in priorMtimes) reads fully');
      }
      if (n.path === 'docs/b.md') {
        strictEqual(n.unchanged, true, 'b.md (mtime match) is skipped');
      }
    }
  });

  it('reads every file when priorMtimes is absent (full-scan default)', async () => {
    for await (const n of walkContent([root], { extensions: ['.md'], parser: 'frontmatter-yaml' })) {
      ok(n.unchanged !== true, `${n.path} is a full record without priorMtimes`);
    }
  });
});

describe('walkContent, followSymlinks', () => {
  const mkRoot = (): string => mkdtempSync(join(tmpdir(), 'walk-symlink-'));
  const write = (abs: string, content: string): void => {
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  };
  // Create a symlink, returning false when the sandbox forbids it so the
  // test degrades to a no-op rather than a spurious failure (CI on Linux
  // always succeeds and exercises the assertions).
  const link = (target: string, path: string): boolean => {
    try {
      symlinkSync(target, path);
      return true;
    } catch {
      return false;
    }
  };
  const collect = async (scope: string, followSymlinks: boolean): Promise<string[]> => {
    const out: string[] = [];
    for await (const n of walkContent([scope], {
      extensions: ['.md'],
      parser: 'frontmatter-yaml',
      followSymlinks,
    })) {
      out.push(n.path);
    }
    return out.sort();
  };

  it('follows a symlinked directory when enabled (the .claude/skills softlink case)', async () => {
    const dir = mkRoot();
    try {
      write(join(dir, 'a/skills/one.md'), '---\nname: one\n---\nbody');
      mkdirSync(join(dir, '.claude'), { recursive: true });
      // Relative dir symlink whose target resolves inside the root.
      if (!link('../a/skills', join(dir, '.claude/skills'))) return;
      const collected = await collect(dir, true);
      ok(
        collected.includes('.claude/skills/one.md'),
        'a file behind the symlinked directory is yielded under the link path',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips a symlinked directory by default (followSymlinks off)', async () => {
    const dir = mkRoot();
    try {
      write(join(dir, 'a/skills/one.md'), '---\nname: one\n---\nbody');
      mkdirSync(join(dir, '.claude'), { recursive: true });
      if (!link('../a/skills', join(dir, '.claude/skills'))) return;
      const collected = await collect(dir, false);
      ok(
        !collected.includes('.claude/skills/one.md'),
        'the symlinked directory is not traversed when the flag is off',
      );
      ok(collected.includes('a/skills/one.md'), 'the real target dir is still walked as usual');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips a broken symlink without throwing (enabled)', async () => {
    const dir = mkRoot();
    try {
      mkdirSync(join(dir, '.claude'), { recursive: true });
      if (!link('../a/does-not-exist', join(dir, '.claude/skills'))) return;
      write(join(dir, 'real.md'), '---\nname: real\n---\nbody');
      const collected = await collect(dir, true);
      deepStrictEqual(collected, ['real.md']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a symlink whose target escapes the roots (realpath containment, enabled)', async () => {
    const dir = mkRoot();
    const outside = mkdtempSync(join(tmpdir(), 'walk-symlink-out-'));
    try {
      write(join(outside, 'secret.md'), '---\nname: secret\n---\nLEAK');
      write(join(dir, 'real.md'), '---\nname: real\n---\nbody');
      // Absolute symlink pointing OUT of the walked root.
      if (!link(outside, join(dir, 'escape'))) return;
      const collected: { path: string; body: string }[] = [];
      for await (const n of walkContent([dir], {
        extensions: ['.md'],
        parser: 'frontmatter-yaml',
        followSymlinks: true,
      })) {
        collected.push({ path: n.path, body: n.body });
      }
      ok(
        !collected.some((n) => n.path.startsWith('escape/')),
        'the escaping symlink directory is never traversed',
      );
      ok(
        !collected.some((n) => n.body.includes('LEAK')),
        'out-of-root content never leaks through a followed symlink',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('terminates on a symlink cycle (enabled)', async () => {
    const dir = mkRoot();
    try {
      write(join(dir, 'a/one.md'), '---\nname: one\n---\nbody');
      // `a/back` points back at its own parent dir `a`: a one-step cycle.
      // If cycle detection regressed this would recurse forever; the test
      // merely completing proves termination.
      if (!link('../a', join(dir, 'a/back'))) return;
      const collected = await collect(dir, true);
      ok(collected.includes('a/one.md'), 'the real file is yielded');
      ok(collected.length <= 2, 'the cycle is bounded, not infinite');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('follows a symlinked file to its target body when enabled', async () => {
    const dir = mkRoot();
    try {
      write(join(dir, 'real.md'), '---\nname: real\n---\nshared body');
      if (!link('real.md', join(dir, 'link.md'))) return;
      const collected: { path: string; body: string }[] = [];
      for await (const n of walkContent([dir], {
        extensions: ['.md'],
        parser: 'frontmatter-yaml',
        followSymlinks: true,
      })) {
        collected.push({ path: n.path, body: n.body });
      }
      const linked = collected.find((n) => n.path === 'link.md');
      ok(linked, 'the symlinked file is yielded under its link path');
      strictEqual(linked?.body.trim(), 'shared body', 'it resolves to the target body');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Scoped reads are the watcher's incremental path. They must honour the
  // same symlink policy as the full traversal, since chokidar can surface a
  // changed file behind a symlink regardless of any watcher option.
  const collectScoped = async (
    scope: string,
    scopedPaths: string[],
    followSymlinks: boolean,
  ): Promise<{ path: string; body: string }[]> => {
    const out: { path: string; body: string }[] = [];
    for await (const n of walkContent([scope], {
      extensions: ['.md'],
      parser: 'frontmatter-yaml',
      scopedPaths,
      followSymlinks,
    })) {
      out.push({ path: n.path, body: n.body });
    }
    return out;
  };

  it('scoped read drops a path crossing a symlinked directory when disabled', async () => {
    const dir = mkRoot();
    try {
      write(join(dir, 'a/skills/one.md'), '---\nname: one\n---\nbody');
      mkdirSync(join(dir, '.claude'), { recursive: true });
      if (!link('../a/skills', join(dir, '.claude/skills'))) return;
      const collected = await collectScoped(dir, [join(dir, '.claude/skills/one.md')], false);
      deepStrictEqual(collected, [], 'the symlink-crossing scoped path is not read when off');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('scoped read follows a path through a symlinked directory when enabled', async () => {
    const dir = mkRoot();
    try {
      write(join(dir, 'a/skills/one.md'), '---\nname: one\n---\nbody');
      mkdirSync(join(dir, '.claude'), { recursive: true });
      if (!link('../a/skills', join(dir, '.claude/skills'))) return;
      const collected = await collectScoped(dir, [join(dir, '.claude/skills/one.md')], true);
      deepStrictEqual(
        collected.map((n) => n.path),
        ['.claude/skills/one.md'],
        'the scoped path is read under the link form when on',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('scoped read refuses a path escaping the roots via a symlink (enabled)', async () => {
    const dir = mkRoot();
    const outside = mkdtempSync(join(tmpdir(), 'walk-symlink-out-'));
    try {
      write(join(outside, 'secret.md'), '---\nname: secret\n---\nLEAK');
      if (!link(outside, join(dir, 'escape'))) return;
      const collected = await collectScoped(dir, [join(dir, 'escape/secret.md')], true);
      ok(
        !collected.some((n) => n.body.includes('LEAK')),
        'an escaping scoped path never leaks out-of-root content',
      );
      deepStrictEqual(collected, [], 'the escaping scoped path yields nothing');
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
