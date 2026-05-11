/**
 * Step 14.2 — `/api/*` endpoint integration tests.
 *
 * Each describe block exercises one route: happy path against a primed
 * fixture DB, plus at least one error / edge case. Routes are driven
 * end-to-end via `createServer({...})` + native `fetch` so the test
 * also asserts the Hono pipeline (route registration, error envelope,
 * onError funnel).
 *
 * `createServer` is paired with `await handle.close()` in `try/finally`
 * everywhere — a stray listening socket leaks across tests.
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { builtIns, listBuiltIns } from '../built-in-plugins/built-ins.js';
import { createKernel, runScan } from '../kernel/index.js';
import { SqliteStorageAdapter } from '../kernel/adapters/sqlite/index.js';
import { persistScanResult } from '../kernel/adapters/sqlite/scan-persistence.js';
import {
  createServer,
  type IServerOptions,
  type ServerHandle,
} from '../server/index.js';
import { encodeNodePath } from '../server/path-codec.js';

interface ITestRoot {
  tmp: string;
  fixtureDir: string;
  primedDb: string;
  emptyDb: string;
  missingDb: string;
}

let root: ITestRoot;

before(async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'skill-map-server-endpoints-'));
  const fixtureDir = mkdtempSync(join(tmp, 'fixture-'));
  plantFixture(fixtureDir);
  // R15 closure (2026-05-07) — plant a co-located `.sm` next to
  // `architect.md` so the BFF can ship the parsed `root` overlay on the
  // single-node response. Two-pass: scan once to capture the live
  // hashes, then plant the sidecar pinned to those hashes (status:
  // 'fresh'), then prime the DB on the second scan below.
  await plantSidecarForArchitect(fixtureDir);
  const primedDb = join(tmp, 'primed.db');
  await primeDb(fixtureDir, primedDb);

  // Empty DB — migrated but never scanned. `loadScanResult` returns the
  // synthetic ScanResult shape with zero rows.
  const emptyDb = join(tmp, 'empty.db');
  await primeEmptyDb(emptyDb);

  // Missing DB — file path that does NOT exist on disk. The endpoints
  // degrade gracefully (`/api/scan` returns the empty shape; lists
  // return zero items).
  const missingDb = join(tmp, 'absent', 'never-existed.db');

  root = { tmp, fixtureDir, primedDb, emptyDb, missingDb };
});

after(() => {
  rmSync(root.tmp, { recursive: true, force: true });
});

function plantFixture(dir: string): void {
  function writeFile(rel: string, content: string): void {
    const abs = join(dir, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  }
  writeFile(
    '.claude/agents/architect.md',
    [
      '---',
      'name: architect',
      'description: The architect.',
      '---',
      'Run /deploy.',
    ].join('\n'),
  );
  writeFile(
    '.claude/commands/deploy.md',
    [
      '---',
      'name: deploy',
      'description: Deploy command.',
      '---',
      'Deploy body.',
    ].join('\n'),
  );
  writeFile(
    '.claude/skills/intro/SKILL.md',
    [
      '---',
      'name: intro',
      'description: Intro skill.',
      '---',
      'Intro body.',
    ].join('\n'),
  );
}

/**
 * R15 closure (2026-05-07) — plant a `.sm` sidecar next to
 * `architect.md` pinned to the live body / frontmatter hashes so the
 * scan reports `status: 'fresh'`. Done before the priming scan so the
 * persisted row carries the full overlay (including `root`).
 */
async function plantSidecarForArchitect(fixtureDir: string): Promise<void> {
  const kernel = createKernel();
  for (const manifest of listBuiltIns()) kernel.registry.register(manifest);
  const baseline = await runScan(kernel, {
    roots: [fixtureDir],
    extensions: builtIns(),
  });
  const node = baseline.nodes.find((n) => n.path === '.claude/agents/architect.md');
  if (!node) throw new Error('expected architect.md in baseline scan');
  const sidecarPath = join(fixtureDir, '.claude/agents/architect.sm');
  writeFileSync(
    sidecarPath,
    [
      'identity:',
      `  path: .claude/agents/architect.md`,
      `  bodyHash: ${node.bodyHash}`,
      `  frontmatterHash: ${node.frontmatterHash}`,
      'annotations:',
      '  version: 4',
      '  stability: stable',
      'audit:',
      `  lastBumpedAt: '2026-05-07T00:00:00.000Z'`,
      `  lastBumpedBy: cli`,
      '',
    ].join('\n'),
  );
}

async function primeDb(fixtureDir: string, dbPath: string): Promise<void> {
  const kernel = createKernel();
  for (const manifest of listBuiltIns()) kernel.registry.register(manifest);
  const result = await runScan(kernel, {
    roots: [fixtureDir],
    extensions: builtIns(),
  });
  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  try {
    await persistScanResult(adapter.db, result);
  } finally {
    await adapter.close();
  }
}

async function primeEmptyDb(dbPath: string): Promise<void> {
  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  await adapter.close();
}

function defaultOptions(overrides: Partial<IServerOptions> = {}): IServerOptions {
  return {
    port: 0,
    host: '127.0.0.1',
    scope: 'project',
    dbPath: root.primedDb,
    uiDist: null,
    noUi: false,
    noBuiltIns: false,
    noPlugins: true, // skip plugin discovery — keeps tests deterministic against `process.cwd()`
    open: false,
    devCors: false,
    noWatcher: true, // dedicated watcher tests live in `server-ws-integration.test.ts`
    ...overrides,
  };
}

async function bootAndUse<T>(
  options: IServerOptions,
  fn: (handle: ServerHandle) => Promise<T>,
  extra: Parameters<typeof createServer>[1] = {},
): Promise<T> {
  const handle = await createServer(options, extra);
  try {
    return await fn(handle);
  } finally {
    await handle.close();
  }
}

function url(handle: ServerHandle, path: string): string {
  return `http://127.0.0.1:${handle.address.port}${path}`;
}

interface IListEnvelope<T> {
  schemaVersion: string;
  kind: string;
  items: T[];
  filters: Record<string, unknown>;
  counts: { total: number; returned: number; page?: { offset: number; limit: number } };
}
interface ISingleEnvelope<T> {
  schemaVersion: string;
  kind: string;
  item: T;
}
interface IValueEnvelope<T> {
  schemaVersion: string;
  kind: string;
  value: T;
}

// ---------------------------------------------------------------------------
// /api/scan
// ---------------------------------------------------------------------------

describe('/api/scan', () => {
  it('returns the persisted ScanResult shape (byte-equal-ish to sm scan --json)', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/scan'));
      assert.equal(res.status, 200);
      const body = (await res.json()) as Record<string, unknown>;
      assert.equal(body['schemaVersion'], 1);
      assert.equal(typeof body['scannedAt'], 'number');
      assert.ok(Array.isArray(body['nodes']));
      assert.ok(Array.isArray(body['links']));
      assert.ok(Array.isArray(body['issues']));
      assert.ok((body['nodes'] as unknown[]).length >= 3, 'expected the primed fixture nodes');
    });
  });

  it('returns the empty ScanResult shape when the DB file is absent', async () => {
    await bootAndUse(defaultOptions({ dbPath: root.missingDb }), async (handle) => {
      const res = await fetch(url(handle, '/api/scan'));
      assert.equal(res.status, 200, 'must NOT 404 — see Decision §14.1 boot resilience');
      const body = (await res.json()) as Record<string, unknown>;
      assert.equal(body['schemaVersion'], 1);
      assert.deepEqual(body['nodes'], []);
      assert.deepEqual(body['links'], []);
      assert.deepEqual(body['issues'], []);
    });
  });

  it('rejects ?fresh=1 with 400 bad-query when --no-built-ins was passed at boot', async () => {
    await bootAndUse(defaultOptions({ noBuiltIns: true }), async (handle) => {
      const res = await fetch(url(handle, '/api/scan?fresh=1'));
      assert.equal(res.status, 400);
      const body = (await res.json()) as { ok: boolean; error: { code: string } };
      assert.equal(body.ok, false);
      assert.equal(body.error.code, 'bad-query');
    });
  });
});

// ---------------------------------------------------------------------------
// /api/nodes (list)
// ---------------------------------------------------------------------------

describe('/api/nodes (list)', () => {
  it('returns every persisted node inside the list envelope', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/nodes'));
      assert.equal(res.status, 200);
      const env = (await res.json()) as IListEnvelope<{ path: string; kind: string }>;
      assert.equal(env.schemaVersion, '1');
      assert.equal(env.kind, 'nodes');
      assert.ok(env.items.length >= 3);
      assert.equal(env.counts.returned, env.items.length);
      assert.ok(env.counts.page, 'list endpoints carry a page object');
      assert.equal(env.counts.page!.offset, 0);
      assert.equal(env.counts.page!.limit, 100);
    });
  });

  it('honours ?kind=agent filter', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/nodes?kind=agent'));
      const env = (await res.json()) as IListEnvelope<{ kind: string }>;
      assert.ok(env.items.length >= 1);
      for (const item of env.items) assert.equal(item.kind, 'agent');
    });
  });

  it('honours ?path=**/architect.md glob', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, `/api/nodes?path=${encodeURIComponent('**/architect.md')}`));
      const env = (await res.json()) as IListEnvelope<{ path: string }>;
      assert.ok(env.items.some((n) => n.path.endsWith('/architect.md')));
      for (const item of env.items) assert.match(item.path, /architect\.md$/);
    });
  });

  it('rejects ?limit=foo with 400 bad-query', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/nodes?limit=foo'));
      assert.equal(res.status, 400);
      const body = (await res.json()) as { error: { code: string } };
      assert.equal(body.error.code, 'bad-query');
    });
  });

  it('rejects ?limit=1001 (over MAX) with 400 bad-query', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/nodes?limit=1001'));
      assert.equal(res.status, 400);
    });
  });

  it('rejects unknown query token via the ExportQueryError funnel', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      // The kernel grammar accepts only kind/has/path — `bogus` would
      // throw, but we go through `urlParamsToExportQuery` which only
      // forwards known params. Test the kernel-level rejection by
      // poking `?hasIssues=` with an unsupported value (already covered
      // above) — here, assert that a malformed `kind=` value (empty)
      // funnels through the same envelope.
      const res = await fetch(url(handle, '/api/nodes?kind='));
      assert.equal(res.status, 400);
      const body = (await res.json()) as { ok: boolean; error: { code: string } };
      assert.equal(body.ok, false);
      assert.equal(body.error.code, 'bad-query');
    });
  });
});

// ---------------------------------------------------------------------------
// /api/nodes/:pathB64
// ---------------------------------------------------------------------------

describe('/api/nodes/:pathB64', () => {
  it('returns the single-node detail envelope for an existing path', async () => {
    // Find a primed path first.
    await bootAndUse(defaultOptions(), async (handle) => {
      const listRes = await fetch(url(handle, '/api/nodes'));
      const list = (await listRes.json()) as IListEnvelope<{ path: string }>;
      const target = list.items[0]!.path;
      const encoded = encodeNodePath(target);
      const res = await fetch(url(handle, `/api/nodes/${encoded}`));
      assert.equal(res.status, 200);
      const env = (await res.json()) as INodeDetailResponse;
      assert.equal(env.kind, 'node');
      assert.equal(env.item.path, target);
      assert.ok('bodyHash' in env.item, 'item must carry the canonical Node fields');
      assert.equal(env.item.body, undefined, 'body absent unless ?include=body');
      assert.ok(Array.isArray(env.links.incoming));
      assert.ok(Array.isArray(env.links.outgoing));
      assert.ok(Array.isArray(env.issues));
    });
  });

  it('returns 404 not-found for a path that is not in the persisted scan', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const encoded = encodeNodePath('does/not/exist.md');
      const res = await fetch(url(handle, `/api/nodes/${encoded}`));
      assert.equal(res.status, 404);
      const body = (await res.json()) as { error: { code: string } };
      assert.equal(body.error.code, 'not-found');
    });
  });

  it('returns 404 not-found for a malformed pathB64', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      // `=` is not in the base64url alphabet — decoder rejects.
      const res = await fetch(url(handle, '/api/nodes/AAA%3D%3D'));
      assert.equal(res.status, 404);
    });
  });

  it('?include=body reads the post-frontmatter body from disk', async () => {
    // The fixture planted `.claude/agents/architect.md` with body
    // `Run /deploy.` (see plantFixture). The runtimeContext.cwd must
    // point at the fixture root so node.path resolves to the real file.
    await bootAndUse(
      defaultOptions(),
      async (handle) => {
        const target = '.claude/agents/architect.md';
        const encoded = encodeNodePath(target);
        const res = await fetch(url(handle, `/api/nodes/${encoded}?include=body`));
        assert.equal(res.status, 200);
        const env = (await res.json()) as INodeDetailResponse;
        assert.equal(env.item.path, target);
        assert.equal(env.item.body, 'Run /deploy.');
      },
      { runtimeContext: { cwd: root.fixtureDir, homedir: tmpdir() } },
    );
  });

  it('R15 — surfaces `sidecar.root` with the full parsed `.sm` payload', async () => {
    // The fixture's `architect.md` has a co-located `.sm` planted in
    // `before()` with `for:` + `annotations:` + `audit:` blocks. The
    // BFF must serialize the full parsed root on the single-node
    // envelope so the inspector audit / debug / plugin-contributions
    // panels can render without re-reading the file.
    await bootAndUse(defaultOptions(), async (handle) => {
      const target = '.claude/agents/architect.md';
      const encoded = encodeNodePath(target);
      const res = await fetch(url(handle, `/api/nodes/${encoded}`));
      assert.equal(res.status, 200);
      const env = (await res.json()) as INodeDetailResponse;
      assert.ok(env.item.sidecar, 'item.sidecar present on response');
      assert.equal(env.item.sidecar!.present, true);
      assert.equal(env.item.sidecar!.status, 'fresh');
      assert.ok(env.item.sidecar!.root, 'sidecar.root surfaced on the wire');
      const root = env.item.sidecar!.root as Record<string, unknown>;
      const identityBlock = root['identity'] as Record<string, unknown>;
      assert.equal(identityBlock['path'], target, 'root.identity.path matches node path');
      assert.equal(typeof identityBlock['bodyHash'], 'string', 'root.identity.bodyHash present');
      const auditBlock = root['audit'] as Record<string, unknown>;
      assert.equal(auditBlock['lastBumpedBy'], 'cli', 'root.audit.lastBumpedBy round-trips');
    });
  });

  it('?include=body returns body=null when the on-disk file disappeared', async () => {
    // Boot with a runtimeContext pointing at a different (empty) tempdir
    // so the relative node.path cannot resolve to an actual file. This
    // simulates a node persisted by a prior scan whose source file was
    // deleted before the inspector opened it.
    const ghostCwd = mkdtempSync(join(root.tmp, 'ghost-cwd-'));
    await bootAndUse(
      defaultOptions(),
      async (handle) => {
        const target = '.claude/agents/architect.md';
        const encoded = encodeNodePath(target);
        const res = await fetch(url(handle, `/api/nodes/${encoded}?include=body`));
        assert.equal(res.status, 200);
        const env = (await res.json()) as INodeDetailResponse;
        assert.equal(env.item.body, null);
      },
      { runtimeContext: { cwd: ghostCwd, homedir: tmpdir() } },
    );
  });
});

interface INodeDetailResponse {
  schemaVersion: string;
  kind: 'node';
  item: {
    path: string;
    bodyHash: string;
    body?: string | null;
    sidecar?: {
      present: boolean;
      status?: string | null;
      annotations?: Record<string, unknown> | null;
      root?: Record<string, unknown> | null;
    };
  };
  links: { incoming: unknown[]; outgoing: unknown[] };
  issues: unknown[];
}

// ---------------------------------------------------------------------------
// /api/links
// ---------------------------------------------------------------------------

describe('/api/links', () => {
  it('returns every persisted link inside the list envelope', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/links'));
      assert.equal(res.status, 200);
      const env = (await res.json()) as IListEnvelope<{ source: string; target: string; kind: string }>;
      assert.equal(env.kind, 'links');
      // Don't assert specific count — depends on extractor specifics.
      assert.equal(env.counts.returned, env.items.length);
    });
  });

  it('honours ?from= filter', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const listRes = await fetch(url(handle, '/api/links'));
      const list = (await listRes.json()) as IListEnvelope<{ source: string }>;
      if (list.items.length === 0) return; // nothing to filter
      const source = list.items[0]!.source;
      const res = await fetch(url(handle, `/api/links?from=${encodeURIComponent(source)}`));
      const env = (await res.json()) as IListEnvelope<{ source: string }>;
      assert.ok(env.items.length > 0);
      for (const link of env.items) assert.equal(link.source, source);
    });
  });

  it('returns an empty list when DB is absent (graceful degradation)', async () => {
    await bootAndUse(defaultOptions({ dbPath: root.missingDb }), async (handle) => {
      const res = await fetch(url(handle, '/api/links'));
      assert.equal(res.status, 200);
      const env = (await res.json()) as IListEnvelope<unknown>;
      assert.equal(env.items.length, 0);
      assert.equal(env.counts.total, 0);
    });
  });
});

// ---------------------------------------------------------------------------
// /api/issues
// ---------------------------------------------------------------------------

describe('/api/issues', () => {
  it('returns every persisted issue inside the list envelope', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/issues'));
      assert.equal(res.status, 200);
      const env = (await res.json()) as IListEnvelope<{ analyzerId: string; severity: string }>;
      assert.equal(env.kind, 'issues');
      assert.equal(env.counts.returned, env.items.length);
    });
  });

  it('honours ?severity=warn filter', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/issues?severity=warn'));
      const env = (await res.json()) as IListEnvelope<{ severity: string }>;
      for (const issue of env.items) assert.equal(issue.severity, 'warn');
    });
  });

  it('honours ?node= filter (only issues whose nodeIds include the path)', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const issuesRes = await fetch(url(handle, '/api/issues'));
      const issues = (await issuesRes.json()) as IListEnvelope<{ nodeIds: string[] }>;
      if (issues.items.length === 0) return;
      const target = issues.items[0]!.nodeIds[0]!;
      const res = await fetch(url(handle, `/api/issues?node=${encodeURIComponent(target)}`));
      const env = (await res.json()) as IListEnvelope<{ nodeIds: string[] }>;
      assert.ok(env.items.length > 0);
      for (const issue of env.items) assert.ok(issue.nodeIds.includes(target));
    });
  });
});

// ---------------------------------------------------------------------------
// /api/graph
// ---------------------------------------------------------------------------

describe('/api/graph', () => {
  it('renders the default ASCII formatter with text/plain', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/graph'));
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') ?? '', /text\/plain/);
      const text = await res.text();
      assert.ok(text.length > 0, 'expected non-empty ASCII rendering');
    });
  });

  it('rejects unknown ?format=mermaid with 400 bad-query', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/graph?format=mermaid'));
      assert.equal(res.status, 400);
      const body = (await res.json()) as { error: { code: string; message: string } };
      assert.equal(body.error.code, 'bad-query');
      assert.match(body.error.message, /mermaid/);
    });
  });
});

// ---------------------------------------------------------------------------
// /api/config
// ---------------------------------------------------------------------------

describe('/api/config', () => {
  it('returns the merged effective config inside a value envelope', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/config'));
      assert.equal(res.status, 200);
      const env = (await res.json()) as IValueEnvelope<{ schemaVersion: number; scan: unknown }>;
      assert.equal(env.kind, 'config');
      assert.equal(env.value.schemaVersion, 1);
      assert.ok(env.value.scan, 'merged config carries scan section');
    });
  });
});

// ---------------------------------------------------------------------------
// /api/plugins
// ---------------------------------------------------------------------------

describe('/api/plugins', () => {
  it('returns built-in plugins (claude + core) when --no-built-ins is off', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/plugins'));
      assert.equal(res.status, 200);
      const env = (await res.json()) as IListEnvelope<{
        id: string;
        source: string;
        status: string;
      }>;
      assert.equal(env.kind, 'plugins');
      const builtIns = env.items.filter((p) => p.source === 'built-in');
      assert.ok(builtIns.some((p) => p.id === 'claude'), 'expected claude built-in');
      assert.ok(builtIns.some((p) => p.id === 'core'), 'expected core built-in');
    });
  });

  it('omits built-ins when noBuiltIns=true', async () => {
    await bootAndUse(defaultOptions({ noBuiltIns: true }), async (handle) => {
      const res = await fetch(url(handle, '/api/plugins'));
      const env = (await res.json()) as IListEnvelope<{ source: string }>;
      assert.equal(env.items.filter((p) => p.source === 'built-in').length, 0);
    });
  });

  it('reflects PATCH writes on a subsequent GET (no boot-cache stale-read)', async () => {
    // Regression: an earlier draft of the route used the boot-cached
    // `pluginRuntime.resolveEnabled` for GET, so PATCHing a toggle
    // would update the DB but the next GET (e.g. F5 in the SPA)
    // returned the pre-PATCH state. The fix builds a fresh resolver
    // from DB on every GET; this test pins the contract.
    await bootAndUse(defaultOptions(), async (handle) => {
      const before = (await (await fetch(url(handle, '/api/plugins'))).json()) as IListEnvelope<{
        id: string;
        status: string;
      }>;
      const claudeBefore = before.items.find((p) => p.id === 'claude');
      assert.equal(claudeBefore?.status, 'enabled');

      const patchRes = await fetch(url(handle, '/api/plugins/claude'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });
      assert.equal(patchRes.status, 200);

      const after = (await (await fetch(url(handle, '/api/plugins'))).json()) as IListEnvelope<{
        id: string;
        status: string;
      }>;
      const claudeAfter = after.items.find((p) => p.id === 'claude');
      assert.equal(claudeAfter?.status, 'disabled');

      // Restore so subsequent tests don't see the override.
      await fetch(url(handle, '/api/plugins/claude'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });
    });
  });

  it('exposes granularity + extensions[] for granularity=extension built-ins', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/plugins'));
      const env = (await res.json()) as IListEnvelope<{
        id: string;
        granularity: 'bundle' | 'extension';
        description?: string;
        extensions?: Array<{ id: string; kind: string; enabled: boolean; description?: string }>;
      }>;
      const core = env.items.find((p) => p.id === 'core');
      assert.ok(core, 'expected core item');
      assert.equal(core.granularity, 'extension');
      assert.ok(Array.isArray(core.extensions), 'core must expose extensions[]');
      assert.ok((core.extensions ?? []).length > 0, 'core must list at least one extension');
      const claude = env.items.find((p) => p.id === 'claude');
      assert.ok(claude, 'expected claude item');
      assert.equal(claude.granularity, 'bundle');
      assert.equal(claude.extensions, undefined, 'bundle granularity must omit extensions[]');
    });
  });

  it('carries description on bundle rows and on per-extension entries', async () => {
    // Pinned at 2026-05-09 — the Settings UI reads `description` for
    // both display and substring search; guard the wire so a
    // built-ins refactor cannot silently drop the field.
    await bootAndUse(defaultOptions(), async (handle) => {
      const env = (await (await fetch(url(handle, '/api/plugins'))).json()) as IListEnvelope<{
        id: string;
        description?: string;
        extensions?: Array<{ id: string; description?: string }>;
      }>;
      const claude = env.items.find((p) => p.id === 'claude');
      assert.ok(claude?.description, 'claude bundle must carry a description');
      assert.ok((claude?.description ?? '').length > 0);
      const core = env.items.find((p) => p.id === 'core');
      assert.ok(core?.description, 'core bundle must carry a description');
      const superseded = (core?.extensions ?? []).find((e) => e.id === 'superseded');
      assert.ok(superseded?.description, 'core/superseded must carry a description');
      assert.ok((superseded?.description ?? '').length > 0);
    });
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/plugins/:id (+ qualified form)
// ---------------------------------------------------------------------------

interface IErrorBody {
  ok: false;
  error: { code: string; message: string; details?: Record<string, unknown> | null };
}

async function patchJson(
  handle: ServerHandle,
  path: string,
  body: unknown,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(url(handle, path), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

describe('PATCH /api/plugins/:id (bundle granularity)', () => {
  it('toggles a granularity=bundle built-in and returns the projected list', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const out = await patchJson(handle, '/api/plugins/claude', { enabled: false });
      assert.equal(out.status, 200);
      const env = out.json as IListEnvelope<{ id: string; status: string; granularity: string }>;
      const claude = env.items.find((p) => p.id === 'claude');
      assert.equal(claude?.status, 'disabled');
      // Re-enable so the test does not poison the shared primedDb for
      // the next test in the suite.
      const reEnable = await patchJson(handle, '/api/plugins/claude', { enabled: true });
      assert.equal(reEnable.status, 200);
    });
  });

  it('rejects bundle-form against a granularity=extension target with 400 bad-query', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const out = await patchJson(handle, '/api/plugins/core', { enabled: false });
      assert.equal(out.status, 400);
      assert.equal((out.json as IErrorBody).error.code, 'bad-query');
    });
  });

  it('returns 404 not-found for an unknown plugin id', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const out = await patchJson(handle, '/api/plugins/no-such-plugin', { enabled: true });
      assert.equal(out.status, 404);
      assert.equal((out.json as IErrorBody).error.code, 'not-found');
    });
  });

  it('returns 400 bad-query when the body is missing `enabled`', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const out = await patchJson(handle, '/api/plugins/claude', {});
      assert.equal(out.status, 400);
      assert.equal((out.json as IErrorBody).error.code, 'bad-query');
    });
  });

  it('returns 400 bad-query when `enabled` is not a boolean', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const out = await patchJson(handle, '/api/plugins/claude', { enabled: 'yes' });
      assert.equal(out.status, 400);
      assert.equal((out.json as IErrorBody).error.code, 'bad-query');
    });
  });

  it('returns 400 bad-query when the body has an unknown extra key (additionalProperties strict)', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const out = await patchJson(handle, '/api/plugins/claude', {
        enabled: true,
        comment: 'oops',
      });
      assert.equal(out.status, 400);
      assert.equal((out.json as IErrorBody).error.code, 'bad-query');
    });
  });

  it('returns 500 db-missing when the project DB does not exist', async () => {
    await bootAndUse(defaultOptions({ dbPath: root.missingDb }), async (handle) => {
      const out = await patchJson(handle, '/api/plugins/claude', { enabled: false });
      assert.equal(out.status, 500);
      assert.equal((out.json as IErrorBody).error.code, 'db-missing');
    });
  });
});

// ---------------------------------------------------------------------------
// POST /api/scan (manual refresh)
// ---------------------------------------------------------------------------

describe('POST /api/scan', () => {
  // Override `noPlugins: false` so the route's pipeline gate doesn't
  // trip; thread the fixture as `runtimeContext.cwd` so plugin
  // discovery walks the fixture's `.skill-map/plugins/` (absent) and
  // not the test process's cwd (the project root, which has its own
  // drop-ins). Together these yield a deterministic scan against the
  // primed fixture. Both helpers run lazily so they read the
  // `before()`-initialised `root` rather than capturing it at suite
  // construction (when `root` is still undefined).
  function postScanOptions(overrides: Partial<IServerOptions> = {}): IServerOptions {
    return defaultOptions({ noPlugins: false, ...overrides });
  }
  function postScanExtra(): { runtimeContext: { cwd: string; homedir: string } } {
    return { runtimeContext: { cwd: root.fixtureDir, homedir: root.tmp } };
  }

  it('runs and persists a scan, returning the new ScanResult', async () => {
    await bootAndUse(
      postScanOptions(),
      async (handle) => {
        const res = await fetch(url(handle, '/api/scan'), { method: 'POST' });
        assert.equal(res.status, 200);
        const body = (await res.json()) as Record<string, unknown>;
        assert.equal(body['schemaVersion'], 1);
        assert.ok(Array.isArray(body['nodes']));
        assert.ok(Array.isArray(body['links']));
      },
      postScanExtra(),
    );
  });

  it('returns 400 bad-query when --no-built-ins is set', async () => {
    await bootAndUse(
      postScanOptions({ noBuiltIns: true }),
      async (handle) => {
        const res = await fetch(url(handle, '/api/scan'), { method: 'POST' });
        assert.equal(res.status, 400);
        const body = (await res.json()) as IErrorBody;
        assert.equal(body.error.code, 'bad-query');
      },
      postScanExtra(),
    );
  });

  it('returns 500 db-missing when the project DB does not exist', async () => {
    await bootAndUse(
      postScanOptions({ dbPath: root.missingDb }),
      async (handle) => {
        const res = await fetch(url(handle, '/api/scan'), { method: 'POST' });
        assert.equal(res.status, 500);
        const body = (await res.json()) as IErrorBody;
        assert.equal(body.error.code, 'db-missing');
      },
      postScanExtra(),
    );
  });

  it('returns 409 scan-busy when another scan is already in flight', async () => {
    await bootAndUse(
      postScanOptions(),
      async (handle) => {
        // Fire two POSTs concurrently. The mutex resolves the first;
        // the second arrives while the first is still in-flight and
        // surfaces 409 scan-busy. The scan walks the fixture
        // directory on every call, which is enough room for the
        // race without a synthetic sleep.
        const [first, second] = await Promise.all([
          fetch(url(handle, '/api/scan'), { method: 'POST' }),
          fetch(url(handle, '/api/scan'), { method: 'POST' }),
        ]);
        const statuses = [first.status, second.status].sort();
        assert.deepEqual(statuses, [200, 409]);
        const busyRes = first.status === 409 ? first : second;
        const body = (await busyRes.json()) as IErrorBody;
        assert.equal(body.error.code, 'scan-busy');
      },
      postScanExtra(),
    );
  });
});

describe('PATCH /api/plugins/:bundleId/extensions/:extensionId', () => {
  it('toggles a granularity=extension built-in extension', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const out = await patchJson(
        handle,
        '/api/plugins/core/extensions/superseded',
        { enabled: false },
      );
      assert.equal(out.status, 200);
      const env = out.json as IListEnvelope<{
        id: string;
        extensions?: Array<{ id: string; enabled: boolean }>;
      }>;
      const core = env.items.find((p) => p.id === 'core');
      const ext = (core?.extensions ?? []).find((e) => e.id === 'superseded');
      assert.equal(ext?.enabled, false);
      // Restore so subsequent tests see the default.
      await patchJson(handle, '/api/plugins/core/extensions/superseded', { enabled: true });
    });
  });

  it('rejects qualified-form against a granularity=bundle target with 400 bad-query', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const out = await patchJson(
        handle,
        '/api/plugins/claude/extensions/anything',
        { enabled: false },
      );
      assert.equal(out.status, 400);
      assert.equal((out.json as IErrorBody).error.code, 'bad-query');
    });
  });

  it('returns 404 for an unknown extension id under a known bundle', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const out = await patchJson(
        handle,
        '/api/plugins/core/extensions/no-such-extension',
        { enabled: false },
      );
      assert.equal(out.status, 404);
      assert.equal((out.json as IErrorBody).error.code, 'not-found');
    });
  });

  it('rejects host-locked extensions (core/markdown) with 403 locked', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const out = await patchJson(
        handle,
        '/api/plugins/core/extensions/markdown',
        { enabled: false },
      );
      assert.equal(out.status, 403);
      assert.equal((out.json as IErrorBody).error.code, 'locked');
    });
  });

  it('GET /api/plugins stamps locked: true on host-locked extensions', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/plugins'));
      const env = (await res.json()) as IListEnvelope<{
        id: string;
        extensions?: Array<{ id: string; locked?: boolean }>;
      }>;
      const core = env.items.find((p) => p.id === 'core');
      const markdown = (core?.extensions ?? []).find((e) => e.id === 'markdown');
      assert.equal(markdown?.locked, true);
    });
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/plugins (bulk)
// ---------------------------------------------------------------------------

describe('PATCH /api/plugins (bulk)', () => {
  it('applies multiple toggles in one transaction and projects the post-write list', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const out = await patchJson(handle, '/api/plugins', {
        changes: [
          { id: 'claude', enabled: false },
          { id: 'core/superseded', enabled: false },
        ],
      });
      assert.equal(out.status, 200);
      const env = out.json as IListEnvelope<{
        id: string;
        status: string;
        extensions?: Array<{ id: string; enabled: boolean }>;
      }>;
      const claude = env.items.find((p) => p.id === 'claude');
      const core = env.items.find((p) => p.id === 'core');
      const superseded = (core?.extensions ?? []).find((e) => e.id === 'superseded');
      assert.equal(claude?.status, 'disabled');
      assert.equal(superseded?.enabled, false);
      // Restore so subsequent tests see the defaults.
      await patchJson(handle, '/api/plugins', {
        changes: [
          { id: 'claude', enabled: true },
          { id: 'core/superseded', enabled: true },
        ],
      });
    });
  });

  it('treats an empty changes array as a no-op and returns the current list', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const out = await patchJson(handle, '/api/plugins', { changes: [] });
      assert.equal(out.status, 200);
      const env = out.json as IListEnvelope<{ id: string }>;
      assert.ok(env.items.length > 0, 'expected the current plugin list back');
    });
  });

  it('rejects the whole batch with 404 when ANY entry is unknown', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const out = await patchJson(handle, '/api/plugins', {
        changes: [
          { id: 'claude', enabled: false },
          { id: 'no-such-plugin', enabled: true },
        ],
      });
      assert.equal(out.status, 404);
      const body = out.json as IErrorBody;
      assert.equal(body.error.code, 'not-found');
      assert.deepEqual(body.error.details, { id: 'no-such-plugin' });
      // Verify the DB was not touched — claude is still enabled.
      const after = await fetch(url(handle, '/api/plugins'));
      const env = (await after.json()) as IListEnvelope<{ id: string; status: string }>;
      const claude = env.items.find((p) => p.id === 'claude');
      assert.equal(claude?.status, 'enabled');
    });
  });

  it('rejects the whole batch with 403 when ANY entry is locked', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const out = await patchJson(handle, '/api/plugins', {
        changes: [
          { id: 'claude', enabled: false },
          { id: 'core/markdown', enabled: false },
        ],
      });
      assert.equal(out.status, 403);
      const body = out.json as IErrorBody;
      assert.equal(body.error.code, 'locked');
      assert.deepEqual(body.error.details, { id: 'core/markdown' });
      // Verify the DB was not touched.
      const after = await fetch(url(handle, '/api/plugins'));
      const env = (await after.json()) as IListEnvelope<{ id: string; status: string }>;
      const claude = env.items.find((p) => p.id === 'claude');
      assert.equal(claude?.status, 'enabled');
    });
  });

  it('rejects the whole batch with 400 when ANY entry has the wrong granularity', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const out = await patchJson(handle, '/api/plugins', {
        changes: [
          { id: 'claude', enabled: false },
          { id: 'core', enabled: false }, // core is granularity=extension; bare id is invalid.
        ],
      });
      assert.equal(out.status, 400);
      const body = out.json as IErrorBody;
      assert.equal(body.error.code, 'bad-query');
      assert.deepEqual(body.error.details, { id: 'core' });
    });
  });

  it('returns 400 bad-query when the body is missing `changes`', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const out = await patchJson(handle, '/api/plugins', {});
      assert.equal(out.status, 400);
      assert.equal((out.json as IErrorBody).error.code, 'bad-query');
    });
  });

  it('returns 400 bad-query when an entry has the wrong shape', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const out = await patchJson(handle, '/api/plugins', {
        changes: [{ id: 'claude', enabled: 'yes' }],
      });
      assert.equal(out.status, 400);
      assert.equal((out.json as IErrorBody).error.code, 'bad-query');
    });
  });

  it('returns 400 bad-query when an entry has an unknown extra key (additionalProperties strict)', async () => {
    // Pre-AJV the manual shape guard ignored extra keys silently.
    // Now the schema rejects them so a typo in the SPA's payload
    // surfaces directly.
    await bootAndUse(defaultOptions(), async (handle) => {
      const out = await patchJson(handle, '/api/plugins', {
        changes: [{ id: 'claude', enabled: false, extra: 'oops' }],
      });
      assert.equal(out.status, 400);
      assert.equal((out.json as IErrorBody).error.code, 'bad-query');
    });
  });

  it('returns 400 bad-query when an entry is missing `id`', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const out = await patchJson(handle, '/api/plugins', {
        changes: [{ enabled: false }],
      });
      assert.equal(out.status, 400);
      assert.equal((out.json as IErrorBody).error.code, 'bad-query');
    });
  });

  it('returns 400 bad-query when an entry has an empty `id`', async () => {
    // Schema enforces `minLength: 1` so empty strings are caught.
    await bootAndUse(defaultOptions(), async (handle) => {
      const out = await patchJson(handle, '/api/plugins', {
        changes: [{ id: '', enabled: false }],
      });
      assert.equal(out.status, 400);
      assert.equal((out.json as IErrorBody).error.code, 'bad-query');
    });
  });

  it('returns 500 db-missing when the project DB does not exist', async () => {
    await bootAndUse(defaultOptions({ dbPath: root.missingDb }), async (handle) => {
      const out = await patchJson(handle, '/api/plugins', {
        changes: [{ id: 'claude', enabled: false }],
      });
      assert.equal(out.status, 500);
      assert.equal((out.json as IErrorBody).error.code, 'db-missing');
    });
  });
});

// ---------------------------------------------------------------------------
// Mid-session toggles are honoured by POST /api/scan (regression for the
// boot-cached resolver bug — see core/runtime/fresh-resolver.ts).
// ---------------------------------------------------------------------------

describe('POST /api/scan honours mid-session plugin toggles', () => {
  // Use the same plumbing as the POST /api/scan suite above so the
  // fresh-scan plugin discovery walks the fixture's own
  // `.skill-map/plugins/` directory rather than the project root's.
  function scanOptions(overrides: Partial<IServerOptions> = {}): IServerOptions {
    return defaultOptions({ noPlugins: false, ...overrides });
  }
  function scanExtra(): { runtimeContext: { cwd: string; homedir: string } } {
    return { runtimeContext: { cwd: root.fixtureDir, homedir: root.tmp } };
  }

  it('a freshly toggled-off plugin contributes no scan_contributions on POST /api/scan', async () => {
    await bootAndUse(
      scanOptions(),
      async (handle) => {
        // Sanity baseline — claude is enabled before any toggle.
        const baseline = await patchJson(handle, '/api/plugins', { changes: [] });
        const beforeEnv = baseline.json as IListEnvelope<{ id: string; status: string }>;
        const beforeClaude = beforeEnv.items.find((p) => p.id === 'claude');
        assert.equal(beforeClaude?.status, 'enabled');

        // Toggle claude OFF via bulk PATCH (the SPA's path).
        const off = await patchJson(handle, '/api/plugins', {
          changes: [{ id: 'claude', enabled: false }],
        });
        assert.equal(off.status, 200);

        // Run POST /api/scan — pre-fix, this would re-populate claude
        // contributions because `runScanForCommand` reused the
        // boot-cached resolver. Post-fix, the fresh resolver wins
        // and no contributions are emitted for the disabled plugin.
        const scan = await fetch(url(handle, '/api/scan'), { method: 'POST' });
        assert.equal(scan.status, 200);
        const result = (await scan.json()) as {
          nodes: Array<{ contributions?: Array<{ pluginId: string }> }>;
        };
        const claudeContribs = (result.nodes ?? []).flatMap(
          (n) => n.contributions ?? [],
        ).filter((c) => c.pluginId === 'claude');
        assert.equal(
          claudeContribs.length,
          0,
          'expected no claude-authored contributions after a mid-session disable',
        );

        // Restore so subsequent tests see the defaults.
        await patchJson(handle, '/api/plugins', {
          changes: [{ id: 'claude', enabled: true }],
        });
      },
      scanExtra(),
    );
  });
});

// ---------------------------------------------------------------------------
// Registry coverage for built-ins regardless of boot-time enabled state.
//
// Regression for the bug where `kindRegistry` + `contributionsRegistry`
// were seeded from the boot-time `composeScanExtensions(...)` result,
// which filtered out disabled built-ins. Re-enabling such a built-in
// mid-session left its kinds + footer icons unrenderable because the
// boot-cached registries never knew about them. Fix: built-ins ALWAYS
// register (their handlers are statically imported and always in
// memory); the enabled/disabled axis stays enforced at scan-time.
// ---------------------------------------------------------------------------

describe('boot-cached registries include built-ins regardless of enabled state', () => {
  /**
   * Plant a `.skill-map/settings.json` under a fresh fixture cwd that
   * disables one built-in bundle (claude) AND one built-in extension
   * that contributes views (core/tools-count). The server boots against
   * that cwd via the `runtimeContext` override and the registries must
   * still expose both items so a mid-session re-enable would surface
   * correctly.
   */
  function bootWithDisabledBuiltIns<T>(
    fn: (handle: ServerHandle) => Promise<T>,
  ): Promise<T> {
    const cwd = mkdtempSync(join(root.tmp, 'registry-coverage-'));
    mkdirSync(join(cwd, '.skill-map'), { recursive: true });
    writeFileSync(
      join(cwd, '.skill-map', 'settings.json'),
      JSON.stringify({
        plugins: {
          claude: { enabled: false },
          'core/tools-count': { enabled: false },
        },
      }),
    );
    return bootAndUse(
      defaultOptions({ noPlugins: false }),
      fn,
      { runtimeContext: { cwd, homedir: root.tmp } },
    );
  }

  it('kindRegistry exposes built-in Provider kinds even when the Provider is disabled at boot', async () => {
    await bootWithDisabledBuiltIns(async (handle) => {
      const res = await fetch(url(handle, '/api/plugins'));
      const body = (await res.json()) as { kindRegistry: Record<string, unknown> };
      // Claude is disabled in settings.json; its kinds MUST still be
      // in the registry so a future re-enable renders correctly.
      // Claude declares the `agent` and `command` kinds.
      assert.ok(
        Object.prototype.hasOwnProperty.call(body.kindRegistry, 'agent'),
        'expected `agent` (Claude-owned kind) in kindRegistry even though claude is disabled',
      );
      assert.ok(
        Object.prototype.hasOwnProperty.call(body.kindRegistry, 'command'),
        'expected `command` (Claude-owned kind) in kindRegistry even though claude is disabled',
      );
    });
  });

  it('contributionsRegistry exposes built-in view contributions even when the extension is disabled at boot', async () => {
    await bootWithDisabledBuiltIns(async (handle) => {
      const res = await fetch(url(handle, '/api/plugins'));
      const body = (await res.json()) as {
        contributionsRegistry: Record<string, unknown>;
      };
      // core/tools-count is disabled in settings.json; its `count`
      // contribution MUST still be in the registry.
      assert.ok(
        Object.prototype.hasOwnProperty.call(
          body.contributionsRegistry,
          'core/tools-count/count',
        ),
        'expected `core/tools-count/count` in contributionsRegistry even though the extension is disabled',
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Catch-all 404 (regression for 14.1)
// ---------------------------------------------------------------------------

describe('/api/* catch-all (still in place after 14.2)', () => {
  it('returns the 404 envelope for an unknown /api path', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/never-defined'));
      assert.equal(res.status, 404);
      const body = (await res.json()) as { ok: boolean; error: { code: string } };
      assert.equal(body.ok, false);
      assert.equal(body.error.code, 'not-found');
    });
  });
});
