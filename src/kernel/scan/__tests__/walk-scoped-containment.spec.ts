/**
 * Audit H4: the symlink containment gate (audit M1) guarded only the
 * TRAVERSAL walk. The scoped read, which the watcher's incremental pass
 * drives, checked containment with a pure string comparison, so a path
 * reached THROUGH an escaping directory symlink was lexically interior
 * and got read: `docs/link/secret.md` where `link -> /outside`.
 *
 * The leaf case (`notes.md -> /outside/secret`) happened to be refused,
 * but only because the pre-read `lstat` rejects any symlink, a TOCTOU
 * guard, not a containment gate. That accident is why the state was
 * fragile: the moment someone taught the scoped path to follow
 * legitimate in-tree links (which traversal already does), the leaf hole
 * would have opened silently.
 *
 * The two walks now agree: resolve the real target, refuse it when it
 * escapes every root, follow it when it does not.
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { walkContent, type IWalkContentOptions } from '../walk-content.js';

const skipSymlinkTests = platform() === 'win32';

let scratch: string;
let root: string;
let outside: string;

before(() => {
  scratch = mkdtempSync(join(tmpdir(), 'sm-walk-scoped-'));
  root = join(scratch, 'project');
  outside = join(scratch, 'outside');
  mkdirSync(join(root, 'docs'), { recursive: true });
  mkdirSync(outside, { recursive: true });

  writeFileSync(join(root, 'docs', 'ok.md'), 'benign\n');
  writeFileSync(join(outside, 'secret.md'), 'SUPER SECRET CONTENT\n');
  mkdirSync(join(root, 'inside-target'), { recursive: true });
  writeFileSync(join(root, 'inside-target', 'shared.md'), 'legitimate\n');

  if (skipSymlinkTests) return;
  // Escaping DIRECTORY link: the case the string check missed entirely.
  symlinkSync(outside, join(root, 'docs', 'escapelink'));
  // Escaping FILE link: refused before by accident, refused now by the gate.
  symlinkSync(join(outside, 'secret.md'), join(root, 'docs', 'leak.md'));
  // Contained link: must still be followed, traversal follows it too.
  symlinkSync(join(root, 'inside-target'), join(root, 'docs', 'innerlink'));
});

after(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const BASE: IWalkContentOptions = { parser: 'frontmatter-yaml', extensions: ['.md'] };

async function collect(options: IWalkContentOptions): Promise<string[]> {
  const out: string[] = [];
  for await (const node of walkContent([root], options)) out.push(node.path);
  return out.sort();
}

/** Scoped walk over exactly the given absolute paths. */
async function scoped(paths: string[], extra: Partial<IWalkContentOptions> = {}): Promise<string[]> {
  return collect({ ...BASE, ...extra, scopedPaths: paths });
}

describe('scoped walk, symlink containment (audit H4)', () => {
  it('refuses a path reached THROUGH an escaping directory symlink', { skip: skipSymlinkTests }, async () => {
    const target = join(root, 'docs', 'escapelink', 'secret.md');
    assert.deepEqual(await scoped([target]), []);
  });

  it('refuses an escaping leaf symlink', { skip: skipSymlinkTests }, async () => {
    assert.deepEqual(await scoped([join(root, 'docs', 'leak.md')]), []);
  });

  it('still reads an ordinary contained file', async () => {
    assert.deepEqual(await scoped([join(root, 'docs', 'ok.md')]), ['docs/ok.md']);
  });

  it('follows a CONTAINED symlink, matching the traversal walk', { skip: skipSymlinkTests }, async () => {
    const via = join(root, 'docs', 'innerlink', 'shared.md');
    assert.deepEqual(await scoped([via]), ['docs/innerlink/shared.md']);
  });

  it('honours followExternalSymlinks for an operator who opted in', { skip: skipSymlinkTests }, async () => {
    const target = join(root, 'docs', 'escapelink', 'secret.md');
    assert.deepEqual(await scoped([target], { followExternalSymlinks: true }), [
      'docs/escapelink/secret.md',
    ]);
  });

  it('agrees with the traversal walk on the same tree', { skip: skipSymlinkTests }, async () => {
    // The positive control: traversal already refused both escapes. The
    // scoped walk over the same set must reach the same verdict, which is
    // the invariant this whole fix exists to restore.
    const traversed = await collect(BASE);
    assert.ok(!traversed.some((p) => p.includes('escapelink')), traversed.join(', '));
    assert.ok(!traversed.includes('docs/leak.md'), traversed.join(', '));

    const everything = await scoped([
      join(root, 'docs', 'ok.md'),
      join(root, 'docs', 'leak.md'),
      join(root, 'docs', 'escapelink', 'secret.md'),
    ]);
    assert.deepEqual(everything, ['docs/ok.md']);
  });

  it('reuses one containment verdict per directory across calls', { skip: skipSymlinkTests }, async () => {
    // The shared cache is what keeps the gate off the hot path; a stale
    // or per-call cache would still be correct but would cost a realpath
    // per file per provider.
    const cache = new Map<string, boolean>();
    const files = [join(root, 'docs', 'ok.md'), join(root, 'docs', 'escapelink', 'secret.md')];
    await scoped(files, { scopedContainmentCache: cache });
    const afterFirst = new Map(cache);
    await scoped(files, { scopedContainmentCache: cache });

    assert.deepEqual([...cache.entries()].sort(), [...afterFirst.entries()].sort());
    assert.equal(cache.get(join(root, 'docs')), true);
    assert.equal(cache.get(join(root, 'docs', 'escapelink')), false);
  });
});
