/**
 * `findFolder` + `collectLeafPaths`, the folder-resolution helpers behind
 * the files-view map-visibility cascade. Both are pure tree walks over the
 * `ITreeFolder` produced by `buildTree`, so they test against a small
 * `INodeView[]` fixture (root file, one-deep, two-deep, plus a sibling
 * branch) with no Angular harness.
 *
 * The node fixture factory mirrors `files-view.rows.spec.ts` (`makeNode`),
 * the sibling spec for the same module.
 */

import { describe, expect, it } from 'vitest';

import { buildTree, collectLeafPaths, findFolder } from '../files-view.rows';
import type { INodeView } from '../../../../models/node';

function makeNode(path: string, name?: string): INodeView {
  return {
    path,
    kind: 'agent',
    frontmatter: { name, description: '', metadata: { version: '1.0.0' } },
  } as unknown as INodeView;
}

/**
 * Fixture covering every depth shape findFolder / collectLeafPaths care about:
 *   - root.md            -> root file (folder path '')
 *   - docs/intro.md      -> one-deep
 *   - docs/guides/a.md   -> two-deep
 *   - docs/guides/b.md   -> two-deep sibling leaf
 *   - src/index.md       -> sibling branch (its own subtree)
 */
const NODES: readonly INodeView[] = [
  makeNode('root.md', 'root'),
  makeNode('docs/intro.md', 'intro'),
  makeNode('docs/guides/a.md', 'a'),
  makeNode('docs/guides/b.md', 'b'),
  makeNode('src/index.md', 'index'),
];

const TREE = buildTree(NODES);

describe('findFolder', () => {
  it("resolves the root for the empty path ''", () => {
    const root = findFolder(TREE, '');
    expect(root).toBe(TREE);
    expect(root?.path).toBe('');
  });

  it('resolves a one-deep folder path', () => {
    const docs = findFolder(TREE, 'docs');
    expect(docs).not.toBeNull();
    expect(docs?.path).toBe('docs');
    expect(docs?.name).toBe('docs');
  });

  it('resolves a nested (two-deep) folder path', () => {
    const guides = findFolder(TREE, 'docs/guides');
    expect(guides).not.toBeNull();
    expect(guides?.path).toBe('docs/guides');
    expect(guides?.name).toBe('guides');
    // Holds exactly the two leaves authored under it.
    expect(guides?.leaves.map((leaf) => leaf.path).sort()).toEqual([
      'docs/guides/a.md',
      'docs/guides/b.md',
    ]);
  });

  it('returns null for a path that does not exist in the tree', () => {
    expect(findFolder(TREE, 'does/not/exist')).toBeNull();
    // Partial-match miss: 'docs' exists but 'docs/missing' does not.
    expect(findFolder(TREE, 'docs/missing')).toBeNull();
  });
});

describe('collectLeafPaths', () => {
  it('gathers every descendant leaf path of a folder, recursing into subfolders', () => {
    const docs = findFolder(TREE, 'docs');
    expect(docs).not.toBeNull();
    expect(collectLeafPaths(docs!).sort()).toEqual([
      'docs/guides/a.md',
      'docs/guides/b.md',
      'docs/intro.md',
    ]);
  });

  it('gathers every leaf in the whole project when called on the root', () => {
    expect(collectLeafPaths(TREE).sort()).toEqual([
      'docs/guides/a.md',
      'docs/guides/b.md',
      'docs/intro.md',
      'root.md',
      'src/index.md',
    ]);
  });

  it('returns just the direct leaves for a leaf folder (no subfolders)', () => {
    const guides = findFolder(TREE, 'docs/guides');
    expect(guides).not.toBeNull();
    expect(guides?.subfolders.size).toBe(0);
    expect(collectLeafPaths(guides!).sort()).toEqual([
      'docs/guides/a.md',
      'docs/guides/b.md',
    ]);
  });

  it('returns the single direct leaf for a sibling branch with one file', () => {
    const src = findFolder(TREE, 'src');
    expect(src).not.toBeNull();
    expect(collectLeafPaths(src!)).toEqual(['src/index.md']);
  });
});
