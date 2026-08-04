/**
 * MCP integration wiring, the seam between the composition root
 * (`server/index.ts`) and the Hono app (`server/app.ts`).
 *
 * Split into two halves that mirror the broadcaster precedent:
 *
 *   - `createMcpIntegration(deps)` (composition root): builds the session
 *     manager, registers the realtime sink on the ONE `WsBroadcaster`,
 *     arms the unattended liveness sweep, and returns a `dispose()` for
 *     graceful shutdown. Only called when the MCP server is enabled.
 *   - `registerMcpRoute(app, manager)` (createApp): wires the top-level
 *     `POST/GET/DELETE /mcp` routes to the manager. `/mcp` is a sibling of
 *     `/ws`, OUTSIDE `/api/*`, registered BEFORE the static + SPA
 *     fallback so it is not shadowed.
 *
 * Each route hands the raw Node `incoming` / `outgoing` (pulled off the
 * `@hono/node-server` bindings on `c.env`) to the transport and returns
 * `RESPONSE_ALREADY_SENT` so Hono does not double-send. The POST body is
 * parsed with `c.req.json()` and passed as `parsedBody` (the Web Request
 * body is consumed by that call, so the transport MUST get the parsed
 * value rather than re-reading the stream).
 */

import type { ServerResponse } from 'node:http';

import type { HttpBindings } from '@hono/node-server';
// eslint-disable-next-line import-x/extensions
import { RESPONSE_ALREADY_SENT } from '@hono/node-server/utils/response';
import type { Context, Hono } from 'hono';

import type { IPluginRuntime } from '../../core/runtime/plugin-runtime.js';
import type { ActivityStatsService } from '../activity-stats.js';
import type { WsBroadcaster } from '../broadcaster.js';
import { createMcpServer } from './mcp-server.js';
import { McpSessionManager, type TMcpMethod } from './session-manager.js';
import { createMcpBroadcasterSink } from './sink.js';

/** Composition-root inputs for the whole MCP surface. */
export interface IMcpIntegrationDeps {
  /** Absolute project DB path (`IServerOptions.dbPath`). */
  dbPath: string;
  /** Project root (`runtimeContext.cwd`). */
  cwd: string;
  /** `serverInfo.version`, the CLI `implVersion` (`src/version.ts`). */
  implVersion: string;
  /** Boot-scoped execution-stats accumulator (for `skillmap://activity`). */
  activityStats: ActivityStatsService;
  /** The one `/ws` broadcaster the realtime sink + queue tools use. */
  broadcaster: WsBroadcaster;
  /** Boot-cached plugin runtime, threaded to the queue tools' submit / record. */
  pluginRuntime: IPluginRuntime;
  /** Presence hook for `claim_job` attempts (see `IMcpWriteContext`). */
  onClaimAttempt?: () => void;
}

export interface IMcpIntegration {
  /** The session manager the Hono routes route into. */
  manager: McpSessionManager;
  /**
   * Graceful shutdown: stop the liveness sweep, unregister the broadcaster
   * sink and close every live MCP session. Idempotent. Called from
   * `createServer`'s `close()`.
   */
  dispose(): Promise<void>;
}

/**
 * Cadence of the unattended liveness sweep. The `/api/mcp/status` probe
 * sweeps on demand, but nothing guarantees anyone opens the panel, and an
 * abandoned session keeps holding a slot against `MAX_MCP_SESSIONS` and
 * taking notification fan-out. A minute is far below the pace at which a
 * long-lived `sm serve` accumulates dead hosts, and the sweep costs one
 * ping per session. Tuning is unsupported pre-v1.
 */
export const MCP_SWEEP_INTERVAL_MS = 60_000;

/**
 * Build the MCP integration: a session manager whose per-session factory
 * mints a fresh `McpServer`, plus a realtime sink registered on the
 * broadcaster. The composition root owns the returned lifecycle.
 */
export function createMcpIntegration(deps: IMcpIntegrationDeps): IMcpIntegration {
  const manager = new McpSessionManager(() =>
    createMcpServer({
      dbPath: deps.dbPath,
      cwd: deps.cwd,
      implVersion: deps.implVersion,
      activityStats: deps.activityStats,
      pluginRuntime: deps.pluginRuntime,
      ...(deps.onClaimAttempt ? { onClaimAttempt: deps.onClaimAttempt } : {}),
      broadcaster: deps.broadcaster,
    }),
  );
  const sink = createMcpBroadcasterSink(manager);
  deps.broadcaster.register(sink);

  // Unattended liveness sweep, mirroring how the composition root owns the
  // `/ws` heartbeat timer while the mechanism lives with the peer's owner.
  // Failures are swallowed by the sweep itself; nothing here can reject.
  const sweep = setInterval(() => {
    void manager.sweepLiveSessions();
  }, MCP_SWEEP_INTERVAL_MS);
  // Never let the sweep alone hold the event loop open.
  sweep.unref?.();

  return {
    manager,
    async dispose(): Promise<void> {
      clearInterval(sweep);
      deps.broadcaster.unregister(sink);
      await manager.closeAll();
    },
  };
}

/**
 * Register the top-level `/mcp` routes on the Hono app. Call once, from
 * `createApp`, only when the MCP server is enabled.
 */
export function registerMcpRoute(app: Hono, manager: McpSessionManager): void {
  app.post('/mcp', (c) => handleMcp(c, manager, 'POST'));
  app.get('/mcp', (c) => handleMcp(c, manager, 'GET'));
  app.delete('/mcp', (c) => handleMcp(c, manager, 'DELETE'));
}

async function handleMcp(
  c: Context,
  manager: McpSessionManager,
  method: TMcpMethod,
): Promise<Response> {
  const { incoming, outgoing } = nodeIo(c);
  let parsedBody: unknown;
  if (method === 'POST') {
    try {
      parsedBody = await c.req.json();
    } catch {
      writeParseError(outgoing);
      return RESPONSE_ALREADY_SENT;
    }
  }
  await manager.handleRequest(method, incoming, outgoing, parsedBody);
  return RESPONSE_ALREADY_SENT;
}

/**
 * Pull the raw Node `IncomingMessage` / `ServerResponse` off the
 * `@hono/node-server` bindings (`c.env.incoming` / `c.env.outgoing`),
 * mirroring how `ws.ts` grabs `WSContext.raw`. We only ever bind an
 * HTTP/1.1 listener, so `HttpBindings` is the right shape.
 */
function nodeIo(c: Context): { incoming: HttpBindings['incoming']; outgoing: ServerResponse } {
  const env = c.env as unknown as HttpBindings;
  return { incoming: env.incoming, outgoing: env.outgoing };
}

/** Emit a JSON-RPC parse error (-32700) for a malformed POST body. */
function writeParseError(outgoing: ServerResponse): void {
  if (outgoing.headersSent || outgoing.writableEnded) return;
  outgoing.writeHead(400, { 'content-type': 'application/json' });
  outgoing.end(
    JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }),
  );
}
