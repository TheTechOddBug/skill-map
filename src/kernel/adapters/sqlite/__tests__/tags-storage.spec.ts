/**
 * Acceptance tests for the `port.tags` namespace (`scan_node_tags`),
 * pinning the SINGLE-SOURCE contract: tag rows are projected at persist
 * time from `node.sidecar.annotations.tags` ONLY. `frontmatter.tags` is
 * a RETIRED author source and MUST NOT contribute rows. Without this
 * guard a refactor could silently re-introduce the dual-source
 * projection and every other test would stay green.
 *
 * Also pins the flat record shape (`{ nodePath, tag }`, no `source`
 * discriminator) that replaced the old `{ byAuthor, byUser }` split.
 *
 * Per-test fixture path uses `mkdtempSync` ([[feedback_sqlite_in_memory_workaround]]
 * says `:memory:` doesn't work with the adapter's two-DatabaseSync design).
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deepStrictEqual } from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';

import { SqliteStorageAdapter } from '../index.js';
import type { Node, ScanResult } from '../../../types.js';

let tempRoot: string;

before(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'skill-map-tags-'));
});

after(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

function freshDbPath(name: string): string {
  return join(tempRoot, `${name}.db`);
}

function baseNode(over: Partial<Node>): Node {
  return {
    path: 'a.md',
    kind: 'skill',
    provider: 'claude',
    bodyHash: '0'.repeat(64),
    frontmatterHash: '0'.repeat(64),
    bytes: { frontmatter: 0, body: 0, total: 0 },
    frontmatter: {},
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
    ...over,
  };
}

function makeScanResult(nodes: Node[]): ScanResult {
  return {
    schemaVersion: 1,
    scannedAt: Date.now(),
    roots: ['.'],
    providers: ['claude'],
    scannedBy: { name: 'test', version: '0.0.0', specVersion: '0.0.0' },
    nodes,
    links: [],
    issues: [],
    stats: {
      filesWalked: nodes.length,
      filesSkipped: 0,
      nodesCount: nodes.length,
      linksCount: 0,
      issuesCount: 0,
      durationMs: 0,
    },
  };
}

describe('port.tags single-source projection (scan_node_tags)', () => {
  it('persists tags from sidecar.annotations.tags and IGNORES frontmatter.tags', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('single-source') });
    await adapter.init();
    try {
      // The node carries BOTH a sidecar tag and a (retired) frontmatter
      // tag. Only the sidecar tag may land in scan_node_tags.
      const node = baseNode({
        path: 'skills/dual.md',
        frontmatter: { name: 'dual', description: 'd', tags: ['from-frontmatter'] },
        sidecar: { present: true, status: 'fresh', annotations: { tags: ['from-sidecar', 'shared'] } },
      });
      await adapter.scans.persist(makeScanResult([node]));

      // Sidecar source: found.
      deepStrictEqual(await adapter.tags.findNodes('from-sidecar'), ['skills/dual.md']);
      deepStrictEqual(await adapter.tags.findNodes('shared'), ['skills/dual.md']);
      // Retired author source: never persisted.
      deepStrictEqual(await adapter.tags.findNodes('from-frontmatter'), []);

      // listForNode returns ONLY sidecar tags, sorted by tag, in the flat
      // `{ nodePath, tag }` shape (no `source` discriminator).
      const rows = await adapter.tags.listForNode('skills/dual.md');
      deepStrictEqual(rows, [
        { nodePath: 'skills/dual.md', tag: 'from-sidecar' },
        { nodePath: 'skills/dual.md', tag: 'shared' },
      ]);
    } finally {
      await adapter.close();
    }
  });

  it('a node with only frontmatter.tags and no sidecar contributes no rows', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('frontmatter-only') });
    await adapter.init();
    try {
      const node = baseNode({
        path: 'skills/ghost.md',
        frontmatter: { name: 'ghost', description: 'd', tags: ['ghost-tag'] },
      });
      await adapter.scans.persist(makeScanResult([node]));

      deepStrictEqual(await adapter.tags.findNodes('ghost-tag'), []);
      deepStrictEqual(await adapter.tags.listForNode('skills/ghost.md'), []);
    } finally {
      await adapter.close();
    }
  });

  it('findNodes + listForPaths span multiple nodes sharing a sidecar tag', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('multi') });
    await adapter.init();
    try {
      const a = baseNode({
        path: 'a.md',
        sidecar: { present: true, status: 'fresh', annotations: { tags: ['shared', 'only-a'] } },
      });
      const b = baseNode({
        path: 'b.md',
        sidecar: { present: true, status: 'fresh', annotations: { tags: ['shared'] } },
      });
      await adapter.scans.persist(makeScanResult([a, b]));

      deepStrictEqual((await adapter.tags.findNodes('shared')).slice().sort(), ['a.md', 'b.md']);
      deepStrictEqual(await adapter.tags.findNodes('only-a'), ['a.md']);

      // Order across nodes is not contractual; sort locally and assert the
      // full set + flat shape.
      const rows = (await adapter.tags.listForPaths(['a.md', 'b.md']))
        .slice()
        .sort((x, y) => x.nodePath.localeCompare(y.nodePath) || x.tag.localeCompare(y.tag));
      deepStrictEqual(rows, [
        { nodePath: 'a.md', tag: 'only-a' },
        { nodePath: 'a.md', tag: 'shared' },
        { nodePath: 'b.md', tag: 'shared' },
      ]);
    } finally {
      await adapter.close();
    }
  });
});
