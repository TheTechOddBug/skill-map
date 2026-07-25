/**
 * `GET /api/mcp/status`, the live MCP-connection probe behind the Quick
 * Start panel's "MCP installed on your agent" check.
 *
 * Reports two facts:
 *   - `enabled`: whether skill-map is exposing `/mcp` at all (the resolved
 *     `mcp.server.enabled`, from `IServerOptions.mcpServer`).
 *   - `connected`: whether at least one client is CURRENTLY connected to
 *     `/mcp`, i.e. the `McpSessionManager` holds a live stateful session.
 *
 * The connection signal is deliberately SCOPE-AGNOSTIC and needs no
 * `$HOME` read: the server sees the live session no matter which Claude
 * Code scope (local / project / user) registered it. This is the honest
 * end-to-end signal for "the agent is actually attached", complementing
 * the passive `mcp://skill-map` graph scan (which only sees a project
 * `.mcp.json`). When the MCP server is off the session manager is null, so
 * `enabled` and `connected` are both false and `clients` is 0.
 */

import type { Hono } from 'hono';

import type { McpSessionManager } from '../mcp/session-manager.js';
import type { IServerOptions } from '../options.js';

/** Narrow deps: the enabled flag plus the live session manager (or null). */
export interface IMcpStatusRouteDeps {
  options: IServerOptions;
  /** The live MCP session manager, or `null` when the server is disabled. */
  mcpManager: McpSessionManager | null;
}

/**
 * The endpoint a client registers, built from the server's OWN bind. The
 * page origin is NOT a substitute: under the dev setup the SPA is served by
 * a separate dev server that proxies `/api`, so its origin names the proxy's
 * port, not the one `/mcp` listens on. A wildcard bind is reported as
 * loopback because that is what a local agent can actually dial.
 */
function mcpEndpointUrl(options: IServerOptions): string {
  const host = options.host === '0.0.0.0' || options.host === '::' ? '127.0.0.1' : options.host;
  // IPv6 literals need brackets in a URL authority.
  const authority = host.includes(':') ? `[${host}]` : host;
  return `http://${authority}:${options.port}/mcp`;
}

export function registerMcpStatusRoute(app: Hono, deps: IMcpStatusRouteDeps): void {
  app.get('/api/mcp/status', (c) => {
    const clients = deps.mcpManager?.sessionCount ?? 0;
    return c.json({
      schemaVersion: '1',
      kind: 'mcp-status',
      enabled: deps.options.mcpServer,
      connected: clients > 0,
      clients,
      url: mcpEndpointUrl(deps.options),
    });
  });
}
