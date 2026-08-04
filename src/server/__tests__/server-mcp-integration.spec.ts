/**
 * End-to-end integration test for the read-only MCP server mounted on
 * `sm serve` (`spec/mcp-server.md`).
 *
 * Boots the full Hono BFF with `mcpServer: true` on an ephemeral port and
 * speaks real MCP over `/mcp` using the SDK's `Client` +
 * `StreamableHTTPClientTransport` (stateful session): `initialize` →
 * `tools/list` → `resources/list` → `tools/call` → `resources/read`, plus
 * the realtime path (`resources/subscribe` → a `scan.completed` broadcast
 * → a `notifications/resources/updated` frame).
 *
 * One-shot boot per `createServer`, always closed in a `try/finally`, and
 * `--port 0` so the OS picks a free port (never a watcher).
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

// eslint-disable-next-line import-x/extensions
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
// eslint-disable-next-line import-x/extensions
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
// eslint-disable-next-line import-x/extensions
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
// eslint-disable-next-line import-x/extensions
import { ResourceUpdatedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';

import { SqliteStorageAdapter } from '../../kernel/adapters/sqlite/index.js';
import { persistScanResult } from '../../kernel/adapters/sqlite/scan-persistence.js';
import type { Issue, Node, ScanResult } from '../../kernel/types.js';
import { createServer, type IServerHandle, type IServerOptions } from '../index.js';
import {
  FINDER_ID,
  seedFindings,
  setupProbProject,
  SKILL_NODE,
  SUMMARIZER_ID,
  withProjectDb,
} from '../routes/__tests__/helpers/prob-fixture.js';

const HASH = 'a'.repeat(64);

interface ITestRoot {
  tmp: string;
  dbPath: string;
}

let root: ITestRoot;

before(() => {
  const tmp = mkdtempSync(join(tmpdir(), 'skill-map-mcp-integration-'));
  root = { tmp, dbPath: join(tmp, 'primed.db') };
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

function makeIssue(nodeIds: string[]): Issue {
  return { analyzerId: 'core/reference-broken', severity: 'error', nodeIds, message: 'planted' };
}

async function prime(nodes: Node[], issues: Issue[] = []): Promise<void> {
  const result: ScanResult = {
    schemaVersion: 1,
    scannedAt: Date.now(),
    roots: [root.tmp],
    providers: ['claude'],
    nodes,
    links: [],
    issues,
    stats: {
      filesWalked: nodes.length,
      filesSkipped: 0,
      nodesCount: nodes.length,
      linksCount: 0,
      issuesCount: issues.length,
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

function options(overrides: Partial<IServerOptions> = {}): IServerOptions {
  return {
    port: 0,
    host: '127.0.0.1',
    dbPath: root.dbPath,
    uiDist: null,
    noUi: true,
    noBuiltIns: false,
    noPlugins: true,
    open: false,
    devCors: false,
    noWatcher: true,
    mcpServer: true,
    settingsEnv: {},
    ...overrides,
  };
}

async function withMcpClient<T>(
  handle: IServerHandle,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const url = new URL(`http://127.0.0.1:${handle.address.port}/mcp`);
  const transport = new StreamableHTTPClientTransport(url);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  // Cast bridges the same `exactOptionalPropertyTypes` type-skew as the
  // server transport (`sessionId: string | undefined` vs `Transport`'s
  // `sessionId?: string`); the class implements `Transport`.
  await client.connect(transport as unknown as Transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

async function bootAndUse<T>(
  opts: IServerOptions,
  fn: (handle: IServerHandle) => Promise<T>,
): Promise<T> {
  const handle = await createServer(opts, { runtimeContext: { cwd: root.tmp } });
  try {
    return await fn(handle);
  } finally {
    await handle.close();
  }
}

describe('mcp server integration', () => {
  it('advertises the exact capabilities on initialize', async () => {
    await prime([makeNode('a.md', 'skill')]);
    await bootAndUse(options(), (handle) =>
      withMcpClient(handle, async (client) => {
        const caps = client.getServerCapabilities();
        assert.ok(caps?.tools, 'tools capability advertised');
        assert.equal(caps?.tools?.listChanged, true);
        assert.equal(caps?.resources?.subscribe, true);
        assert.equal(caps?.resources?.listChanged, true);
      }),
    );
  });

  it('lists the four read map tools', async () => {
    await prime([makeNode('a.md', 'skill')]);
    await bootAndUse(options(), (handle) =>
      withMcpClient(handle, async (client) => {
        const { tools } = await client.listTools();
        const names = tools.map((t) => t.name);
        // The map read tools are present (the queue + findings tools ride
        // the same opt-in, asserted in the full-surface test below).
        for (const tool of ['get_branch', 'get_node', 'list_issues', 'query_graph']) {
          assert.equal(names.includes(tool), true, `${tool} must be registered`);
        }
      }),
    );
  });

  it('lists the coarse resources and the per-node template', async () => {
    await prime([makeNode('a.md', 'skill')]);
    await bootAndUse(options(), (handle) =>
      withMcpClient(handle, async (client) => {
        const { resources } = await client.listResources();
        const uris = resources.map((r) => r.uri).sort();
        assert.deepEqual(uris, ['skillmap://activity', 'skillmap://graph', 'skillmap://issues']);
        const { resourceTemplates } = await client.listResourceTemplates();
        assert.equal(resourceTemplates.length, 1);
        assert.equal(resourceTemplates[0]?.uriTemplate, 'skillmap://node/{+path}');
      }),
    );
  });

  it('answers tools/call query_graph with JSON structured content', async () => {
    await prime([makeNode('a.md', 'skill'), makeNode('b.md', 'agent')], [makeIssue(['a.md'])]);
    await bootAndUse(options(), (handle) =>
      withMcpClient(handle, async (client) => {
        const result = await client.callTool({ name: 'query_graph', arguments: {} });
        const structured = result.structuredContent as unknown as {
          nodes: unknown[];
          links: unknown[];
          issues: unknown[];
        };
        assert.equal(structured.nodes.length, 2);
        assert.equal(structured.issues.length, 1);
      }),
    );
  });

  it('reads the graph resource as application/json', async () => {
    await prime([makeNode('a.md', 'skill')]);
    await bootAndUse(options(), (handle) =>
      withMcpClient(handle, async (client) => {
        const res = await client.readResource({ uri: 'skillmap://graph' });
        assert.equal(res.contents.length, 1);
        assert.equal(res.contents[0]?.mimeType, 'application/json');
        const scan = JSON.parse(resourceText(res.contents[0])) as { nodes: unknown[] };
        assert.equal(scan.nodes.length, 1);
      }),
    );
  });

  it('reads a per-node resource through the {+path} template', async () => {
    await prime([makeNode('sub/deep.md', 'skill')]);
    await bootAndUse(options(), (handle) =>
      withMcpClient(handle, async (client) => {
        const res = await client.readResource({ uri: 'skillmap://node/sub/deep.md' });
        const bundle = JSON.parse(resourceText(res.contents[0])) as { item: { path: string } };
        assert.equal(bundle.item.path, 'sub/deep.md');
      }),
    );
  });

  it('delivers notifications/resources/updated to a subscribed session on scan.completed', async () => {
    await prime([makeNode('a.md', 'skill')]);
    await bootAndUse(options(), (handle) =>
      withMcpClient(handle, async (client) => {
        const updated: string[] = [];
        let resolveUpdate: (() => void) | undefined;
        const gotUpdate = new Promise<void>((resolve) => {
          resolveUpdate = resolve;
        });
        client.setNotificationHandler(ResourceUpdatedNotificationSchema, (notification) => {
          updated.push(notification.params.uri);
          if (notification.params.uri === 'skillmap://graph') resolveUpdate?.();
        });

        await client.subscribeResource({ uri: 'skillmap://graph' });

        // Drive the realtime path: a scan.completed envelope on the same
        // in-process broadcaster the sink observes.
        handle.broadcaster.broadcast({
          type: 'scan.completed',
          timestamp: Date.now(),
          jobId: null,
          data: {},
        });

        // A HANG BACKSTOP, not a latency assertion. The delivery path is
        // synchronous (`scan.completed` -> `notifyResourceUpdated` ->
        // `sendResourceUpdated`, no debounce) and this test measures 40-180ms
        // locally, yet the old 4s budget still expired in CI on 2026-08-03.
        // The mechanism is event-loop starvation, not slowness: `node --test`
        // runs 401 files concurrently and the same run took 805s against a
        // 596s baseline, so a contended runner can starve this round-trip well
        // past a margin that looks like 20x. Sized to match the sibling
        // `server-ws-integration` waits (8s) with room to spare; if it ever
        // fires, suspect a real hang rather than raising it again.
        await withTimeout(gotUpdate, 15000, 'notifications/resources/updated for skillmap://graph');
        assert.ok(updated.includes('skillmap://graph'));
      }),
    );
  });

  it('does NOT notify a session that never subscribed', async () => {
    await prime([makeNode('a.md', 'skill')]);
    await bootAndUse(options(), (handle) =>
      withMcpClient(handle, async (client) => {
        const updated: string[] = [];
        client.setNotificationHandler(ResourceUpdatedNotificationSchema, (n) => {
          updated.push(n.params.uri);
        });
        // No subscribe. Broadcast, then give the stream a beat to (not) deliver.
        handle.broadcaster.broadcast({
          type: 'scan.completed',
          timestamp: Date.now(),
          jobId: null,
          data: {},
        });
        await delay(300);
        assert.deepEqual(updated, []);
      }),
    );
  });

  it('registers the full surface (map reads + queue + findings) on the one opt-in', async () => {
    await prime([makeNode('a.md', 'skill')]);
    await bootAndUse(options(), (handle) =>
      withMcpClient(handle, async (client) => {
        const names = (await client.listTools()).tools.map((t) => t.name);
        // The read map tools plus the queue + findings tools all ride the
        // same `mcp.server.enabled` opt-in (unified 2026-07-23).
        for (const tool of [
          'query_graph',
          'get_node',
          'list_issues',
          'get_branch',
          'list_extensions',
          'submit_job',
          'claim_job',
          'record_job',
          'cancel_job',
          'fail_job',
          'list_findings',
          'resolve_finding',
          'dismiss_finding',
          'reopen_finding',
          'undismiss_finding',
          'delete_finding',
          'dismiss_issue',
          'undismiss_issue',
          'list_issue_suppressions',
        ]) {
          assert.equal(names.includes(tool), true, `${tool} must be registered`);
        }
      }),
    );
  });

  it('does not mount /mcp when the MCP server is disabled', async () => {
    await prime([makeNode('a.md', 'skill')]);
    await bootAndUse(options({ mcpServer: false }), async (handle) => {
      const res = await fetch(`http://127.0.0.1:${handle.address.port}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '0' } },
        }),
      });
      // With MCP off, `/mcp` falls through to the SPA `*` handler, never a
      // JSON-RPC initialize response.
      const body = await res.text();
      assert.equal(res.headers.get('mcp-session-id'), null);
      assert.doesNotMatch(body, /"result"\s*:\s*\{[^}]*"protocolVersion"/);
    });
  });

  /**
   * `GET /api/mcp/status` must report VERIFIED attendance. A client that
   * goes away without `DELETE /mcp` (what the SDK's own `close()` does,
   * and what a killed agent leaves behind) keeps its session in the map,
   * which is how the Quick Start "MCP installed on your agent" row read
   * "Connected" with nothing running until the next `sm serve` restart.
   * The reap rule itself is unit-tested in `mcp/__tests__/session-liveness`;
   * what matters here is that the route's verdict follows the sweep.
   */
  it('stops reporting a client that vanished without a DELETE', async () => {
    await prime([makeNode('a.md', 'skill')]);
    await bootAndUse(options(), async (handle) => {
      const status = async (): Promise<{ connected: boolean; clients: number }> => {
        const res = await fetch(`http://127.0.0.1:${handle.address.port}/api/mcp/status`);
        return (await res.json()) as { connected: boolean; clients: number };
      };
      const url = new URL(`http://127.0.0.1:${handle.address.port}/mcp`);
      const transport = new StreamableHTTPClientTransport(url);
      const client = new Client({ name: 'test-client', version: '0.0.0' });
      await client.connect(transport as unknown as Transport);
      // The client opens its server → client stream a beat after
      // `initialized`; a ping fired into that gap is dropped silently.
      await delay(250);

      const attached = await status();
      assert.equal(attached.connected, true, 'a live client answers and is reported');
      assert.equal(attached.clients, 1);

      await client.close();
      const vanished = await status();
      assert.equal(vanished.connected, false, 'a tracked session is not attendance');
      assert.equal(vanished.clients, 0);
    });
  });
});

describe('mcp write tools (opt-in) transport round-trip', () => {
  const VALID_REPORT = {
    summary: 'A one-line summary of the node.',
    confidence: 0.9,
    safety: { injectionDetected: false, contentQuality: 'clean' },
  };
  let writeRoot: string;
  let counter = 0;

  before(() => {
    writeRoot = mkdtempSync(join(tmpdir(), 'skill-map-mcp-write-'));
  });

  after(() => {
    rmSync(writeRoot, { recursive: true, force: true });
  });

  it('drives submit -> claim -> record -> resolve over the real SDK client', async () => {
    counter += 1;
    const project = await setupProbProject(join(writeRoot, `p-${counter}`), [SKILL_NODE], {
      installSkill: true,
    });
    // Seed a finder finding up front so `resolve_finding` has a real id.
    await seedFindings(project, SKILL_NODE.path, FINDER_ID, [{ type: 'redundancy' }]);
    const findingId = await withProjectDb(project, async (adapter) =>
      (await adapter.findings.list({ nodeId: SKILL_NODE.path, includeStale: true }))[0]!.id,
    );

    const opts: IServerOptions = {
      port: 0,
      host: '127.0.0.1',
      dbPath: project.dbPath,
      uiDist: null,
      noUi: true,
      noBuiltIns: false,
      noPlugins: false,
      open: false,
      devCors: false,
      noWatcher: true,
      mcpServer: true,
      settingsEnv: {},
    };
    const handle = await createServer(opts, { runtimeContext: { cwd: project.root } });
    try {
      await withMcpClient(handle, async (client) => {
        // The write families are registered.
        const names = (await client.listTools()).tools.map((t) => t.name);
        for (const write of ['submit_job', 'claim_job', 'record_job', 'resolve_finding']) {
          assert.ok(names.includes(write), `${write} registered`);
        }

        const submit = await client.callTool({
          name: 'submit_job',
          arguments: { node: SKILL_NODE.path, extension: SUMMARIZER_ID },
        });
        const submitted = submit.structuredContent as { outcome: string; jobId: string };
        assert.equal(submitted.outcome, 'created');

        const claim = await client.callTool({ name: 'claim_job', arguments: {} });
        const claimed = claim.structuredContent as { id: string; nonce: string; content: string };
        assert.equal(claimed.id, submitted.jobId);
        assert.ok(claimed.nonce.length > 0);
        assert.ok(claimed.content.length > 0);

        const record = await client.callTool({
          name: 'record_job',
          arguments: {
            id: claimed.id,
            nonce: claimed.nonce,
            status: 'completed',
            report: JSON.stringify(VALID_REPORT),
          },
        });
        const recorded = record.structuredContent as { outcome: string; executionId: string };
        assert.equal(recorded.outcome, 'completed');
        assert.match(recorded.executionId, /^e-/);

        const resolved = await client.callTool({
          name: 'resolve_finding',
          arguments: { id: findingId },
        });
        assert.equal((resolved.structuredContent as { outcome: string }).outcome, 'resolved');
      });
    } finally {
      await handle.close();
    }

    // The job actually closed in the DB.
    await withProjectDb(project, async (adapter) => {
      const job = await adapter.jobs.get((await adapter.jobs.list({}))[0]!.id);
      assert.equal(job?.status, 'completed');
    });
  });

  it('discovers extensions, reads findings by node and project-wide, and deletes one', async () => {
    counter += 1;
    const project = await setupProbProject(join(writeRoot, `p-${counter}`), [SKILL_NODE], {
      installSkill: true,
    });
    await seedFindings(project, SKILL_NODE.path, FINDER_ID, [
      { type: 'redundancy' },
      { type: 'contradiction' },
    ]);
    const opts: IServerOptions = {
      port: 0,
      host: '127.0.0.1',
      dbPath: project.dbPath,
      uiDist: null,
      noUi: true,
      noBuiltIns: false,
      noPlugins: false,
      open: false,
      devCors: false,
      noWatcher: true,
      mcpServer: true,
      settingsEnv: {},
    };
    const handle = await createServer(opts, { runtimeContext: { cwd: project.root } });
    try {
      await withMcpClient(handle, async (client) => {
        // list_extensions surfaces the fixture's finder / fixer / standalone.
        const ext = (
          await client.callTool({ name: 'list_extensions', arguments: {} })
        ).structuredContent as { extensions: { id: string; role: string }[] };
        const roles = new Map(ext.extensions.map((e) => [e.id, e.role]));
        assert.equal(roles.get(FINDER_ID), 'finder');

        // list_findings: node-scoped and project-wide.
        const scoped = (
          await client.callTool({
            name: 'list_findings',
            arguments: { node: SKILL_NODE.path },
          })
        ).structuredContent as { findings: { id: number }[] };
        assert.equal(scoped.findings.length, 2);
        const all = (await client.callTool({ name: 'list_findings', arguments: {} }))
          .structuredContent as { findings: { id: number }[] };
        assert.equal(all.findings.length, 2);

        // delete_finding removes one; list_findings then shows one left.
        const del = await client.callTool({
          name: 'delete_finding',
          arguments: { id: scoped.findings[0]!.id },
        });
        assert.equal((del.structuredContent as { outcome: string }).outcome, 'deleted');
        const left = (await client.callTool({ name: 'list_findings', arguments: {} }))
          .structuredContent as { findings: { id: number }[] };
        assert.equal(left.findings.length, 1);
      });
    } finally {
      await handle.close();
    }
  });

});

/** Extract the text of a resource content block (never a blob in our reads). */
function resourceText(content: { text?: string } | { blob?: string } | undefined): string {
  if (content && 'text' in content && typeof content.text === 'string') return content.text;
  return '';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
