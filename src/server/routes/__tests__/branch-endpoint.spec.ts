/**
 * `GET /api/branch` integration tests.
 *
 * Boots a real `createServer()` against a primed-DB tempdir and asserts
 * on the DIRECT shape (no envelope wrap, like `/api/scan`):
 *   `{ schemaVersion, kind: 'branch', branch: { paths, total, rendered,
 *      truncated, cap }, nodes, links, issues }`.
 *
 * Coverage:
 *   - absent DB → empty branch (zero nodes, total 0, truncated false,
 *     cap = default 256).
 *   - empty / absent prefix → whole corpus in stable path order.
 *   - prefix filter scopes to the folder node + descendants only.
 *   - repeated `?path=` → UNION of subtrees (deduped, stable order).
 *   - duplicate `?path=` values are de-duped.
 *   - cap + truncated computed over the UNION total.
 *   - cross-prefix link carried when both endpoints are in the union.
 *   - cap + truncated: limit clamps the node set, total stays full.
 *   - links carried only when both endpoints are in the node set.
 *   - issues carried only when nodeIds intersect the node set.
 *   - limit query param lowers the cap; never raises above maxRenderNodes.
 *   - malformed / < 1 limit → 400 bad-query.
 *   - isFavorite decoration mirrors /api/scan.
 *
 * Per-test fixture path uses `mkdtempSync` (the SqliteStorageAdapter does
 * not work with `:memory:`).
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import { SqliteStorageAdapter } from '../../../kernel/adapters/sqlite/index.js';
import { replaceFindingsForNode } from '../../../kernel/adapters/sqlite/findings.js';
import { persistScanResult } from '../../../kernel/adapters/sqlite/scan-persistence.js';
import type { Issue, Link, Node, ScanResult } from '../../../kernel/types.js';
import { encodeNodePath } from '../../path-codec.js';
import {
  createServer,
  type IServerOptions,
  type IServerHandle,
} from '../../index.js';

const HASH = 'a'.repeat(64);

interface ITestRoot {
  tmp: string;
  fixtureRoot: string;
  dbPath: string;
}

let root: ITestRoot;

before(() => {
  const tmp = mkdtempSync(join(tmpdir(), 'skill-map-branch-endpoint-'));
  root = { tmp, fixtureRoot: join(tmp, 'fixture'), dbPath: join(tmp, 'primed.db') };
});

after(() => {
  rmSync(root.tmp, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(root.dbPath, { force: true });
});

function makeNode(path: string, kind = 'note'): Node {
  return {
    path,
    kind,
    provider: 'claude',
    bodyHash: HASH,
    frontmatterHash: HASH,
    bytes: { frontmatter: 0, body: 0, total: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
  };
}

function makeLink(source: string, target: string): Link {
  return { source, target, kind: 'references', confidence: 1.0, sources: ['markdown-link'] };
}

function makeIssue(severity: 'error' | 'warn' | 'info', nodeIds: string[]): Issue {
  return { analyzerId: 'core/reference-broken', severity, nodeIds, message: 'planted' };
}

interface IPrimeOpts {
  nodes: Node[];
  links?: Link[];
  issues?: Issue[];
  maxRenderNodes?: number;
}

async function prime(opts: IPrimeOpts): Promise<void> {
  const result: ScanResult = {
    schemaVersion: 1,
    scannedAt: Date.now(),
    roots: [root.fixtureRoot],
    providers: ['claude'],
    nodes: opts.nodes,
    links: opts.links ?? [],
    issues: opts.issues ?? [],
    ...(opts.maxRenderNodes !== undefined ? { maxRenderNodes: opts.maxRenderNodes } : {}),
    stats: {
      filesWalked: opts.nodes.length,
      filesSkipped: 0,
      nodesCount: opts.nodes.length,
      linksCount: (opts.links ?? []).length,
      issuesCount: (opts.issues ?? []).length,
      durationMs: 0,
    },
  };
  const adapter = new SqliteStorageAdapter({ databasePath: root.dbPath, autoBackup: false });
  await adapter.init();
  try {
    await persistScanResult(adapter.db, result);
  } finally {
    await adapter.close();
  }
}

/**
 * Plant a single persisted view contribution for a node (raw insert, the
 * scan pipeline that normally emits these is out of scope here). Lets the
 * test prove the branch route EMBEDS contributions onto its nodes, which
 * the map card slots render.
 */
async function plantContribution(nodePath: string, slot: string): Promise<void> {
  const adapter = new SqliteStorageAdapter({ databasePath: root.dbPath, autoBackup: false });
  await adapter.init();
  try {
    await adapter.db
      .insertInto('scan_contributions')
      .values({
        pluginId: 'core',
        extensionId: 'link-counts',
        nodePath,
        contributionId: 'links-out',
        slot,
        payloadJson: JSON.stringify({ label: 'out', value: 3 }),
        emittedAt: Date.now(),
      })
      .execute();
  } finally {
    await adapter.close();
  }
}

/** Seed one fresh (non-stale, open) finding of `severity` on `nodePath`. */
async function plantFinding(nodePath: string, severity: 'error' | 'warn'): Promise<void> {
  const adapter = new SqliteStorageAdapter({ databasePath: root.dbPath, autoBackup: false });
  await adapter.init();
  try {
    await replaceFindingsForNode(adapter.db, nodePath, 'core/ai-contradiction-analyzer', [
      {
        origin: 'extension',
        type: 'contradiction',
        severity,
        message: 'm',
        detail: null,
        confidence: 0.9,
        extensionVersion: '1.0.0',
        model: null,
        // Matches makeNode's bodyHash so the finding is non-stale.
        bodyHashAtGeneration: HASH,
        generatedAt: Date.now(),
        jobId: null,
      },
    ]);
  } finally {
    await adapter.close();
  }
}

function defaultOptions(): IServerOptions {
  return {
    port: 0,
    host: '127.0.0.1',
    dbPath: root.dbPath,
    uiDist: null,
    noUi: false,
    noBuiltIns: false,
    noPlugins: true,
    open: false,
    devCors: false,
    noWatcher: true,
    mcpServer: false,
  };
}

async function bootAndUse<T>(fn: (handle: IServerHandle) => Promise<T>): Promise<T> {
  const handle = await createServer(defaultOptions(), {
    runtimeContext: { cwd: root.fixtureRoot },
  });
  try {
    return await fn(handle);
  } finally {
    await handle.close();
  }
}

function url(handle: IServerHandle, path: string): string {
  return `http://127.0.0.1:${handle.address.port}${path}`;
}

interface IBranchBody {
  schemaVersion: string;
  kind: string;
  branch: { paths: string[]; total: number; rendered: number; truncated: boolean; cap: number };
  nodes: Array<{
    path: string;
    isFavorite?: boolean;
    tags?: string[];
    contributions?: Array<{ slot: string; contributionId: string }>;
  }>;
  links: Array<{ source: string; target: string }>;
  issues: Array<{ nodeIds: string[] }>;
}

describe('GET /api/branch', () => {
  it('absent DB → empty branch (cap = default 256)', async () => {
    await bootAndUse(async (handle) => {
      const res = await fetch(url(handle, '/api/branch'));
      assert.equal(res.status, 200);
      const body = (await res.json()) as IBranchBody;
      assert.equal(body.kind, 'branch');
      assert.deepEqual(body.branch.paths, []);
      assert.equal(body.branch.total, 0);
      assert.equal(body.branch.rendered, 0);
      assert.equal(body.branch.truncated, false);
      assert.equal(body.branch.cap, 256);
      assert.equal(body.nodes.length, 0);
      assert.equal(body.links.length, 0);
      assert.equal(body.issues.length, 0);
    });
  });

  it('empty prefix → whole corpus in stable path order', async () => {
    await prime({ nodes: [makeNode('b/two.md'), makeNode('a/one.md')] });
    await bootAndUse(async (handle) => {
      const res = await fetch(url(handle, '/api/branch'));
      const body = (await res.json()) as IBranchBody;
      assert.deepEqual(body.branch.paths, []);
      assert.equal(body.branch.total, 2);
      assert.deepEqual(body.nodes.map((n) => n.path), ['a/one.md', 'b/two.md']);
    });
  });

  it('embeds per-node contributions so the map card slots render', async () => {
    await prime({ nodes: [makeNode('a/one.md')] });
    await plantContribution('a/one.md', 'card.footer.left');
    await bootAndUse(async (handle) => {
      const res = await fetch(url(handle, '/api/branch'));
      const body = (await res.json()) as IBranchBody;
      const node = body.nodes.find((n) => n.path === 'a/one.md');
      assert.ok(node, 'node present in branch');
      assert.equal(node!.contributions?.length, 1);
      assert.equal(node!.contributions?.[0]?.slot, 'card.footer.left');
      assert.equal(node!.contributions?.[0]?.contributionId, 'links-out');
    });
  });

  it('folds fresh findings into the aggregate severity chip (the map card source)', async () => {
    // Regression: /api/branch is the endpoint the workspace map card
    // hydrates from, so the findings fold MUST reach it (not just
    // /api/nodes and /api/scan). A node with only a probabilistic error
    // finding gets a synthesized issue-counter errorCount chip.
    await prime({ nodes: [makeNode('a/one.md')] });
    await plantFinding('a/one.md', 'error');
    await bootAndUse(async (handle) => {
      const res = await fetch(url(handle, '/api/branch'));
      const body = (await res.json()) as IBranchBody;
      const node = body.nodes.find((n) => n.path === 'a/one.md');
      assert.ok(node);
      const chip = node!.contributions?.find(
        (c) => c.contributionId === 'errorCount',
      ) as { payload?: { value?: number; tooltip?: string } } | undefined;
      assert.ok(chip, 'the map-card endpoint carries the summed findings chip');
      assert.equal(chip!.payload?.value, 1);
      assert.equal(chip!.payload?.tooltip, '1 error: 0 checks + 1 AI finding');
    });
  });

  it('prefix scopes to the folder node + descendants only', async () => {
    await prime({
      nodes: [
        makeNode('src'),
        makeNode('src/a.md'),
        makeNode('src/deep/b.md'),
        makeNode('srcother/c.md'),
        makeNode('other/d.md'),
      ],
    });
    await bootAndUse(async (handle) => {
      const res = await fetch(url(handle, `/api/branch?path=${encodeURIComponent('src')}`));
      const body = (await res.json()) as IBranchBody;
      assert.deepEqual(body.branch.paths, ['src']);
      assert.equal(body.branch.total, 3);
      assert.deepEqual(body.nodes.map((n) => n.path), ['src', 'src/a.md', 'src/deep/b.md']);
    });
  });

  it('cap + truncated: limit clamps the node set, total stays full', async () => {
    const nodes = [];
    for (let i = 0; i < 5; i++) nodes.push(makeNode(`x/n${i}.md`));
    await prime({ nodes });
    await bootAndUse(async (handle) => {
      const res = await fetch(url(handle, '/api/branch?path=x&limit=2'));
      const body = (await res.json()) as IBranchBody;
      assert.equal(body.branch.total, 5);
      assert.equal(body.branch.rendered, 2);
      assert.equal(body.branch.cap, 2);
      assert.equal(body.branch.truncated, true);
      assert.deepEqual(body.nodes.map((n) => n.path), ['x/n0.md', 'x/n1.md']);
    });
  });

  it('links carried only when both endpoints are in the node set', async () => {
    await prime({
      nodes: [makeNode('p/a.md'), makeNode('p/b.md'), makeNode('q/c.md')],
      links: [makeLink('p/a.md', 'p/b.md'), makeLink('p/a.md', 'q/c.md')],
    });
    await bootAndUse(async (handle) => {
      const res = await fetch(url(handle, '/api/branch?path=p'));
      const body = (await res.json()) as IBranchBody;
      assert.equal(body.links.length, 1);
      assert.equal(body.links[0]?.source, 'p/a.md');
      assert.equal(body.links[0]?.target, 'p/b.md');
    });
  });

  it('issues carried only when nodeIds intersect the node set', async () => {
    await prime({
      nodes: [makeNode('p/a.md'), makeNode('q/c.md')],
      issues: [makeIssue('error', ['p/a.md']), makeIssue('warn', ['q/c.md'])],
    });
    await bootAndUse(async (handle) => {
      const res = await fetch(url(handle, '/api/branch?path=p'));
      const body = (await res.json()) as IBranchBody;
      assert.equal(body.issues.length, 1);
      assert.deepEqual(body.issues[0]?.nodeIds, ['p/a.md']);
    });
  });

  it('limit clamps DOWN against maxRenderNodes (cannot raise above the scan cap)', async () => {
    const nodes = [];
    for (let i = 0; i < 6; i++) nodes.push(makeNode(`x/n${i}.md`));
    // Scan recorded maxRenderNodes = 3; a limit=100 query cannot raise it.
    await prime({ nodes, maxRenderNodes: 3 });
    await bootAndUse(async (handle) => {
      const res = await fetch(url(handle, '/api/branch?path=x&limit=100'));
      const body = (await res.json()) as IBranchBody;
      assert.equal(body.branch.cap, 3);
      assert.equal(body.branch.rendered, 3);
      assert.equal(body.branch.total, 6);
      assert.equal(body.branch.truncated, true);
    });
  });

  it('absent limit → cap defaults to the scan maxRenderNodes', async () => {
    await prime({ nodes: [makeNode('x/a.md'), makeNode('x/b.md')], maxRenderNodes: 10 });
    await bootAndUse(async (handle) => {
      const res = await fetch(url(handle, '/api/branch?path=x'));
      const body = (await res.json()) as IBranchBody;
      assert.equal(body.branch.cap, 10);
      assert.equal(body.branch.truncated, false);
    });
  });

  it('malformed limit → 400 bad-query', async () => {
    await prime({ nodes: [makeNode('x/a.md')] });
    await bootAndUse(async (handle) => {
      for (const bad of ['0', '-1', 'abc', '1.5']) {
        const res = await fetch(url(handle, `/api/branch?path=x&limit=${bad}`));
        assert.equal(res.status, 400, `limit=${bad} should reject`);
        const body = (await res.json()) as { ok: boolean; error: { code: string } };
        assert.equal(body.ok, false);
        assert.equal(body.error.code, 'bad-query');
      }
    });
  });

  it('repeated path → UNION of subtrees (deduped, stable path order)', async () => {
    await prime({
      nodes: [
        makeNode('a/one.md'),
        makeNode('a/two.md'),
        makeNode('b/three.md'),
        makeNode('c/four.md'), // outside both prefixes
      ],
    });
    await bootAndUse(async (handle) => {
      const res = await fetch(url(handle, '/api/branch?path=a&path=b'));
      const body = (await res.json()) as IBranchBody;
      assert.deepEqual(body.branch.paths, ['a', 'b']);
      assert.equal(body.branch.total, 3);
      assert.deepEqual(body.nodes.map((n) => n.path), [
        'a/one.md',
        'a/two.md',
        'b/three.md',
      ]);
    });
  });

  it('duplicate path values are de-duped (echoed once, no double count)', async () => {
    await prime({ nodes: [makeNode('a/one.md'), makeNode('a/two.md')] });
    await bootAndUse(async (handle) => {
      const res = await fetch(url(handle, '/api/branch?path=a&path=a'));
      const body = (await res.json()) as IBranchBody;
      assert.deepEqual(body.branch.paths, ['a']);
      assert.equal(body.branch.total, 2);
      assert.deepEqual(body.nodes.map((n) => n.path), ['a/one.md', 'a/two.md']);
    });
  });

  it('seniority fill: repeated `path` order drives the cap, first-named include first', async () => {
    // `zz` is named FIRST but sorts LAST, so plain path order would
    // starve it; the fill must honour the request order (spec §Map
    // scope overrides · Seniority fill) and the echo must keep it too.
    await prime({
      nodes: [
        makeNode('aa/1.md'),
        makeNode('aa/2.md'),
        makeNode('aa/3.md'),
        makeNode('zz/one.md'),
        makeNode('zz/two.md'),
      ],
    });
    await bootAndUse(async (handle) => {
      const res = await fetch(url(handle, '/api/branch?path=zz&path=aa&limit=3'));
      const body = (await res.json()) as IBranchBody;
      assert.deepEqual(body.branch.paths, ['zz', 'aa']);
      assert.equal(body.branch.total, 5);
      assert.equal(body.branch.truncated, true);
      assert.deepEqual(body.nodes.map((n) => n.path), [
        'zz/one.md',
        'zz/two.md',
        'aa/1.md',
      ]);
    });
  });

  it('cap + truncated computed over the UNION total', async () => {
    await prime({
      nodes: [
        makeNode('a/1.md'),
        makeNode('a/2.md'),
        makeNode('b/1.md'),
        makeNode('b/2.md'),
      ],
    });
    await bootAndUse(async (handle) => {
      const res = await fetch(url(handle, '/api/branch?path=a&path=b&limit=3'));
      const body = (await res.json()) as IBranchBody;
      assert.equal(body.branch.total, 4);
      assert.equal(body.branch.rendered, 3);
      assert.equal(body.branch.cap, 3);
      assert.equal(body.branch.truncated, true);
      assert.deepEqual(body.nodes.map((n) => n.path), ['a/1.md', 'a/2.md', 'b/1.md']);
    });
  });

  it('cross-prefix link carried only when both endpoints are in the union', async () => {
    await prime({
      nodes: [makeNode('a/x.md'), makeNode('b/y.md'), makeNode('c/z.md')],
      links: [makeLink('a/x.md', 'b/y.md'), makeLink('a/x.md', 'c/z.md')],
    });
    await bootAndUse(async (handle) => {
      const res = await fetch(url(handle, '/api/branch?path=a&path=b'));
      const body = (await res.json()) as IBranchBody;
      assert.equal(body.links.length, 1);
      assert.equal(body.links[0]?.source, 'a/x.md');
      assert.equal(body.links[0]?.target, 'b/y.md');
    });
  });

  it('absent path → whole corpus (paths echoes [])', async () => {
    await prime({ nodes: [makeNode('a/one.md'), makeNode('b/two.md')] });
    await bootAndUse(async (handle) => {
      const res = await fetch(url(handle, '/api/branch'));
      const body = (await res.json()) as IBranchBody;
      assert.deepEqual(body.branch.paths, []);
      assert.equal(body.branch.total, 2);
      assert.deepEqual(body.nodes.map((n) => n.path), ['a/one.md', 'b/two.md']);
    });
  });

  it('a prefix that is itself a node path matches that node + descendants', async () => {
    await prime({
      nodes: [
        makeNode('docs/guide.md'),
        makeNode('docs/guide.md/sub.md'),
        makeNode('docs/guideline.md'), // shares the string, NOT the boundary
      ],
    });
    await bootAndUse(async (handle) => {
      const res = await fetch(
        url(handle, `/api/branch?path=${encodeURIComponent('docs/guide.md')}`),
      );
      const body = (await res.json()) as IBranchBody;
      assert.deepEqual(body.branch.paths, ['docs/guide.md']);
      assert.equal(body.branch.total, 2);
      assert.deepEqual(body.nodes.map((n) => n.path), [
        'docs/guide.md',
        'docs/guide.md/sub.md',
      ]);
    });
  });

  it('decorates isFavorite on branch nodes (mirrors /api/scan)', async () => {
    await prime({ nodes: [makeNode('p/a.md'), makeNode('p/b.md')] });
    await bootAndUse(async (handle) => {
      const b64 = encodeNodePath('p/a.md');
      await fetch(url(handle, `/api/favorites/${b64}`), { method: 'PUT' });
      const res = await fetch(url(handle, '/api/branch?path=p'));
      const body = (await res.json()) as IBranchBody;
      const a = body.nodes.find((n) => n.path === 'p/a.md');
      const b = body.nodes.find((n) => n.path === 'p/b.md');
      assert.equal(a?.isFavorite, true);
      assert.equal(b?.isFavorite, false);
    });
  });
});

/**
 * Map scope overrides (`spec/cli-contract.md` §Map scope overrides):
 * the deviation-model wire surface. The include-only cases above double
 * as the backcompat proof (bare `?path=` keeps the historical union
 * semantics via the inference rule); these pin the new parameters.
 */
describe('GET /api/branch (map scope overrides)', () => {
  const TREE = [
    makeNode('app/one.md'),
    makeNode('app/legacy/old.md'),
    makeNode('app/legacy/keep/gem.md'),
    makeNode('docs/guide.md'),
  ];

  it('exclude-only: whole corpus minus the excluded subtree, scope echoed', async () => {
    await prime({ nodes: TREE });
    await bootAndUse(async (handle) => {
      const res = await fetch(url(handle, '/api/branch?exclude=app/legacy'));
      assert.equal(res.status, 200);
      const body = (await res.json()) as IBranchBody & {
        branch: { excluded: string[]; rootExcluded: boolean };
      };
      assert.deepEqual(body.nodes.map((n) => n.path), ['app/one.md', 'docs/guide.md']);
      assert.equal(body.branch.total, 2);
      assert.deepEqual(body.branch.paths, []);
      assert.deepEqual(body.branch.excluded, ['app/legacy']);
      assert.equal(body.branch.rootExcluded, false);
    });
  });

  it('nested rescue: include under an exclude keeps the root included (inference)', async () => {
    await prime({ nodes: TREE });
    await bootAndUse(async (handle) => {
      const res = await fetch(
        url(handle, '/api/branch?exclude=app/legacy&path=app/legacy/keep'),
      );
      const body = (await res.json()) as IBranchBody & {
        branch: { rootExcluded: boolean };
      };
      assert.deepEqual(body.nodes.map((n) => n.path), [
        'app/legacy/keep/gem.md',
        'app/one.md',
        'docs/guide.md',
      ]);
      assert.equal(body.branch.rootExcluded, false);
    });
  });

  it('excludeRoot=1 alone: empty branch, total 0', async () => {
    await prime({ nodes: TREE });
    await bootAndUse(async (handle) => {
      const res = await fetch(url(handle, '/api/branch?excludeRoot=1'));
      const body = (await res.json()) as IBranchBody & {
        branch: { rootExcluded: boolean };
      };
      assert.equal(body.branch.total, 0);
      assert.equal(body.nodes.length, 0);
      assert.equal(body.branch.rootExcluded, true);
      assert.equal(body.branch.truncated, false);
    });
  });

  it('an explicit excludeRoot=0 beats the bare-include inference', async () => {
    await prime({ nodes: TREE });
    await bootAndUse(async (handle) => {
      // Bare ?path=docs would infer an excluded root (only docs/); the
      // explicit 0 keeps the whole corpus (the include is redundant).
      const res = await fetch(url(handle, '/api/branch?path=docs&excludeRoot=0'));
      const body = (await res.json()) as IBranchBody;
      assert.equal(body.branch.total, 4);
    });
  });

  it('400 bad-query when a path is both included and excluded', async () => {
    await prime({ nodes: TREE });
    await bootAndUse(async (handle) => {
      const res = await fetch(url(handle, '/api/branch?path=docs&exclude=docs'));
      assert.equal(res.status, 400);
      const body = (await res.json()) as { ok: boolean; error: { code: string } };
      assert.equal(body.ok, false);
      assert.equal(body.error.code, 'bad-query');
    });
  });

  it('400 bad-query on a malformed excludeRoot value', async () => {
    await prime({ nodes: TREE });
    await bootAndUse(async (handle) => {
      for (const bad of ['yes', '2', 'true']) {
        const res = await fetch(url(handle, `/api/branch?excludeRoot=${bad}`));
        assert.equal(res.status, 400, `excludeRoot=${bad}`);
      }
    });
  });

  it('total and truncated are post-override (cap math over the scoped set)', async () => {
    await prime({
      nodes: [
        makeNode('keep/a.md'),
        makeNode('keep/b.md'),
        makeNode('keep/c.md'),
        makeNode('noise/x.md'),
        makeNode('noise/y.md'),
        makeNode('noise/z.md'),
      ],
    });
    await bootAndUse(async (handle) => {
      const res = await fetch(url(handle, '/api/branch?exclude=noise&limit=2'));
      const body = (await res.json()) as IBranchBody;
      // total counts the 3 scoped nodes, never the 6 raw ones.
      assert.equal(body.branch.total, 3);
      assert.equal(body.branch.rendered, 2);
      assert.equal(body.branch.truncated, true);
      assert.deepEqual(body.nodes.map((n) => n.path), ['keep/a.md', 'keep/b.md']);
    });
  });

  it('DB absent: the resolved scope is echoed on the empty branch too', async () => {
    await bootAndUse(async (handle) => {
      const res = await fetch(url(handle, '/api/branch?exclude=noise'));
      const body = (await res.json()) as IBranchBody & {
        branch: { excluded: string[]; rootExcluded: boolean };
      };
      assert.deepEqual(body.branch.excluded, ['noise']);
      assert.equal(body.branch.rootExcluded, false);
      assert.equal(body.branch.total, 0);
    });
  });
});
