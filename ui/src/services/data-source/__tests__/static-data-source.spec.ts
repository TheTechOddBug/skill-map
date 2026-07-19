import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContributionsRegistryService } from '../../../app/services/contributions-registry';
import { KindRegistryService } from '../../kind-registry';
import { ProviderRegistryService } from '../../provider-registry';
import { DataSourceError } from '../data-source.port';
import {
  StaticDataSource,
  type IDemoMetaPayload,
} from '../static-data-source';

/**
 * Minimal fake of `KindRegistryService` for tests that don't run in an
 * Angular TestBed context. The data source only calls `ingest()` on it,
 * so a `vi.fn()` covers the contract.
 */
function makeFakeRegistry(): KindRegistryService {
  return { ingest: vi.fn() } as unknown as KindRegistryService;
}

function makeFakeProviderRegistry(): ProviderRegistryService {
  return { ingest: vi.fn() } as unknown as ProviderRegistryService;
}

/**
 * Minimal fake of `ContributionsRegistryService`. The data source only
 * calls `setRegistry()` on it, so a `vi.fn()` covers the contract.
 */
function makeFakeContributionsRegistry(): ContributionsRegistryService {
  return { setRegistry: vi.fn() } as unknown as ContributionsRegistryService;
}

const META_FIXTURE: IDemoMetaPayload = {
  schemaVersion: '1',
  health: {
    ok: true,
    schemaVersion: '1',
    specVersion: '0.11.0',
    implVersion: '0.9.0',
    db: 'present',
    cwd: '/tmp/test',
    dbPath: '/tmp/test/.skill-map/scan.db',
  },
  nodes: {
    schemaVersion: '1',
    kind: 'nodes',
    items: [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { path: 'a.md', kind: 'markdown' } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { path: 'b.md', kind: 'agent' } as any,
    ],
    filters: { kind: null, hasIssues: null, path: null },
    counts: { total: 2, returned: 2, page: { offset: 0, limit: 1000 } },
    kindRegistry: {},
  },
  links: {
    schemaVersion: '1',
    kind: 'links',
    items: [],
    filters: { kind: null, from: null, to: null },
    counts: { total: 0, returned: 0 },
    kindRegistry: {},
  },
  issues: {
    schemaVersion: '1',
    kind: 'issues',
    items: [],
    filters: { severity: null, analyzerId: null, node: null },
    counts: { total: 0, returned: 0 },
    kindRegistry: {},
  },
  config: {
    schemaVersion: '1',
    kind: 'config',
    value: { tokenizer: 'cl100k_base' },
    kindRegistry: {},
  },
  plugins: {
    schemaVersion: '1',
    kind: 'plugins',
    items: [],
    filters: {},
    counts: { total: 0, returned: 0 },
    kindRegistry: {},
  },
  graph: { ascii: 'graph contents' },
  contributionsRegistry: {
    'claude/tools-counter/count': {
      pluginId: 'claude',
      extensionId: 'tools-counter',
      contributionId: 'count',
      slot: 'card.footer.left',
      icon: 'pi-wrench',
      emitWhenEmpty: false,
    },
    'core/link-counter/linksOut': {
      pluginId: 'core',
      extensionId: 'link-counter',
      contributionId: 'linksOut',
      slot: 'card.footer.left',
      icon: 'pi-upload',
      emitWhenEmpty: false,
    },
  },
};

const SCAN_FIXTURE = {
  schemaVersion: 1,
  scannedAt: 1700000000000,
  roots: ['.'],
  providers: [],
  nodes: [
    { path: 'a.md', kind: 'markdown', provider: 'claude', linksOutCount: 0, linksInCount: 0, externalRefsCount: 0, bytes: { frontmatter: 0, body: 1, total: 1 }, tokens: { frontmatter: 0, body: 256, total: 256 }, modifiedAtMs: 1_700_000_000_000, bodyHash: 'h', frontmatterHash: 'f' },
    { path: 'b.md', kind: 'agent', provider: 'claude', linksOutCount: 1, linksInCount: 0, externalRefsCount: 0, bytes: { frontmatter: 0, body: 1, total: 1 }, tokens: { frontmatter: 0, body: 128, total: 128 }, modifiedAtMs: 1_700_000_500_000, bodyHash: 'h', frontmatterHash: 'f' },
    { path: 'c.md', kind: 'agent', provider: 'claude', linksOutCount: 0, linksInCount: 1, externalRefsCount: 0, bytes: { frontmatter: 0, body: 1, total: 1 }, bodyHash: 'h', frontmatterHash: 'f' },
  ],
  links: [
    {
      source: 'b.md',
      target: 'c.md',
      kind: 'invokes',
      confidence: 'high',
      sources: ['annotations'],
    },
  ],
  issues: [
    {
      analyzerId: 'broken-ref',
      severity: 'warn',
      nodeIds: ['b.md'],
      message: 'broken',
    },
  ],
  stats: {
    filesWalked: 3,
    filesSkipped: 0,
    nodesCount: 3,
    linksCount: 1,
    issuesCount: 1,
    durationMs: 1,
  },
};

function makeFetch(routes: Record<string, unknown>): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    const body = routes[url];
    if (body === undefined) {
      return new Response('{}', { status: 404, statusText: 'Not Found' });
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

describe('StaticDataSource', () => {
  let ds: StaticDataSource;
  let contributionsRegistry: ContributionsRegistryService;

  beforeEach(() => {
    contributionsRegistry = makeFakeContributionsRegistry();
    ds = new StaticDataSource(
      makeFetch({ 'data.meta.json': META_FIXTURE, 'data.json': SCAN_FIXTURE }),
      makeFakeRegistry(),
      makeFakeProviderRegistry(),
      contributionsRegistry,
    );
  });

  it('health() returns the pre-derived health snapshot from meta', async () => {
    await expect(ds.health()).resolves.toEqual(META_FIXTURE.health);
  });

  it('getActiveProvider() returns the lens envelope baked into meta', async () => {
    const lens = {
      activeProvider: 'claude',
      detected: ['claude'],
      source: 'autodetect' as const,
      selectable: ['claude', 'markdown'],
      markerDrift: null,
    };
    const dsWithLens = new StaticDataSource(
      makeFetch({ 'data.meta.json': { ...META_FIXTURE, activeProvider: lens }, 'data.json': SCAN_FIXTURE }),
      makeFakeRegistry(),
      makeFakeProviderRegistry(),
      makeFakeContributionsRegistry(),
    );
    await expect(dsWithLens.getActiveProvider()).resolves.toEqual(lens);
  });

  it('getActiveProvider() falls back to the markdown default when meta omits it', async () => {
    // META_FIXTURE has no activeProvider key (older bundle shape).
    await expect(ds.getActiveProvider()).resolves.toEqual({
      activeProvider: 'markdown',
      detected: [],
      source: 'default',
      selectable: [],
      markerDrift: null,
    });
  });

  it('loadBranch() keeps trigger edges scoped by resolvedTarget, not the raw trigger', async () => {
    // A mentions/invokes link carries the trigger in `target` (`@c`) and
    // the node path in `resolvedTarget` (`c.md`). The branch projection
    // must scope on the resolved endpoint, or the edge is dropped.
    const scanWithTrigger = {
      ...SCAN_FIXTURE,
      links: [
        {
          source: 'b.md',
          target: '@c',
          kind: 'mentions',
          confidence: 'high',
          sources: ['at-directive'],
          resolvedTarget: 'c.md',
        },
      ],
    };
    const dsT = new StaticDataSource(
      makeFetch({ 'data.meta.json': META_FIXTURE, 'data.json': scanWithTrigger }),
      makeFakeRegistry(),
      makeFakeProviderRegistry(),
      makeFakeContributionsRegistry(),
    );
    const branch = await dsT.loadBranch([]);
    expect(branch.links).toHaveLength(1);
    expect(branch.links[0]!.target).toBe('@c');
    expect(branch.links[0]!.resolvedTarget).toBe('c.md');
  });

  it('loadScan() returns the full ScanResult from data.json', async () => {
    await expect(ds.loadScan()).resolves.toEqual(SCAN_FIXTURE);
  });

  it('loadScanMeta() strips nodes / links / issues, keeps stats + scalars', async () => {
    const meta = await ds.loadScanMeta();
    expect(meta.nodes).toEqual([]);
    expect(meta.links).toEqual([]);
    expect(meta.issues).toEqual([]);
    expect(meta.stats.nodesCount).toBe(3);
    expect(meta.roots).toEqual(['.']);
  });

  it('loadFolders() rolls up issue incidence and derives the scalar node columns from data.json', async () => {
    const folders = await ds.loadFolders();
    expect(folders).toEqual([
      {
        path: 'a.md',
        kind: 'markdown',
        linksInCount: 0,
        linksOutCount: 0,
        tokensTotal: 256,
        modifiedAtMs: 1_700_000_000_000,
        errorCount: 0,
        warnCount: 0,
        sidecarStatus: null,
      },
      {
        path: 'b.md',
        kind: 'agent',
        linksInCount: 0,
        linksOutCount: 1,
        tokensTotal: 128,
        modifiedAtMs: 1_700_000_500_000,
        errorCount: 0,
        warnCount: 1,
        sidecarStatus: null,
      },
      {
        // No `tokens` / `modifiedAtMs` on the source node -> null columns.
        path: 'c.md',
        kind: 'agent',
        linksInCount: 1,
        linksOutCount: 0,
        tokensTotal: null,
        modifiedAtMs: null,
        errorCount: 0,
        warnCount: 0,
        sidecarStatus: null,
      },
    ]);
  });

  it('loadBranch([]) with no prefixes returns the whole corpus, no truncation', async () => {
    const branch = await ds.loadBranch([]);
    expect(branch.kind).toBe('branch');
    expect(branch.branch.paths).toEqual([]);
    expect(branch.branch.total).toBe(3);
    expect(branch.branch.truncated).toBe(false);
    expect(branch.nodes.map((n) => n.path)).toEqual(['a.md', 'b.md', 'c.md']);
    // Both endpoints (b.md, c.md) are in the slice, so the link survives.
    expect(branch.links).toHaveLength(1);
    expect(branch.issues).toHaveLength(1);
  });

  it('loadBranch(prefixes) returns the UNION of nodes matching ANY prefix', async () => {
    // Exact leaf paths match themselves (path === prefix); the union of
    // {a.md, c.md} excludes the unselected b.md.
    const branch = await ds.loadBranch(['a.md', 'c.md']);
    expect(branch.branch.paths).toEqual(['a.md', 'c.md']);
    expect(branch.branch.total).toBe(2);
    expect(branch.nodes.map((n) => n.path)).toEqual(['a.md', 'c.md']);
    // The link (b.md -> c.md) loses its source endpoint, so it is dropped;
    // the issue touches b.md (not in the union) so it is dropped too.
    expect(branch.links).toHaveLength(0);
    expect(branch.issues).toHaveLength(0);
  });

  it('loadBranch(prefixes) ignores empty-string entries (treated as whole corpus)', async () => {
    const branch = await ds.loadBranch(['']);
    expect(branch.branch.paths).toEqual([]);
    expect(branch.nodes.map((n) => n.path)).toEqual(['a.md', 'b.md', 'c.md']);
  });

  it('loadBranch(paths, limit) truncates and drops links / issues outside the slice', async () => {
    const branch = await ds.loadBranch([], 1);
    expect(branch.branch.total).toBe(3);
    expect(branch.branch.rendered).toBe(1);
    expect(branch.branch.truncated).toBe(true);
    expect(branch.nodes.map((n) => n.path)).toEqual(['a.md']);
    // The single link's endpoints (b.md, c.md) are outside the 1-node
    // slice, so it is dropped; the issue touches b.md (also dropped).
    expect(branch.links).toHaveLength(0);
    expect(branch.issues).toHaveLength(0);
  });

  it('loadBranch(folder prefixes) unions every descendant of each prefix', async () => {
    // Nested fixture: a folder prefix should pull in all descendants
    // (path.startsWith(prefix + "/")) plus siblings from a second prefix.
    const nestedScan = {
      ...SCAN_FIXTURE,
      nodes: [
        { ...SCAN_FIXTURE.nodes[0], path: 'src/api/a.md' },
        { ...SCAN_FIXTURE.nodes[1], path: 'src/api/deep/b.md' },
        { ...SCAN_FIXTURE.nodes[2], path: 'docs/c.md' },
        { ...SCAN_FIXTURE.nodes[0], path: 'other/d.md' },
      ],
      links: [],
      issues: [],
    };
    const nested = new StaticDataSource(
      makeFetch({ 'data.meta.json': META_FIXTURE, 'data.json': nestedScan }),
      makeFakeRegistry(),
      makeFakeProviderRegistry(),
      makeFakeContributionsRegistry(),
    );
    const branch = await nested.loadBranch(['src', 'docs']);
    // `src` pulls both src/api/* nodes; `docs` pulls docs/c.md; other/d.md
    // matches neither prefix and is excluded.
    expect(branch.nodes.map((n) => n.path)).toEqual([
      'docs/c.md',
      'src/api/a.md',
      'src/api/deep/b.md',
    ]);
    expect(branch.branch.total).toBe(3);
  });

  it('listNodes() with no filters returns the pre-derived envelope verbatim', async () => {
    await expect(ds.listNodes()).resolves.toEqual(META_FIXTURE.nodes);
  });

  it('listNodes() with kind filter derives a fresh envelope from data.json', async () => {
    const env = await ds.listNodes({ kind: ['agent'] });
    expect(env.kind).toBe('nodes');
    expect(env.items.map((n) => n.path)).toEqual(['b.md', 'c.md']);
    expect(env.counts.total).toBe(2);
  });

  it('listNodes() with hasIssues=true keeps only nodes touching an issue', async () => {
    const env = await ds.listNodes({ hasIssues: true });
    expect(env.items.map((n) => n.path)).toEqual(['b.md']);
  });

  it('listNodes() with hasIssues=false drops nodes touching an issue', async () => {
    const env = await ds.listNodes({ hasIssues: false });
    expect(env.items.map((n) => n.path)).toEqual(['a.md', 'c.md']);
  });

  it('listNodes() respects pagination', async () => {
    const env = await ds.listNodes({ limit: 1, offset: 1 });
    expect(env.items.map((n) => n.path)).toEqual(['b.md']);
    expect(env.counts.total).toBe(3);
    expect(env.counts.returned).toBe(1);
  });

  it('getNode() returns a detail bundle with derived incoming/outgoing links + issues', async () => {
    const detail = await ds.getNode('b.md');
    expect(detail).not.toBeNull();
    expect(detail!.item.path).toBe('b.md');
    expect(detail!.links.outgoing).toHaveLength(1);
    expect(detail!.links.outgoing[0]?.target).toBe('c.md');
    expect(detail!.links.incoming).toHaveLength(0);
    expect(detail!.issues).toHaveLength(1);
  });

  it('getNode() returns null when the path is unknown', async () => {
    await expect(ds.getNode('does-not-exist.md')).resolves.toBeNull();
  });

  it('getNodeFindings() returns the honest empty tray for a known node', async () => {
    const env = await ds.getNodeFindings('b.md');
    expect(env).not.toBeNull();
    expect(env!.kind).toBe('findings');
    expect(env!.items).toEqual([]);
    expect(env!.counts).toEqual({
      total: 0,
      returned: 0,
      fixedExcluded: 0,
      staleExcluded: 0,
    });
  });

  it('getNodeFindings() returns null for an unknown path (mirrors the live 404)', async () => {
    await expect(ds.getNodeFindings('does-not-exist.md')).resolves.toBeNull();
  });

  it('getNodeProbExtensions() returns the empty launcher catalog for a known node', async () => {
    await expect(ds.getNodeProbExtensions('b.md')).resolves.toEqual({
      finders: [],
      standalone: [],
    });
  });

  it('getNodeProbExtensions() returns null for an unknown path', async () => {
    await expect(ds.getNodeProbExtensions('does-not-exist.md')).resolves.toBeNull();
  });

  it('submitNodeJob() rejects with demo-readonly (static bundle has no queue)', async () => {
    await expect(ds.submitNodeJob('b.md', 'core/todo-finder')).rejects.toMatchObject({
      name: 'DataSourceError',
      code: 'demo-readonly',
    });
  });

  it('cancelJob() rejects with demo-readonly (static bundle has no queue)', async () => {
    await expect(ds.cancelJob('job-7')).rejects.toMatchObject({
      name: 'DataSourceError',
      code: 'demo-readonly',
    });
  });

  it('listJobs() returns an empty queue (static bundle records no jobs)', async () => {
    await expect(ds.listJobs()).resolves.toEqual([]);
    await expect(ds.listJobs({ status: 'queued' })).resolves.toEqual([]);
  });

  it('listLinks() with no filters returns the pre-derived envelope', async () => {
    await expect(ds.listLinks()).resolves.toEqual(META_FIXTURE.links);
  });

  it('listLinks() filters by source/target', async () => {
    const env = await ds.listLinks({ from: 'b.md' });
    expect(env.items).toHaveLength(1);
  });

  it('listIssues() with no filters returns the pre-derived envelope', async () => {
    await expect(ds.listIssues()).resolves.toEqual(META_FIXTURE.issues);
  });

  it('listIssues() filters by node id', async () => {
    const env = await ds.listIssues({ node: 'b.md' });
    expect(env.items).toHaveLength(1);
  });

  it('loadGraph("ascii") returns the pre-derived ASCII art', async () => {
    await expect(ds.loadGraph('ascii')).resolves.toBe('graph contents');
  });

  it('loadGraph() rejects non-ASCII formats', async () => {
    await expect(ds.loadGraph('json')).rejects.toBeInstanceOf(DataSourceError);
  });

  it('loadConfig() unwraps the value envelope from meta', async () => {
    await expect(ds.loadConfig()).resolves.toEqual({ tokenizer: 'cl100k_base' });
  });

  it('listPlugins() returns the pre-derived envelope', async () => {
    await expect(ds.listPlugins()).resolves.toEqual(META_FIXTURE.plugins);
  });

  it('loadScan() primes ContributionsRegistryService with the embedded registry', async () => {
    await ds.loadScan();
    expect(contributionsRegistry.setRegistry).toHaveBeenCalledWith(
      META_FIXTURE.contributionsRegistry,
    );
  });

  it('listNodes() primes ContributionsRegistryService on the no-filter fast path', async () => {
    await ds.listNodes();
    expect(contributionsRegistry.setRegistry).toHaveBeenCalledWith(
      META_FIXTURE.contributionsRegistry,
    );
  });

  it('listNodes() primes ContributionsRegistryService on the filtered path', async () => {
    await ds.listNodes({ kind: ['agent'] });
    expect(contributionsRegistry.setRegistry).toHaveBeenCalledWith(
      META_FIXTURE.contributionsRegistry,
    );
  });

  it('getNode() primes ContributionsRegistryService with the embedded registry', async () => {
    await ds.getNode('b.md');
    expect(contributionsRegistry.setRegistry).toHaveBeenCalledWith(
      META_FIXTURE.contributionsRegistry,
    );
  });

  it('loadConfig() primes ContributionsRegistryService with the embedded registry', async () => {
    await ds.loadConfig();
    expect(contributionsRegistry.setRegistry).toHaveBeenCalledWith(
      META_FIXTURE.contributionsRegistry,
    );
  });

  it('still loads when the bundle predates the contributions registry (undefined key)', async () => {
    const legacyMeta: IDemoMetaPayload = { ...META_FIXTURE };
    delete (legacyMeta as { contributionsRegistry?: unknown }).contributionsRegistry;
    const legacyRegistry = makeFakeContributionsRegistry();
    const legacy = new StaticDataSource(
      makeFetch({ 'data.meta.json': legacyMeta, 'data.json': SCAN_FIXTURE }),
      makeFakeRegistry(),
      makeFakeProviderRegistry(),
      legacyRegistry,
    );
    await expect(legacy.loadScan()).resolves.toEqual(SCAN_FIXTURE);
    // Service treats undefined as a no-op, but the call is still made
    // (the no-op guard lives inside setRegistry, not the caller).
    expect(legacyRegistry.setRegistry).toHaveBeenCalledWith(undefined);
  });

  it('events() emits no values and completes immediately', () => {
    let nextCalled = false;
    let completeCalled = false;
    ds.events().subscribe({
      next: () => {
        nextCalled = true;
      },
      complete: () => {
        completeCalled = true;
      },
    });
    expect(nextCalled).toBe(false);
    expect(completeCalled).toBe(true);
  });

  it('caches data.json + data.meta.json after the first fetch', async () => {
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'data.meta.json') {
        return new Response(JSON.stringify(META_FIXTURE), { status: 200 });
      }
      return new Response(JSON.stringify(SCAN_FIXTURE), { status: 200 });
    }) as unknown as typeof fetch;
    const cached = new StaticDataSource(
      fetchSpy,
      makeFakeRegistry(),
      makeFakeProviderRegistry(),
      makeFakeContributionsRegistry(),
    );
    await cached.health();
    await cached.health();
    await cached.listPlugins();
    await cached.loadScan();
    await cached.loadScan();
    expect(fetchSpy).toHaveBeenCalledTimes(2); // once for meta, once for data
  });

  it('wraps a 404 on the asset fetch as a DataSourceError', async () => {
    const broken = new StaticDataSource(
      makeFetch({}),
      makeFakeRegistry(),
      makeFakeProviderRegistry(),
      makeFakeContributionsRegistry(),
    );
    await expect(broken.health()).rejects.toBeInstanceOf(DataSourceError);
  });

  it('wraps a fetch reject as a DataSourceError', async () => {
    const failing = new StaticDataSource(
      vi.fn(async () => {
        throw new Error('boom');
      }) as unknown as typeof fetch,
      makeFakeRegistry(),
      makeFakeProviderRegistry(),
      makeFakeContributionsRegistry(),
    );
    await expect(failing.health()).rejects.toMatchObject({
      name: 'DataSourceError',
      code: 'internal',
    });
  });
});
