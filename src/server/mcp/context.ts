/**
 * Shared read-context + resource URIs for the read-only MCP server
 * (see `spec/mcp-server.md`).
 *
 * The MCP tools and resources are pure reads over the persisted
 * `ScanResult`: they open the project DB per call via
 * `tryWithSqlite({ databasePath, autoBackup: false }, ...)` and read the
 * on-demand body from disk relative to `cwd`. No mutation, no new query
 * capability, they wrap the exact same kernel reads the REST routes use.
 *
 * Leaf module (no MCP-SDK imports) so `tools.ts` / `resources.ts` can
 * depend on it without a cycle back through the server factory.
 */

/** Everything a tool / resource read needs from the composition root. */
export interface IMcpReadContext {
  /**
   * Absolute project DB path (`IServerOptions.dbPath`). Opened per call
   * and closed via `tryWithSqlite`; a missing file degrades every read
   * to the empty shape (never a throw), mirroring the REST routes.
   */
  dbPath: string;
  /**
   * Project root (`runtimeContext.cwd`). Only consumed by the on-demand
   * body reader (`get_node` with `includeBody`), which refuses any path
   * escaping this root.
   */
  cwd: string;
}

/** Full persisted `ScanResult`, same payload as `GET /api/scan`. */
export const GRAPH_RESOURCE_URI = 'skillmap://graph';

/** Full issue list (`{ items, total }`), same rows as `GET /api/issues`. */
export const ISSUES_RESOURCE_URI = 'skillmap://issues';

/** Live execution-stats snapshot, the `GET /api/activity/summary` shape. */
export const ACTIVITY_RESOURCE_URI = 'skillmap://activity';

/**
 * Per-node detail-bundle template. RFC 6570 reserved expansion
 * (`{+path}`) is deliberate: node paths are relative POSIX paths that
 * contain `/`, and a plain `{path}` variable only matches a single
 * segment (`[^/,]+`). `{+path}` captures the full slashed path so
 * `skillmap://node/.claude/agents/foo.md` resolves to the intended node.
 */
export const NODE_RESOURCE_TEMPLATE = 'skillmap://node/{+path}';
