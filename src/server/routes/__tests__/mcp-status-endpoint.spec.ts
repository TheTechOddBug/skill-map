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
function stubOptions(mcpServer: boolean): IServerOptions {
  return { mcpServer } as unknown as IServerOptions;
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
