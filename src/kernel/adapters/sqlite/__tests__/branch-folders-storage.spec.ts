/**
 * Acceptance tests for the lazy-load storage primitives the BFF
 * `/api/folders` + `/api/branch` endpoints consume:
 *
 *   - `port.scans.listLiteNodes()`, `{ path, kind, linksInCount, linksOutCount, tokensTotal, modifiedAtMs, sidecarStatus }[]` ordered by path.
 *   - `port.scans.issueCountsByPath()`, per-node error / warn incidence
 *     via `json_each` + GROUP BY (info ignored).
 *   - `port.scans.effectiveMaxRenderNodes()`, the scan's recorded cap
 *     with the 256 default on a never-scanned DB.
 *   - `port.scans.loadBranch(prefixes, limit)`, prefix-union + capped
 *     projection (nodes / links / issues / total / paths) computed in
 *     SQL.
 *
 * Rows are planted directly into the `scan_*` tables (no scan / persist
 * round-trip) so the dataset shape is fully controlled. Per-test DB uses
 * `mkdtempSync` file paths, the SqliteStorageAdapter does not work with
 * `:memory:` (two distinct DatabaseSync instances on init()).
 */

import { after, before, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SqliteStorageAdapter } from '../index.js';
import type { IBranchScope } from '../../../types/storage.js';

let dbRoot: string;
let dbCounter = 0;

function freshDbPath(label: string): string {
  dbCounter += 1;
  return join(dbRoot, `${label}-${dbCounter}.db`);
}

before(() => {
  dbRoot = mkdtempSync(join(tmpdir(), 'skill-map-branch-folders-'));
});

after(() => {
  rmSync(dbRoot, { recursive: true, force: true });
});

const HASH = '0'.repeat(64);

async function plantNode(
  adapter: SqliteStorageAdapter,
  path: string,
  kind = 'note',
): Promise<void> {
  await adapter.db
    .insertInto('scan_nodes')
    .values({
      path,
      kind,
      provider: 'claude',
      frontmatterJson: '{}',
      bodyHash: HASH,
      frontmatterHash: HASH,
      bytesFrontmatter: 0,
      bytesBody: 0,
      bytesTotal: 0,
      tokensFrontmatter: null,
      tokensBody: null,
      tokensTotal: null,
      scannedAt: Date.now(),
    })
    .execute();
}

async function plantLink(
  adapter: SqliteStorageAdapter,
  source: string,
  target: string,
  opts: { kind?: 'references' | 'invokes' | 'mentions'; resolvedTarget?: string | null } = {},
): Promise<void> {
  await adapter.db
    .insertInto('scan_links')
    .values({
      sourcePath: source,
      targetPath: target,
      kind: opts.kind ?? 'references',
      confidence: 1.0,
      sourcesJson: JSON.stringify(['markdown-link']),
      originalTrigger: null,
      normalizedTrigger: null,
      locationLine: null,
      locationColumn: null,
      locationOffset: null,
      occurrencesJson: null,
      // Path-style links (the default) resolve to their own target, so
      // `resolvedTarget` is left NULL and the branch filter coalesces to
      // `target_path`. A trigger-style link (`invokes` / `mentions`) sets
      // `resolvedTarget` to the node it points to while `target_path`
      // stays the raw trigger.
      resolvedTarget: opts.resolvedTarget ?? null,
      raw: null,
    })
    .execute();
}

async function plantIssue(
  adapter: SqliteStorageAdapter,
  severity: 'error' | 'warn' | 'info',
  nodeIds: string[],
): Promise<void> {
  await adapter.db
    .insertInto('scan_issues')
    .values({
      analyzerId: 'core/reference-broken',
      severity,
      nodeIdsJson: JSON.stringify(nodeIds),
      linkIndicesJson: null,
      message: 'planted',
      detail: null,
      fixJson: null,
      dataJson: null,
    })
    .execute();
}

describe('port.scans.listLiteNodes', () => {
  it('empty DB returns zero rows', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('lite-empty'), autoBackup: false });
    await adapter.init();
    try {
      const rows = await adapter.scans.listLiteNodes();
      assert.equal(rows.length, 0);
    } finally {
      await adapter.close();
    }
  });

  it('returns { path, kind, sidecarStatus } ordered by path ASC', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('lite'), autoBackup: false });
    await adapter.init();
    try {
      await plantNode(adapter, 'skills/zeta.md', 'skill');
      await plantNode(adapter, 'agents/alpha.md', 'agent');
      const rows = await adapter.scans.listLiteNodes();
      assert.deepEqual(rows, [
        {
          path: 'agents/alpha.md',
          kind: 'agent',
          linksInCount: 0,
          linksOutCount: 0,
          tokensTotal: null,
          modifiedAtMs: null,
          sidecarStatus: null,
        },
        {
          path: 'skills/zeta.md',
          kind: 'skill',
          linksInCount: 0,
          linksOutCount: 0,
          tokensTotal: null,
          modifiedAtMs: null,
          sidecarStatus: null,
        },
      ]);
    } finally {
      await adapter.close();
    }
  });

  it('carries the persisted sidecar_status when a sidecar is present', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('lite-sidecar'), autoBackup: false });
    await adapter.init();
    try {
      await adapter.db
        .insertInto('scan_nodes')
        .values({
          path: 'docs/drift.md',
          kind: 'note',
          provider: 'claude',
          frontmatterJson: '{}',
          bodyHash: HASH,
          frontmatterHash: HASH,
          bytesFrontmatter: 0,
          bytesBody: 0,
          bytesTotal: 0,
          tokensFrontmatter: null,
          tokensBody: null,
          tokensTotal: null,
          scannedAt: Date.now(),
          sidecarPresent: 1,
          sidecarStatus: 'stale-body',
        })
        .execute();
      const rows = await adapter.scans.listLiteNodes();
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.sidecarStatus, 'stale-body');
    } finally {
      await adapter.close();
    }
  });
});

describe('port.scans.issueCountsByPath', () => {
  it('empty DB returns an empty map', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('counts-empty'), autoBackup: false });
    await adapter.init();
    try {
      const map = await adapter.scans.issueCountsByPath();
      assert.equal(map.size, 0);
    } finally {
      await adapter.close();
    }
  });

  it('rolls up error / warn incidence per node, ignoring info', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('counts'), autoBackup: false });
    await adapter.init();
    try {
      // foo: 2 errors + 1 warn; bar: 1 warn; baz: only info (absent).
      await plantIssue(adapter, 'error', ['foo.md']);
      await plantIssue(adapter, 'error', ['foo.md', 'bar.md']); // bar gets a warn below; foo a 2nd error
      await plantIssue(adapter, 'warn', ['foo.md']);
      await plantIssue(adapter, 'warn', ['bar.md']);
      await plantIssue(adapter, 'info', ['baz.md']);

      const map = await adapter.scans.issueCountsByPath();
      assert.deepEqual(map.get('foo.md'), { error: 2, warn: 1 });
      // bar.md appears in one error issue (the 2-node one) + one warn.
      assert.deepEqual(map.get('bar.md'), { error: 1, warn: 1 });
      // baz.md only had an info issue, so it is absent from the map.
      assert.equal(map.has('baz.md'), false);
    } finally {
      await adapter.close();
    }
  });
});

describe('port.scans.effectiveMaxRenderNodes', () => {
  it('defaults to 256 on a never-scanned DB (no scan_meta row)', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('cap-default'), autoBackup: false });
    await adapter.init();
    try {
      assert.equal(await adapter.scans.effectiveMaxRenderNodes(), 256);
    } finally {
      await adapter.close();
    }
  });

  it('reads the persisted scan_meta.max_render_nodes', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('cap-meta'), autoBackup: false });
    await adapter.init();
    try {
      await adapter.db
        .insertInto('scan_meta')
        .values({
          id: 1,
          rootsJson: JSON.stringify(['.']),
          scannedAt: Date.now(),
          scannedByName: 'test',
          scannedByVersion: '0.0.0',
          scannedBySpecVersion: '0.0.0',
          providersJson: JSON.stringify(['claude']),
          statsFilesWalked: 0,
          statsFilesSkipped: 0,
          statsDurationMs: 0,
          scanCeiling: 50000,
          scanTruncated: 0,
          maxRenderNodes: 42,
          tokenizer: null,
          oversizedFilesJson: null,
          schemaFingerprint: null,
        })
        .execute();
      assert.equal(await adapter.scans.effectiveMaxRenderNodes(), 42);
    } finally {
      await adapter.close();
    }
  });
});

/**
 * Historical prefix-union scope: the degenerate override set "root
 * excluded + N includes" (or the whole corpus when the list is empty),
 * per `spec/cli-contract.md` §Map scope overrides. Keeps the pre-
 * deviation-model cases readable while exercising the same code path.
 */
function union(include: string[]): IBranchScope {
  return { include, exclude: [], rootExcluded: include.length > 0 };
}

describe('port.scans.loadBranch', () => {
  it('empty DB returns an empty branch (total 0)', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('branch-empty'), autoBackup: false });
    await adapter.init();
    try {
      const branch = await adapter.scans.loadBranch(union([]), 256);
      assert.equal(branch.total, 0);
      assert.equal(branch.nodes.length, 0);
      assert.equal(branch.links.length, 0);
      assert.equal(branch.issues.length, 0);
      assert.deepEqual(branch.paths, []);
    } finally {
      await adapter.close();
    }
  });

  it('empty prefix selects the whole corpus in stable path order', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('branch-all'), autoBackup: false });
    await adapter.init();
    try {
      await plantNode(adapter, 'b/two.md');
      await plantNode(adapter, 'a/one.md');
      const branch = await adapter.scans.loadBranch(union([]), 256);
      assert.equal(branch.total, 2);
      assert.deepEqual(branch.nodes.map((n) => n.path), ['a/one.md', 'b/two.md']);
      assert.deepEqual(branch.paths, []);
    } finally {
      await adapter.close();
    }
  });

  it('prefix scopes to the folder node itself plus descendants only', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('branch-prefix'), autoBackup: false });
    await adapter.init();
    try {
      await plantNode(adapter, 'src');
      await plantNode(adapter, 'src/a.md');
      await plantNode(adapter, 'src/deep/b.md');
      await plantNode(adapter, 'srcother/c.md'); // shares the string prefix but NOT the path boundary
      await plantNode(adapter, 'other/d.md');

      const branch = await adapter.scans.loadBranch(union(['src']), 256);
      assert.equal(branch.total, 3);
      assert.deepEqual(branch.nodes.map((n) => n.path), [
        'src',
        'src/a.md',
        'src/deep/b.md',
      ]);
      assert.deepEqual(branch.paths, ['src']);
    } finally {
      await adapter.close();
    }
  });

  it('caps at limit and reports total BEFORE the cap', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('branch-cap'), autoBackup: false });
    await adapter.init();
    try {
      for (let i = 0; i < 5; i++) await plantNode(adapter, `x/n${i}.md`);
      const branch = await adapter.scans.loadBranch(union(['x']), 2);
      assert.equal(branch.total, 5);
      assert.equal(branch.nodes.length, 2);
      assert.deepEqual(branch.nodes.map((n) => n.path), ['x/n0.md', 'x/n1.md']);
    } finally {
      await adapter.close();
    }
  });

  it('links only when both endpoints are inside the capped node set', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('branch-links'), autoBackup: false });
    await adapter.init();
    try {
      await plantNode(adapter, 'p/a.md');
      await plantNode(adapter, 'p/b.md');
      await plantNode(adapter, 'q/c.md');
      await plantLink(adapter, 'p/a.md', 'p/b.md'); // both in branch p
      await plantLink(adapter, 'p/a.md', 'q/c.md'); // target outside branch p

      const branch = await adapter.scans.loadBranch(union(['p']), 256);
      assert.equal(branch.links.length, 1);
      assert.equal(branch.links[0]?.source, 'p/a.md');
      assert.equal(branch.links[0]?.target, 'p/b.md');
    } finally {
      await adapter.close();
    }
  });

  it('carries a trigger-style edge whose RESOLVED target is a rendered node (raw target is the trigger)', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('branch-resolved-trigger'), autoBackup: false });
    await adapter.init();
    try {
      await plantNode(adapter, '.claude/commands/publish.md');
      await plantNode(adapter, '.claude/agents/content-editor.md');
      // `@content-editor` is the raw `target_path` (a trigger, NOT a node
      // path); the real node it resolves to sits in `resolved_target`.
      // The branch must keep this edge, filtering on `target_path` alone
      // (the pre-fix bug) dropped every resolved trigger edge from the map.
      await plantLink(adapter, '.claude/commands/publish.md', '@content-editor', {
        kind: 'mentions',
        resolvedTarget: '.claude/agents/content-editor.md',
      });

      const branch = await adapter.scans.loadBranch(union([]), 256);
      assert.equal(branch.links.length, 1);
      assert.equal(branch.links[0]?.source, '.claude/commands/publish.md');
      assert.equal(branch.links[0]?.target, '@content-editor');
      assert.equal(branch.links[0]?.resolvedTarget, '.claude/agents/content-editor.md');
    } finally {
      await adapter.close();
    }
  });

  it('drops a genuinely-broken link whose target resolves to no node (resolved_target NULL)', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('branch-broken-link'), autoBackup: false });
    await adapter.init();
    try {
      await plantNode(adapter, 'AGENTS.md');
      // A broken markdown reference: target names a file that is no node and
      // `resolved_target` is NULL. `coalesce(resolved_target, target_path)`
      // falls back to the raw target, which is not in the node set, so the
      // edge correctly falls out (same as the full `/api/scan` map).
      await plantLink(adapter, 'AGENTS.md', 'docs/BACKLOG.md');

      const branch = await adapter.scans.loadBranch(union([]), 256);
      assert.equal(branch.links.length, 0);
    } finally {
      await adapter.close();
    }
  });

  it('drops a trigger-style edge whose resolved target sits outside the selected branch', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('branch-resolved-outside'), autoBackup: false });
    await adapter.init();
    try {
      await plantNode(adapter, 'p/cmd.md');
      await plantNode(adapter, 'q/agent.md');
      // Resolves to a real node, but `q` is not in the selected prefix set,
      // so the both-endpoints rule still drops it (the fix scopes on the
      // RESOLVED target, it does not blanket-include every resolved edge).
      await plantLink(adapter, 'p/cmd.md', '@agent', {
        kind: 'mentions',
        resolvedTarget: 'q/agent.md',
      });

      const branch = await adapter.scans.loadBranch(union(['p']), 256);
      assert.equal(branch.links.length, 0);
    } finally {
      await adapter.close();
    }
  });

  it('issues only when nodeIds intersect the capped node set', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('branch-issues'), autoBackup: false });
    await adapter.init();
    try {
      await plantNode(adapter, 'p/a.md');
      await plantNode(adapter, 'q/c.md');
      await plantIssue(adapter, 'error', ['p/a.md']); // in branch
      await plantIssue(adapter, 'warn', ['q/c.md']); // outside branch

      const branch = await adapter.scans.loadBranch(union(['p']), 256);
      assert.equal(branch.issues.length, 1);
      assert.deepEqual(branch.issues[0]?.nodeIds, ['p/a.md']);
    } finally {
      await adapter.close();
    }
  });

  it('a link whose target is past the cap is dropped (both-endpoints rule)', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('branch-cap-links'), autoBackup: false });
    await adapter.init();
    try {
      await plantNode(adapter, 'p/a.md');
      await plantNode(adapter, 'p/b.md');
      await plantNode(adapter, 'p/c.md');
      // a -> c, but a cap of 2 only renders a + b, so the edge to c drops.
      await plantLink(adapter, 'p/a.md', 'p/c.md');
      const branch = await adapter.scans.loadBranch(union(['p']), 2);
      assert.equal(branch.nodes.length, 2);
      assert.equal(branch.links.length, 0);
    } finally {
      await adapter.close();
    }
  });

  it('union of two sibling prefixes (deduped nodes, stable path order)', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('branch-union'), autoBackup: false });
    await adapter.init();
    try {
      await plantNode(adapter, 'a/one.md');
      await plantNode(adapter, 'a/two.md');
      await plantNode(adapter, 'b/three.md');
      await plantNode(adapter, 'c/four.md'); // outside both prefixes

      const branch = await adapter.scans.loadBranch(union(['a', 'b']), 256);
      assert.equal(branch.total, 3);
      // Union in a single stable `ORDER BY path` pass, no duplicates.
      assert.deepEqual(branch.nodes.map((n) => n.path), [
        'a/one.md',
        'a/two.md',
        'b/three.md',
      ]);
      assert.deepEqual(branch.paths, ['a', 'b']);
    } finally {
      await adapter.close();
    }
  });

  it('cap + total computed over the UNION of prefixes', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('branch-union-cap'), autoBackup: false });
    await adapter.init();
    try {
      // 2 nodes under a, 2 under b: union total 4, cap 3 renders the
      // first 3 in path order.
      await plantNode(adapter, 'a/1.md');
      await plantNode(adapter, 'a/2.md');
      await plantNode(adapter, 'b/1.md');
      await plantNode(adapter, 'b/2.md');

      const branch = await adapter.scans.loadBranch(union(['a', 'b']), 3);
      assert.equal(branch.total, 4);
      assert.equal(branch.nodes.length, 3);
      assert.deepEqual(branch.nodes.map((n) => n.path), [
        'a/1.md',
        'a/2.md',
        'b/1.md',
      ]);
    } finally {
      await adapter.close();
    }
  });

  it('union: a cross-prefix link is carried (both endpoints in the union)', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('branch-union-links'), autoBackup: false });
    await adapter.init();
    try {
      await plantNode(adapter, 'a/x.md');
      await plantNode(adapter, 'b/y.md');
      await plantNode(adapter, 'c/z.md'); // outside the union
      await plantLink(adapter, 'a/x.md', 'b/y.md'); // both in union {a, b}
      await plantLink(adapter, 'a/x.md', 'c/z.md'); // target outside union

      const branch = await adapter.scans.loadBranch(union(['a', 'b']), 256);
      assert.equal(branch.links.length, 1);
      assert.equal(branch.links[0]?.source, 'a/x.md');
      assert.equal(branch.links[0]?.target, 'b/y.md');
    } finally {
      await adapter.close();
    }
  });

  it('union: a link whose target is past the cap is dropped (both-endpoints rule)', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('branch-union-cap-links'), autoBackup: false });
    await adapter.init();
    try {
      await plantNode(adapter, 'a/1.md');
      await plantNode(adapter, 'a/2.md');
      await plantNode(adapter, 'b/1.md');
      // Edge a/1 -> b/1, but cap 2 renders only a/1 + a/2, so it drops.
      await plantLink(adapter, 'a/1.md', 'b/1.md');
      const branch = await adapter.scans.loadBranch(union(['a', 'b']), 2);
      assert.deepEqual(branch.nodes.map((n) => n.path), ['a/1.md', 'a/2.md']);
      assert.equal(branch.links.length, 0);
    } finally {
      await adapter.close();
    }
  });

  it('duplicate prefixes are de-duped (no double counting, paths deduped)', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('branch-dedup'), autoBackup: false });
    await adapter.init();
    try {
      await plantNode(adapter, 'a/one.md');
      await plantNode(adapter, 'a/two.md');

      const branch = await adapter.scans.loadBranch(union(['a', 'a']), 256);
      assert.equal(branch.total, 2);
      assert.deepEqual(branch.nodes.map((n) => n.path), ['a/one.md', 'a/two.md']);
      assert.deepEqual(branch.paths, ['a']);
    } finally {
      await adapter.close();
    }
  });

  it('a prefix that is itself a node path matches that node + its descendants', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('branch-node-prefix'), autoBackup: false });
    await adapter.init();
    try {
      await plantNode(adapter, 'docs/guide.md'); // the prefix is this exact path
      await plantNode(adapter, 'docs/guide.md/sub.md'); // descendant under it
      await plantNode(adapter, 'docs/guideline.md'); // shares the string, NOT the boundary

      const branch = await adapter.scans.loadBranch(union(['docs/guide.md']), 256);
      assert.equal(branch.total, 2);
      assert.deepEqual(branch.nodes.map((n) => n.path), [
        'docs/guide.md',
        'docs/guide.md/sub.md',
      ]);
    } finally {
      await adapter.close();
    }
  });
});

/**
 * Deviation-model scopes (`spec/cli-contract.md` §Map scope overrides):
 * nearest-ancestor-wins evaluation compiled into the SQL WHERE. The
 * union() cases above already pin the two degenerate scopes (whole
 * corpus, root-excluded prefix union); these pin the new shapes.
 */
describe('port.scans.loadBranch (override scopes)', () => {
  async function plantTree(adapter: SqliteStorageAdapter): Promise<void> {
    await plantNode(adapter, 'app/one.md');
    await plantNode(adapter, 'app/legacy/old.md');
    await plantNode(adapter, 'app/legacy/keep/gem.md');
    await plantNode(adapter, 'docs/guide.md');
  }

  it('exclude-only scope: whole corpus minus the excluded subtree', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('scope-exclude-only'), autoBackup: false });
    await adapter.init();
    try {
      await plantTree(adapter);
      const branch = await adapter.scans.loadBranch(
        { include: [], exclude: ['app/legacy'], rootExcluded: false },
        256,
      );
      assert.equal(branch.total, 2);
      assert.deepEqual(branch.nodes.map((n) => n.path), ['app/one.md', 'docs/guide.md']);
      assert.deepEqual(branch.paths, []);
    } finally {
      await adapter.close();
    }
  });

  it('include rescued under an exclude (nearest ancestor wins)', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('scope-rescue'), autoBackup: false });
    await adapter.init();
    try {
      await plantTree(adapter);
      const branch = await adapter.scans.loadBranch(
        { include: ['app/legacy/keep'], exclude: ['app/legacy'], rootExcluded: false },
        256,
      );
      assert.equal(branch.total, 3);
      assert.deepEqual(branch.nodes.map((n) => n.path), [
        'app/legacy/keep/gem.md',
        'app/one.md',
        'docs/guide.md',
      ]);
    } finally {
      await adapter.close();
    }
  });

  it('three-level nesting: include, exclude under it, include under that', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('scope-three-level'), autoBackup: false });
    await adapter.init();
    try {
      await plantTree(adapter);
      // Root excluded, app/ rescued, app/legacy/ re-excluded,
      // app/legacy/keep/ re-rescued.
      const branch = await adapter.scans.loadBranch(
        {
          include: ['app', 'app/legacy/keep'],
          exclude: ['app/legacy'],
          rootExcluded: true,
        },
        256,
      );
      assert.equal(branch.total, 2);
      assert.deepEqual(branch.nodes.map((n) => n.path), [
        'app/legacy/keep/gem.md',
        'app/one.md',
      ]);
    } finally {
      await adapter.close();
    }
  });

  it('root excluded with no includes short-circuits to an empty projection (total 0)', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('scope-root-only'), autoBackup: false });
    await adapter.init();
    try {
      await plantTree(adapter);
      const branch = await adapter.scans.loadBranch(
        { include: [], exclude: [], rootExcluded: true },
        256,
      );
      assert.equal(branch.total, 0);
      assert.equal(branch.nodes.length, 0);
      assert.deepEqual(branch.paths, []);
    } finally {
      await adapter.close();
    }
  });

  it('total is post-override and pre-cap (truncation math over the scoped set)', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('scope-total-postfilter'), autoBackup: false });
    await adapter.init();
    try {
      for (let i = 0; i < 4; i++) await plantNode(adapter, `keep/n${i}.md`);
      for (let i = 0; i < 6; i++) await plantNode(adapter, `noise/n${i}.md`);
      const branch = await adapter.scans.loadBranch(
        { include: [], exclude: ['noise'], rootExcluded: false },
        2,
      );
      // total counts the 4 scoped nodes, never the 10 raw ones; the cap
      // then slices the first 2 in path order.
      assert.equal(branch.total, 4);
      assert.deepEqual(branch.nodes.map((n) => n.path), ['keep/n0.md', 'keep/n1.md']);
    } finally {
      await adapter.close();
    }
  });

  it('an exclude equal to an include loses (defensive; the BFF rejects the conflict upstream)', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('scope-conflict'), autoBackup: false });
    await adapter.init();
    try {
      await plantTree(adapter);
      // Strictly-under comparison: an exclude EQUAL to the include is not
      // deeper, so the include's disjunct still matches its subtree.
      const branch = await adapter.scans.loadBranch(
        { include: ['app'], exclude: ['app'], rootExcluded: true },
        256,
      );
      assert.equal(branch.total, 3);
    } finally {
      await adapter.close();
    }
  });
});

/**
 * Differential contract: the SQL compilation of `applyBranchScope` MUST
 * agree with a direct evaluation of the §Map scope overrides rule
 * (nearest-ancestor-wins) for every scope shape. The reference below
 * restates the normative rule in ten lines; each scope in the battery
 * is evaluated both ways over the same tree and the node sets must be
 * identical. Catches compilation bugs (a wrong strictly-under filter, a
 * dropped disjunct) that hand-picked cases can miss.
 */
describe('port.scans.loadBranch (differential vs the reference rule)', () => {
  const TREE_PATHS = [
    'app/one.md',
    'app/legacy/old.md',
    'app/legacy/keep/gem.md',
    'app/legacy/keep/deep/leaf.md',
    'app2/decoy.md',
    'docs/guide.md',
    'docs/api/ref.md',
    'README.md',
  ];

  /** The normative rule, restated: nearest matching override wins. */
  function referenceVisible(scope: IBranchScope, path: string): boolean {
    let bestLen = -1;
    let best: 'include' | 'exclude' = scope.rootExcluded ? 'exclude' : 'include';
    const consider = (candidate: string, kind: 'include' | 'exclude'): void => {
      const matches = path === candidate || path.startsWith(`${candidate}/`);
      if (matches && candidate.length > bestLen) {
        bestLen = candidate.length;
        best = kind;
      }
    };
    for (const p of scope.include) consider(p, 'include');
    for (const p of scope.exclude) consider(p, 'exclude');
    return best === 'include';
  }

  const SCOPES: IBranchScope[] = [
    { include: [], exclude: [], rootExcluded: false },
    { include: [], exclude: [], rootExcluded: true },
    { include: ['app'], exclude: [], rootExcluded: true },
    { include: [], exclude: ['app/legacy'], rootExcluded: false },
    { include: ['app/legacy/keep'], exclude: ['app/legacy'], rootExcluded: false },
    { include: ['app', 'app/legacy/keep'], exclude: ['app/legacy'], rootExcluded: true },
    // Four alternating levels: exclude root, include app, exclude
    // legacy, include keep, exclude deep.
    {
      include: ['app', 'app/legacy/keep'],
      exclude: ['app/legacy', 'app/legacy/keep/deep'],
      rootExcluded: true,
    },
    // Sibling excludes under one include + an unrelated include.
    { include: ['app', 'docs'], exclude: ['app/legacy', 'docs/api'], rootExcluded: true },
    // String-prefix decoy: excluding `app` must not touch `app2`.
    { include: [], exclude: ['app'], rootExcluded: false },
    // Leaf-level overrides.
    { include: ['app/legacy/old.md'], exclude: ['app/legacy'], rootExcluded: false },
    { include: [], exclude: ['README.md'], rootExcluded: false },
    // Exclude an ancestor of an include AND an unrelated subtree.
    { include: ['docs/api'], exclude: ['docs', 'app'], rootExcluded: false },
  ];

  it('the SQL scope agrees with the reference on every battery scope', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('scope-differential'), autoBackup: false });
    await adapter.init();
    try {
      for (const path of TREE_PATHS) await plantNode(adapter, path);
      for (const [i, scope] of SCOPES.entries()) {
        const expected = TREE_PATHS.filter((p) => referenceVisible(scope, p)).sort();
        const branch = await adapter.scans.loadBranch(scope, 256);
        assert.deepEqual(
          branch.nodes.map((n) => n.path).sort(),
          expected,
          `scope #${i}: ${JSON.stringify(scope)}`,
        );
        assert.equal(branch.total, expected.length, `total of scope #${i}`);
      }
    } finally {
      await adapter.close();
    }
  });
});
