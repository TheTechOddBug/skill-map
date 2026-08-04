/**
 * Liveness sweep over real `/mcp` sessions (`spec/mcp-server.md`
 * §Session liveness).
 *
 * The defect this guards: a session ends only on `DELETE /mcp` or on
 * shutdown, so a host that vanishes leaves one behind, and the reference
 * SDK client's own `close()` aborts its streams WITHOUT sending `DELETE`.
 * Reading the session map therefore reported a dead agent as attached
 * until the next `sm serve` restart, which is exactly what the Quick Start
 * "MCP installed on your agent" row showed green with nothing running.
 *
 * Real transport on both ends (SDK `Client` over Streamable HTTP against
 * the real `McpSessionManager`, mounted on a Hono app on an ephemeral
 * port), because the whole question is what the wire does when a peer
 * stops answering, which a stubbed transport cannot pose. The session
 * factory is a bare `McpServer`: liveness is a transport property, so
 * none of skill-map's tools or resources are involved.
 */

import { strict as assert } from 'node:assert';
import type { Server } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { serve } from '@hono/node-server';
// eslint-disable-next-line import-x/extensions
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
// eslint-disable-next-line import-x/extensions
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
// eslint-disable-next-line import-x/extensions
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
// eslint-disable-next-line import-x/extensions
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { Hono } from 'hono';

import { registerMcpRoute } from '../integration.js';
import { McpSessionManager } from '../session-manager.js';

/** Short deadline: the test asserts verdicts, not the production tuning. */
const PING_TIMEOUT_MS = 500;

/**
 * The SDK client opens its standalone `GET /mcp` stream fire-and-forget
 * once `notifications/initialized` is accepted, so `connect()` resolves a
 * beat BEFORE the server has anywhere to write a ping. A frame written
 * into that gap is dropped silently, which is why production tolerates a
 * run of misses; a test that sweeps microseconds after connecting would
 * otherwise measure the gap instead of the client.
 */
const STREAM_SETTLE_MS = 250;

interface IHarness {
  manager: McpSessionManager;
  connect(): Promise<Client>;
  dispose(): Promise<void>;
}

/**
 * One manager behind a real HTTP listener on an ephemeral port. `graceMs`
 * is per-harness: 0 makes a failed ping reap on the spot, a long window
 * exercises the reprieve a POST-only client depends on.
 */
async function bootHarness(graceMs: number): Promise<IHarness> {
  const manager = new McpSessionManager(
    () => ({
      server: new McpServer({ name: 'liveness-test', version: '0.0.0' }),
      subscriptions: new Set<string>(),
    }),
    { pingTimeoutMs: PING_TIMEOUT_MS, graceMs },
  );
  const app = new Hono();
  registerMcpRoute(app, manager);
  const { server, port } = await new Promise<{ server: Server; port: number }>((resolve) => {
    const handle = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, (info) => {
      resolve({ server: handle as unknown as Server, port: info.port });
    });
  });

  return {
    manager,
    async connect(): Promise<Client> {
      const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
      const client = new Client({ name: 'liveness-client', version: '0.0.0' });
      // Same `exactOptionalPropertyTypes` skew the other MCP specs bridge:
      // the class implements `Transport`, its `sessionId` is declared wider.
      await client.connect(transport as unknown as Transport);
      await delay(STREAM_SETTLE_MS);
      return client;
    },
    async dispose(): Promise<void> {
      await manager.closeAll();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describe('mcp session liveness', () => {
  let h: IHarness;

  before(async () => {
    h = await bootHarness(0);
  });
  after(() => h.dispose());

  it('counts a connected client, then stops counting it once it vanishes', async () => {
    const client = await h.connect();
    assert.equal(await h.manager.sweepLiveSessions(), 1, 'a live client answers the ping');

    // `close()` aborts the client's streams and sends NO `DELETE`, which
    // is both what the SDK does on an orderly close and what a killed
    // process leaves behind. The session survives on the server.
    await client.close();
    assert.equal(h.manager.sessionCount, 1, 'the abandoned session is still tracked');

    assert.equal(await h.manager.sweepLiveSessions(), 0, 'nobody answers, nobody is counted');
    assert.equal(h.manager.sessionCount, 0, 'and the abandoned session is reaped');
  });

  it('counts two clients independently', async () => {
    const first = await h.connect();
    const second = await h.connect();
    try {
      assert.equal(await h.manager.sweepLiveSessions(), 2);
      await second.close();
      assert.equal(await h.manager.sweepLiveSessions(), 1, 'only the survivor counts');
    } finally {
      await first.close();
      await h.manager.sweepLiveSessions();
    }
  });

  it('concurrent sweeps share one pass and agree', async () => {
    const client = await h.connect();
    try {
      const [a, b] = await Promise.all([
        h.manager.sweepLiveSessions(),
        h.manager.sweepLiveSessions(),
      ]);
      assert.equal(a, 1);
      assert.equal(b, 1);
    } finally {
      await client.close();
      await h.manager.sweepLiveSessions();
    }
  });
});

describe('mcp session liveness, within the grace window', () => {
  let h: IHarness;

  before(async () => {
    h = await bootHarness(60_000);
  });
  after(() => h.dispose());

  /**
   * The conservative half of the rule: a silent session that was active
   * moments ago is left out of the count but NOT reaped, because reaping
   * is one-way and a POST-only client cannot answer a ping at all.
   */
  it('drops a silent session from the count but keeps it alive', async () => {
    const client = await h.connect();
    assert.equal(await h.manager.sweepLiveSessions(), 1);
    await client.close();
    assert.equal(await h.manager.sweepLiveSessions(), 0, 'silence is not attendance');
    assert.equal(h.manager.sessionCount, 1, 'but recent traffic buys it a reprieve');
  });
});
