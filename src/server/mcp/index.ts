/**
 * Public surface of the read-only MCP server module (see
 * `spec/mcp-server.md`). The composition root (`server/index.ts`) uses
 * `createMcpIntegration`; `createApp` uses `registerMcpRoute`.
 */

export {
  createMcpIntegration,
  registerMcpRoute,
  type IMcpIntegration,
  type IMcpIntegrationDeps,
} from './integration.js';
export { McpSessionManager } from './session-manager.js';
export type { IMcpServerParts } from './mcp-server.js';
