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

  it('lists the four read-only tools', async () => {
    await prime([makeNode('a.md', 'skill')]);
    await bootAndUse(options(), (handle) =>
      withMcpClient(handle, async (client) => {
        const { tools } = await client.listTools();
        const names = tools.map((t) => t.name).sort();
        assert.deepEqual(names, ['get_branch', 'get_node', 'list_issues', 'query_graph']);
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

        await withTimeout(gotUpdate, 4000, 'notifications/resources/updated for skillmap://graph');
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
