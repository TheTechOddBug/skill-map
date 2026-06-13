/**
 * Round-trip tests for the kernel fields landed during the link-matrix
 * session: `Link.occurrences[]`, `Link.resolvedTarget`,
 * `Node.externalRefs[]`. Each field has its own emit + dedup path in
 * the orchestrator; this spec pins the PERSISTENCE seam so a refactor
 * of `linkToRow` / `rowToLink` / `nodeToRow` / `rowToNode` cannot drop
 * one of the columns without a red CI.
 *
 * Why a dedicated spec: the analyzer unit tests synthesise the fields
 * inline and never hit the DB; the integration scan-e2e test asserts
 * confidence lift end-to-end but not these specific columns. This
 * file fills that gap with a minimal "persist + load + assert" loop
 * per field.
 *
 * Per-test fixture path uses `mkdtempSync` ([[feedback_sqlite_in_memory_workaround]]
 * says `:memory:` doesn't work with the adapter's two-DatabaseSync
 * design).
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strictEqual, ok, deepStrictEqual } from 'node:assert';
import { describe, it, before, after } from 'node:test';

import { SqliteStorageAdapter } from '../index.js';
import type { Link, Node, ScanResult } from '../../../types.js';

let tempRoot: string;

before(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'skill-map-round-trip-'));
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
    kind: 'agent',
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

function baseLink(over: Partial<Link>): Link {
  return {
    source: 'a.md',
    target: 'b.md',
    kind: 'references',
    confidence: 1.0,
    sources: ['markdown-link'],
    ...over,
  };
}

function makeScanResult(nodes: Node[], links: Link[]): ScanResult {
  return {
    schemaVersion: 1,
    scannedAt: Date.now(),
    roots: ['.'],
    providers: ['claude'],
    scannedBy: { name: 'test', version: '0.0.0', specVersion: '0.0.0' },
    nodes,
    links,
    issues: [],
    stats: {
      filesWalked: nodes.length,
      filesSkipped: 0,
      nodesCount: nodes.length,
      linksCount: links.length,
      issuesCount: 0,
      durationMs: 0,
    },
  };
}

describe('persistence round-trip for link-matrix fields', () => {
  it('persists and re-reads `Link.occurrences[]` verbatim', async () => {
    const path = freshDbPath('link-occurrences');
    const adapter = new SqliteStorageAdapter({ databasePath: path });
    await adapter.init();
    try {
      const src = baseNode({ path: 'src.md' });
      const tgt = baseNode({ path: 'tgt.md' });
      // Two occurrences from two extractors on the same merged edge,
      // mirroring what `dedupeLinks` produces when `@./tgt.md` (from
      // `at-directive`) and `[label](./tgt.md)` (from `markdown-link`)
      // converge on the same `(source, target, kind, normalizedTrigger)`.
      const link = baseLink({
        source: src.path,
        target: tgt.path,
        sources: ['at-directive', 'markdown-link'],
        trigger: { originalTrigger: '@./tgt.md', normalizedTrigger: 'tgt.md' },
        occurrences: [
          { extractor: 'at-directive', originalTrigger: '@./tgt.md', location: { line: 3 } },
          { extractor: 'markdown-link', originalTrigger: './tgt.md', location: { line: 8 } },
        ],
      });
      await adapter.scans.persist(makeScanResult([src, tgt], [link]));

      const loaded = await adapter.scans.load();
      ok(loaded, 'expected a loaded ScanResult');
      strictEqual(loaded.links.length, 1);
      const round = loaded.links[0]!;
      ok(round.occurrences, 'occurrences must round-trip');
      strictEqual(round.occurrences.length, 2);
      deepStrictEqual(round.occurrences, link.occurrences);
    } finally {
      await adapter.close();
    }
  });

  it('drops the `occurrences` field entirely when the source link omits it', async () => {
    // Legacy emit paths (frontmatter-driven, sidecar-derived) do not
    // populate occurrences. The persistence layer MUST emit `NULL` so
    // the round-tripped Link stays free of the field (consumers
    // distinguish "absent array" from "empty array").
    const path = freshDbPath('link-no-occurrences');
    const adapter = new SqliteStorageAdapter({ databasePath: path });
    await adapter.init();
    try {
      const src = baseNode({ path: 'src.md' });
      const tgt = baseNode({ path: 'tgt.md' });
      const link = baseLink({ source: src.path, target: tgt.path });
      await adapter.scans.persist(makeScanResult([src, tgt], [link]));

      const loaded = await adapter.scans.load();
      ok(loaded);
      strictEqual(loaded.links[0]?.occurrences, undefined);
    } finally {
      await adapter.close();
    }
  });

  it('persists and re-reads `Link.resolvedTarget` verbatim', async () => {
    const path = freshDbPath('link-resolved-target');
    const adapter = new SqliteStorageAdapter({ databasePath: path });
    await adapter.init();
    try {
      const src = baseNode({ path: '.claude/agents/hub.md' });
      const tgt = baseNode({
        path: '.claude/agents/real-agent.md',
        frontmatter: { name: 'real-agent' },
      });
      // Trigger-style mention link: `link.target` keeps the authored
      // sigil + name; `link.resolvedTarget` records what the post-walk
      // lift bound it to (the agent's node path). The BFF's incoming
      // query matches on EITHER column.
      const link = baseLink({
        source: src.path,
        target: '@real-agent',
        kind: 'mentions',
        confidence: 1.0,
        sources: ['at-directive'],
        trigger: { originalTrigger: '@real-agent', normalizedTrigger: '@real agent' },
        resolvedTarget: tgt.path,
      });
      await adapter.scans.persist(makeScanResult([src, tgt], [link]));

      const loaded = await adapter.scans.load();
      ok(loaded);
      strictEqual(loaded.links.length, 1);
      const round = loaded.links[0]!;
      strictEqual(round.target, '@real-agent', 'target column keeps the authored trigger');
      strictEqual(round.resolvedTarget, tgt.path, 'resolvedTarget round-trips');
    } finally {
      await adapter.close();
    }
  });

  it('leaves `resolvedTarget` unset for unresolved (broken) links', async () => {
    const path = freshDbPath('link-broken-resolved');
    const adapter = new SqliteStorageAdapter({ databasePath: path });
    await adapter.init();
    try {
      const src = baseNode({ path: 'src.md' });
      // Broken link: `target` is a trigger that resolves nowhere; the
      // lift transform never wrote `resolvedTarget`, so the column
      // stays NULL and the round-tripped Link has the field absent.
      const link = baseLink({
        source: src.path,
        target: '@ghost',
        kind: 'mentions',
        confidence: 0.5,
        sources: ['at-directive'],
        trigger: { originalTrigger: '@ghost', normalizedTrigger: '@ghost' },
      });
      await adapter.scans.persist(makeScanResult([src], [link]));

      const loaded = await adapter.scans.load();
      ok(loaded);
      strictEqual(loaded.links[0]?.resolvedTarget, undefined);
    } finally {
      await adapter.close();
    }
  });

  it('persists and re-reads `Node.externalRefs[]` verbatim', async () => {
    const path = freshDbPath('node-external-refs');
    const adapter = new SqliteStorageAdapter({ databasePath: path });
    await adapter.init();
    try {
      const node = baseNode({
        path: 'README.md',
        kind: 'markdown',
        provider: 'core',
        externalRefsCount: 2,
        externalRefs: [
          { url: 'https://example.com/', line: 12, originalTrigger: 'https://example.com' },
          {
            url: 'https://docs.example.com/v1',
            line: 45,
            originalTrigger: 'https://docs.example.com/v1',
          },
        ],
      });
      await adapter.scans.persist(makeScanResult([node], []));

      const loaded = await adapter.scans.load();
      ok(loaded);
      strictEqual(loaded.nodes.length, 1);
      const round = loaded.nodes[0]!;
      ok(round.externalRefs, 'externalRefs must round-trip');
      strictEqual(round.externalRefs.length, 2);
      deepStrictEqual(round.externalRefs, node.externalRefs);
      strictEqual(
        round.externalRefsCount,
        round.externalRefs.length,
        'count and array length agree (denormalisation invariant)',
      );
    } finally {
      await adapter.close();
    }
  });

  it('drops `Node.externalRefs[]` when the source node has no URLs in its body', async () => {
    const path = freshDbPath('node-no-external-refs');
    const adapter = new SqliteStorageAdapter({ databasePath: path });
    await adapter.init();
    try {
      const node = baseNode({ path: 'plain.md', externalRefsCount: 0 });
      await adapter.scans.persist(makeScanResult([node], []));

      const loaded = await adapter.scans.load();
      ok(loaded);
      strictEqual(loaded.nodes[0]?.externalRefs, undefined);
      strictEqual(loaded.nodes[0]?.externalRefsCount, 0);
    } finally {
      await adapter.close();
    }
  });

  it('persists and re-reads `Node.modifiedAtMs` verbatim', async () => {
    const path = freshDbPath('node-modified-at');
    const adapter = new SqliteStorageAdapter({ databasePath: path });
    await adapter.init();
    try {
      const node = baseNode({ path: 'a.md', modifiedAtMs: 1_749_823_967_000 });
      await adapter.scans.persist(makeScanResult([node], []));

      const loaded = await adapter.scans.load();
      ok(loaded);
      strictEqual(loaded.nodes[0]?.modifiedAtMs, 1_749_823_967_000);
    } finally {
      await adapter.close();
    }
  });

  it('leaves `Node.modifiedAtMs` absent when the source node carries no mtime (NULL column)', async () => {
    const path = freshDbPath('node-no-modified-at');
    const adapter = new SqliteStorageAdapter({ databasePath: path });
    await adapter.init();
    try {
      // `baseNode` omits `modifiedAtMs`; `nodeToRow` writes NULL and the
      // loader maps NULL back to an absent domain field (virtual nodes).
      const node = baseNode({ path: 'virtual.md' });
      await adapter.scans.persist(makeScanResult([node], []));

      const loaded = await adapter.scans.load();
      ok(loaded);
      strictEqual(loaded.nodes[0]?.modifiedAtMs, undefined);
    } finally {
      await adapter.close();
    }
  });
});

describe('persistence round-trip for the file-size skip envelope', () => {
  it('persists and re-reads `oversizedFiles` + `stats.filesOversized` through scan_meta', async () => {
    const path = freshDbPath('scan-meta-oversized');
    const adapter = new SqliteStorageAdapter({ databasePath: path });
    await adapter.init();
    try {
      const node = baseNode({ path: 'a.md' });
      const result = makeScanResult([node], []);
      result.oversizedFiles = [
        { path: 'assets/huge.bin.md', bytes: 5_242_880 },
        { path: 'docs/generated.md', bytes: 2_097_152 },
      ];
      result.stats.filesOversized = result.oversizedFiles.length;
      await adapter.scans.persist(result);

      const loaded = await adapter.scans.load();
      ok(loaded);
      deepStrictEqual(loaded.oversizedFiles, result.oversizedFiles);
      strictEqual(loaded.stats.filesOversized, 2);
    } finally {
      await adapter.close();
    }
  });

  it('returns an empty `oversizedFiles` and `filesOversized: 0` when no file was skipped', async () => {
    const path = freshDbPath('scan-meta-no-oversized');
    const adapter = new SqliteStorageAdapter({ databasePath: path });
    await adapter.init();
    try {
      const node = baseNode({ path: 'a.md' });
      await adapter.scans.persist(makeScanResult([node], []));

      const loaded = await adapter.scans.load();
      ok(loaded);
      deepStrictEqual(loaded.oversizedFiles, []);
      strictEqual(loaded.stats.filesOversized, 0);
    } finally {
      await adapter.close();
    }
  });

  it('round-trips the resolved `tokenizer` name through scan_meta', async () => {
    const path = freshDbPath('scan-meta-tokenizer');
    const adapter = new SqliteStorageAdapter({ databasePath: path });
    await adapter.init();
    try {
      const node = baseNode({ path: 'a.md' });
      const result = makeScanResult([node], []);
      result.tokenizer = 'o200k_base';
      await adapter.scans.persist(result);

      const loaded = await adapter.scans.load();
      ok(loaded);
      strictEqual(loaded.tokenizer, 'o200k_base');
    } finally {
      await adapter.close();
    }
  });

  it('leaves `tokenizer` undefined when the source result omits it (NULL column)', async () => {
    const path = freshDbPath('scan-meta-tokenizer-absent');
    const adapter = new SqliteStorageAdapter({ databasePath: path });
    await adapter.init();
    try {
      const node = baseNode({ path: 'a.md' });
      // `makeScanResult` does not set `tokenizer`; metaToRow writes NULL,
      // and the loader maps NULL back to an absent domain field.
      await adapter.scans.persist(makeScanResult([node], []));

      const loaded = await adapter.scans.load();
      ok(loaded);
      strictEqual(loaded.tokenizer, undefined);
    } finally {
      await adapter.close();
    }
  });
});
