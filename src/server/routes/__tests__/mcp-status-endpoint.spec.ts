/**
 * `GET /api/mcp/status` unit tests (the live MCP-connection probe behind
 * the Quick Start "MCP installed on your agent" check;
 * `spec/cli-contract.md` §Serve route table).
 *
 * The route is a thin read over `IServerOptions.mcpServer` (enabled) and
 * `McpSessionManager.sessionCount` (connected), so a mounted Hono app with
 * a stub manager exercises the whole contract without a full server boot:
 *   - MCP on + a live session -> enabled: true,  connected: true,  clients: n
 *   - MCP on + no sessions     -> enabled: true,  connected: false, clients: 0
 *   - MCP off (null manager)   -> enabled: false, connected: false, clients: 0
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { Hono } from 'hono';

import type { McpSessionManager } from '../../mcp/session-manager.js';
import type { IServerOptions } from '../../options.js';
import { registerMcpStatusRoute } from '../mcp-status.js';

/** Minimal stubs: the route only reads `sessionCount` and `mcpServer`. */
function stubManager(sessionCount: number): McpSessionManager {
  return { sessionCount } as unknown as McpSessionManager;
}
function stubOptions(mcpServer: boolean, port = 4242, host = '127.0.0.1'): IServerOptions {
  return { mcpServer, host, port } as unknown as IServerOptions;
}

async function getStatus(
  mcpManager: McpSessionManager | null,
  mcpServer: boolean,
): Promise<Record<string, unknown>> {
  const app = new Hono();
  registerMcpStatusRoute(app, { options: stubOptions(mcpServer), mcpManager });
  const res = await app.request('/api/mcp/status');
  assert.equal(res.status, 200);
  return (await res.json()) as Record<string, unknown>;
}

describe('GET /api/mcp/status', () => {
  /**
   * `url` is built from the server's OWN bind, not the request's Host
   * header: under a split dev setup the SPA's origin is the proxy's port,
   * so a UI composing the URL itself would hand out a dead address.
   */
  it('reports the endpoint a client registers, from the server bind', async () => {
    const app = new Hono();
    registerMcpStatusRoute(app, { options: stubOptions(true, 4999), mcpManager: null });
    const res = await app.request('/api/mcp/status');
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body['url'], 'http://127.0.0.1:4999/mcp');
  });

  it('reports a wildcard bind as loopback (what a local agent can dial)', async () => {
    const app = new Hono();
    registerMcpStatusRoute(app, { options: stubOptions(true, 4242, '0.0.0.0'), mcpManager: null });
    const res = await app.request('/api/mcp/status');
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body['url'], 'http://127.0.0.1:4242/mcp');
  });

  it('enabled + connected when a live session exists', async () => {
    const body = await getStatus(stubManager(1), true);
    assert.equal(body['enabled'], true);
    assert.equal(body['connected'], true);
    assert.equal(body['clients'], 1);
    assert.equal(body['kind'], 'mcp-status');
  });

  it('enabled but not connected when no sessions', async () => {
    const body = await getStatus(stubManager(0), true);
    assert.equal(body['enabled'], true);
    assert.equal(body['connected'], false);
    assert.equal(body['clients'], 0);
  });

  it('disabled when the MCP server is off (null manager)', async () => {
    const body = await getStatus(null, false);
    assert.equal(body['enabled'], false);
    assert.equal(body['connected'], false);
    assert.equal(body['clients'], 0);
  });
});
