/**
 * `createMcpServer(deps)`, factory for one session's `McpServer`.
 *
 * Stateful transport mode gives each MCP session its OWN `McpServer` +
 * transport pair (see `session-manager.ts`), so this factory runs once
 * per `initialize`. It:
 *
 *   1. constructs the server with the exact advertised capabilities
 *      (`tools.listChanged`, `resources.subscribe` + `resources.listChanged`),
 *      `serverInfo.name = 'skill-map'`, `version = implVersion`;
 *   2. registers the four read-only tools + the four resources;
 *   3. wires `resources/subscribe` + `resources/unsubscribe` handlers
 *      (the SDK routes the two verbs; tracking WHICH URIs this connection
 *      watches is the server's job) into a per-connection `Set<string>`.
 *
 * The returned `subscriptions` set is what the session manager consults
 * to decide whether a live `notifications/resources/updated` for a given
 * URI should reach THIS session (spec §Real-time updates: per-resource
 * updates only go to URIs the client actually subscribed to).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SubscribeRequestSchema, UnsubscribeRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import type { IPluginRuntime } from '../../core/runtime/plugin-runtime.js';
import type { ActivityStatsService } from '../activity-stats.js';
import type { WsBroadcaster } from '../broadcaster.js';
import type { IMcpReadContext, IMcpWriteContext } from './context.js';
import { registerMcpResources } from './resources.js';
import { registerMcpTools } from './tools.js';
import { registerMcpQueueTools } from './queue-tools.js';
import { registerMcpFindingsTools } from './findings-tools.js';

/** Composition-root inputs for the MCP server (per session). */
export interface IMcpServerDeps extends IMcpReadContext {
  /** `serverInfo.version`, the CLI `implVersion` (`src/version.ts`). */
  implVersion: string;
  /** Boot-scoped execution-stats accumulator (for `skillmap://activity`). */
  activityStats: ActivityStatsService;
  /** Boot-cached plugin runtime (submit / record build a fresh runtime from it). */
  pluginRuntime: IPluginRuntime;
  /** Presence hook for `claim_job` attempts (see `IMcpWriteContext`). */
  onClaimAttempt?: () => void;
  /** The one `/ws` broadcaster the queue tools broadcast job-lifecycle events on. */
  broadcaster: WsBroadcaster;
}

/** One session's server plus its live per-connection subscription set. */
export interface IMcpServerParts {
  server: McpServer;
  /** URIs this connection is subscribed to (`resources/subscribe`). */
  subscriptions: Set<string>;
}

export function createMcpServer(deps: IMcpServerDeps): IMcpServerParts {
  const server = new McpServer(
    { name: 'skill-map', version: deps.implVersion },
    {
      // Exactly the capabilities `spec/mcp-server.md` §Capabilities
      // advertises. `registerTool` / `registerResource` also lazily
      // register `{ listChanged: true }`; `registerCapabilities` merges,
      // so `subscribe: true` survives.
      capabilities: {
        tools: { listChanged: true },
        resources: { subscribe: true, listChanged: true },
      },
    },
  );

  const ctx: IMcpReadContext = { dbPath: deps.dbPath, cwd: deps.cwd };
  registerMcpTools(server, ctx);
  registerMcpResources(server, ctx, deps.activityStats);

  // The queue + findings-lifecycle tools ride the SAME endpoint as the
  // read-only map tools: one opt-in (`mcp.server.enabled`) turns the whole
  // surface on (user decision 2026-07-23, unify the two toggles). See
  // spec/mcp-server.md §Queue / §Findings lifecycle tools.
  const writeCtx: IMcpWriteContext = {
    dbPath: deps.dbPath,
    cwd: deps.cwd,
    pluginRuntime: deps.pluginRuntime,
    broadcaster: deps.broadcaster,
    ...(deps.onClaimAttempt ? { onClaimAttempt: deps.onClaimAttempt } : {}),
  };
  registerMcpQueueTools(server, writeCtx);
  registerMcpFindingsTools(server, writeCtx);

  const subscriptions = new Set<string>();
  // The high-level `McpServer` registers list/read handlers but NOT
  // subscribe/unsubscribe, so wiring them here does not collide with the
  // SDK's own handlers. Both return an empty result per the MCP spec.
  server.server.setRequestHandler(SubscribeRequestSchema, (request) => {
    subscriptions.add(request.params.uri);
    return {};
  });
  server.server.setRequestHandler(UnsubscribeRequestSchema, (request) => {
    subscriptions.delete(request.params.uri);
    return {};
  });

  return { server, subscriptions };
}
