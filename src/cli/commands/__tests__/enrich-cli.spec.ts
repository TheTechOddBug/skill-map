/**
 * End-to-end tests for the `sm enrich` Model A enrichment pass wired
 * through the real CLI verb against a real project DB (never
 * `:memory:`, see feedback_sqlite_in_memory_workaround) and the
 * module-level fetch seam (`_setRefreshFetchForTests`), no real network
 * ever.
 *
 * Coverage (spec/cli-contract.md §Refresh + db-schema.md
 * §state_enrichments):
 *   - policy off (`allowNetworkActions` unset/false) → §3.1b skip
 *     advisory naming the key, exit 0, NO state row, NO fetch.
 *   - policy on → state row persisted (verified lifted from the
 *     report) + execution row `runner: 'in-process'`; the `--json`
 *     envelope folds the state row into `refreshed`.
 *   - node without `source` / `sourceVersion` annotations → silent
 *     no-op skip (no row, no advisory, no fetch).
 *   - `--stale` picks up a body-drifted `state_enrichments` row and
 *     re-verifies it in place.
 *   - the built-in ships DISABLED: with the policy on but no extension
 *     enable, nothing runs (composed catalog excludes it).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deepStrictEqual, match, doesNotMatch, ok, strictEqual } from 'node:assert';
import { after, afterEach, before, describe, it } from 'node:test';

import type { BaseContext } from 'clipanion';

import { EnrichCommand, _setRefreshFetchForTests } from '../enrich.js';
import { SqliteStorageAdapter } from '../../../kernel/adapters/sqlite/index.js';
import { upsertStateEnrichment } from '../../../kernel/adapters/sqlite/enrichments.js';
import { sha256 } from '../../../kernel/orchestrator/node-build.js';

const NODE_PATH = 'agents/architect.md';
const NODE_BODY = 'Body of agents/architect.md\n';
const NODE_FILE = `---\ntitle: t\n---\n${NODE_BODY}`;
const BODY_HASH = sha256(NODE_BODY);
const SHA_PIN = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const SOURCE = `https://github.com/octo/tools/blob/main/${NODE_PATH}`;
const ACTION_ID = 'github/enrichment';

const PROVENANCE = { source: SOURCE, sourceVersion: SHA_PIN };

let tmpRoot: string;
let counter = 0;

interface ICaptured {
  context: BaseContext;
  stdout: () => string;
  stderr: () => string;
}

function captureContext(): ICaptured {
  const out: string[] = [];
  const err: string[] = [];
  const context = {
    stdout: { write: (s: string) => { out.push(s); return true; } },
    stderr: { write: (s: string) => { err.push(s); return true; } },
  } as unknown as BaseContext;
  return { context, stdout: () => out.join(''), stderr: () => err.join('') };
}

/** Fake transport recording every URL; delegates to a per-URL handler. */
function fakeFetch(
  handler: (url: string) => Response,
  calls: string[] = [],
): typeof globalThis.fetch {
  return ((input: unknown) => {
    const url = String(input);
    calls.push(url);
    return Promise.resolve(handler(url));
  }) as typeof globalThis.fetch;
}

interface IProject {
  root: string;
  dbPath: string;
}

interface ISetupOptions {
  /** Sidecar annotations projected onto the node row. `null` = none. */
  annotations?: Record<string, unknown> | null;
  /** Contents of `.skill-map/settings.json`. `null` = no file. */
  settings?: Record<string, unknown> | null;
}

/** Committed settings enabling the extension + the network policy. */
function enabledSettings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    allowNetworkActions: true,
    plugins: { github: { extensions: { enrichment: { enabled: true } } } },
    ...overrides,
  };
}

async function setupProject(opts: ISetupOptions = {}): Promise<IProject> {
  counter += 1;
  const root = join(tmpRoot, `proj-${counter}`);
  const dbPath = join(root, '.skill-map', 'skill-map.db');
  mkdirSync(join(root, '.skill-map'), { recursive: true });
  if (opts.settings !== null && opts.settings !== undefined) {
    writeFileSync(join(root, '.skill-map', 'settings.json'), JSON.stringify(opts.settings));
  }

  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  try {
    const annotations = opts.annotations === undefined ? PROVENANCE : opts.annotations;
    await adapter.db
      .insertInto('scan_nodes')
      .values({
        path: NODE_PATH,
        kind: 'markdown',
        provider: 'markdown',
        title: null,
        description: null,
        stability: null,
        version: null,
        sidecarStatus: annotations === null ? null : 'fresh',
        annotationsJson: annotations === null ? null : JSON.stringify(annotations),
        sidecarRootJson: null,
        frontmatterJson: '{}',
        bodyHash: BODY_HASH,
        frontmatterHash: 'f'.repeat(64),
        bytesFrontmatter: 0,
        bytesBody: NODE_BODY.length,
        bytesTotal: NODE_BODY.length,
        tokensFrontmatter: null,
        tokensBody: null,
        tokensTotal: null,
        externalRefsJson: null,
        scannedAt: Date.now(),
        modifiedAtMs: null,
        virtual: 0,
        derivedFromJson: null,
      })
      .execute();
  } finally {
    await adapter.close();
  }

  const abs = join(root, NODE_PATH);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, NODE_FILE);
  return { root, dbPath };
}

async function openDb(dbPath: string): Promise<SqliteStorageAdapter> {
  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  return adapter;
}

function buildRefresh(opts: { node?: string; stale?: boolean; json?: boolean } = {}): EnrichCommand {
  const cmd = new EnrichCommand();
  cmd.nodePath = opts.node;
  cmd.stale = opts.stale ?? false;
  cmd.noPlugins = false;
  cmd.json = opts.json ?? false;
  cmd.quiet = false;
  cmd.noColor = true;
  cmd.db = undefined;
  return cmd;
}

async function runRefresh(
  proj: IProject,
  opts: { node?: string; stale?: boolean; json?: boolean } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const cap = captureContext();
  const cmd = buildRefresh(opts);
  cmd.context = cap.context;
  const orig = process.cwd();
  process.chdir(proj.root);
  try {
    const code = await cmd.execute();
    return { code, stdout: cap.stdout(), stderr: cap.stderr() };
  } finally {
    process.chdir(orig);
  }
}

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-refresh-enrich-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

afterEach(() => {
  _setRefreshFetchForTests(null);
});

describe('sm enrich, allowNetworkActions policy gate', () => {
  it('policy off: skip advisory names the key, exit 0, no state row, no fetch', async () => {
    const proj = await setupProject({
      // Extension enabled, but the committed policy stays at its
      // default (false): the gate must refuse execution.
      settings: { plugins: { github: { extensions: { enrichment: { enabled: true } } } } },
    });
    const calls: string[] = [];
    _setRefreshFetchForTests(fakeFetch(() => new Response(NODE_FILE), calls));

    const run = await runRefresh(proj, { node: NODE_PATH });
    strictEqual(run.code, 0, `stderr: ${run.stderr}`);
    match(run.stderr, /Skipped github\/enrichment/);
    match(run.stderr, /allowNetworkActions/, 'the advisory hint names the config key');
    strictEqual(calls.length, 0, 'the network is never touched under the off policy');

    const adapter = await openDb(proj.dbPath);
    try {
      strictEqual((await adapter.enrichments.listStateForNode(NODE_PATH)).length, 0);
      strictEqual((await adapter.history.list({})).length, 0, 'no execution row either');
    } finally {
      await adapter.close();
    }
  });
});

describe('sm enrich, Model A write-through (policy on)', () => {
  it('persists the state row (verified lifted) + an in-process execution row', async () => {
    const proj = await setupProject({ settings: enabledSettings() });
    const calls: string[] = [];
    _setRefreshFetchForTests(fakeFetch(() => new Response(NODE_FILE), calls));

    const run = await runRefresh(proj, { node: NODE_PATH });
    strictEqual(run.code, 0, `stderr: ${run.stderr}`);
    doesNotMatch(run.stderr, /Skipped/, 'no policy advisory when the gate is open');
    deepStrictEqual(
      calls,
      [`https://raw.githubusercontent.com/octo/tools/${SHA_PIN}/${NODE_PATH}`],
      'a SHA pin fetches the immutable raw URL directly',
    );

    const adapter = await openDb(proj.dbPath);
    try {
      const rows = await adapter.enrichments.listStateForNode(NODE_PATH);
      strictEqual(rows.length, 1);
      const row = rows[0]!;
      strictEqual(row.providerId, ACTION_ID, 'provider_id carries the qualified action id');
      strictEqual(row.verified, true, 'verified lifted from the validated report');
      strictEqual(row.staleAfter, null, 'v1: body-hash drift is the only staleness');
      strictEqual(row.data['localBodyHash'], BODY_HASH);
      strictEqual(row.data['method'], 'raw-sha');

      const executions = await adapter.history.list({});
      strictEqual(executions.length, 1);
      strictEqual(executions[0]!.runner, 'in-process');
      strictEqual(executions[0]!.status, 'completed');
      strictEqual(executions[0]!.extensionId, ACTION_ID);
      deepStrictEqual(executions[0]!.nodeIds, [NODE_PATH]);
    } finally {
      await adapter.close();
    }
  });

  it('--json folds the state row into `refreshed` and the per-node count', async () => {
    const proj = await setupProject({ settings: enabledSettings() });
    _setRefreshFetchForTests(fakeFetch(() => new Response(NODE_FILE)));

    const run = await runRefresh(proj, { node: NODE_PATH, json: true });
    strictEqual(run.code, 0, `stderr: ${run.stderr}`);
    const envelope = JSON.parse(run.stdout) as {
      ok: boolean;
      kind: string;
      refreshed: number;
      nodes: Array<{ path: string; enrichments: number }>;
    };
    strictEqual(envelope.ok, true);
    strictEqual(envelope.kind, 'enrich.report');
    ok(envelope.refreshed >= 1, 'the state row counts toward refreshed');
    const nodeEntry = envelope.nodes.find((n) => n.path === NODE_PATH);
    ok(nodeEntry, 'per-node breakdown carries the target');
    ok(nodeEntry.enrichments >= 1, 'the state row counts toward the per-node total');
  });

  it('a node without provenance annotations is a silent no-op skip', async () => {
    const proj = await setupProject({ settings: enabledSettings(), annotations: null });
    const calls: string[] = [];
    _setRefreshFetchForTests(fakeFetch(() => new Response(NODE_FILE), calls));

    const run = await runRefresh(proj, { node: NODE_PATH });
    strictEqual(run.code, 0, `stderr: ${run.stderr}`);
    doesNotMatch(run.stderr, /github\/enrichment/, 'silent: no advisory of any kind');
    strictEqual(calls.length, 0);

    const adapter = await openDb(proj.dbPath);
    try {
      strictEqual((await adapter.enrichments.listStateForNode(NODE_PATH)).length, 0);
      strictEqual((await adapter.history.list({})).length, 0);
    } finally {
      await adapter.close();
    }
  });

  it('ships disabled: policy on but no extension enable → nothing runs', async () => {
    const proj = await setupProject({ settings: { allowNetworkActions: true } });
    const calls: string[] = [];
    _setRefreshFetchForTests(fakeFetch(() => new Response(NODE_FILE), calls));

    const run = await runRefresh(proj, { node: NODE_PATH });
    strictEqual(run.code, 0, `stderr: ${run.stderr}`);
    strictEqual(calls.length, 0, 'the experimental built-in stays out of the composed catalog');

    const adapter = await openDb(proj.dbPath);
    try {
      strictEqual((await adapter.enrichments.listStateForNode(NODE_PATH)).length, 0);
    } finally {
      await adapter.close();
    }
  });
});

describe('sm enrich --stale, state-row candidates', () => {
  it('picks up a body-drifted row and re-verifies it in place', async () => {
    const proj = await setupProject({ settings: enabledSettings() });
    // Seed a verification recorded against an OLDER body: its
    // localBodyHash no longer matches the node's live body_hash.
    const seed = await openDb(proj.dbPath);
    try {
      await upsertStateEnrichment(seed.db, {
        nodeId: NODE_PATH,
        providerId: ACTION_ID,
        dataJson: JSON.stringify({
          verified: true,
          sourceUrl: `https://raw.githubusercontent.com/octo/tools/${SHA_PIN}/${NODE_PATH}`,
          method: 'raw-sha',
          resolvedSha: null,
          localBodyHash: '0'.repeat(64),
          remoteBodyHash: '0'.repeat(64),
        }),
        verified: true,
        fetchedAt: 1000,
        staleAfter: null,
      });
    } finally {
      await seed.close();
    }
    _setRefreshFetchForTests(fakeFetch(() => new Response(NODE_FILE)));

    const run = await runRefresh(proj, { stale: true });
    strictEqual(run.code, 0, `stderr: ${run.stderr}`);
    doesNotMatch(run.stdout, /No stale enrichment rows/);

    const adapter = await openDb(proj.dbPath);
    try {
      const rows = await adapter.enrichments.listStateForNode(NODE_PATH);
      strictEqual(rows.length, 1, 'the row was replaced in place, not duplicated');
      strictEqual(rows[0]!.data['localBodyHash'], BODY_HASH, 're-verified at the live body');
      strictEqual(rows[0]!.verified, true);
      ok(rows[0]!.fetchedAt > 1000, 'fetched_at refreshed');
    } finally {
      await adapter.close();
    }
  });

  it('reports nothing to do when no state row drifted', async () => {
    const proj = await setupProject({ settings: enabledSettings() });
    _setRefreshFetchForTests(fakeFetch(() => new Response(NODE_FILE)));

    const run = await runRefresh(proj, { stale: true });
    strictEqual(run.code, 0, `stderr: ${run.stderr}`);
    match(run.stdout, /No stale enrichment rows/);
  });
});
