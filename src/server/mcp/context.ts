/**
 * Shared read-context + resource URIs for the MCP server
 * (see `spec/mcp-server.md`).
 *
 * The read (map) tools and resources are pure reads over the persisted
 * `ScanResult`: they open the project DB per call via
 * `tryWithSqlite({ databasePath, autoBackup: false }, ...)` and read the
 * on-demand body from disk relative to `cwd`. No mutation, no new query
 * capability, they wrap the exact same kernel reads the REST routes use.
 *
 * The write (queue + findings) tools carry the extra deps they need
 * (`IMcpWriteContext`); they open the DB with the write posture (no
 * read-side version check) and wrap the same shared engines the CLI /
 * BFF use.
 *
 * Leaf module (no MCP-SDK imports) so `tools.ts` / `queue-tools.ts` /
 * `findings-tools.ts` can depend on it without a cycle back through the
 * server factory.
 */

import type { WsBroadcaster } from '../broadcaster.js';
import type { IPluginRuntime } from '../../core/runtime/plugin-runtime.js';

/** Everything a read (map) tool / resource needs from the composition root. */
export interface IMcpReadContext {
  /**
   * Absolute project DB path (`IServerOptions.dbPath`). Opened per call
   * and closed via `tryWithSqlite`; a missing file degrades every read
   * to the empty shape (never a throw), mirroring the REST routes.
   */
  dbPath: string;
  /**
   * Project root (`runtimeContext.cwd`). Consumed by the on-demand body
   * reader (`get_node` with `includeBody`, refuses any path escaping
   * this root), by the write tools (per-call fresh resolver + jobs
   * config from `loadConfig({ cwd })`), and by the sidecar consent gate.
   */
  cwd: string;
}

/**
 * Everything the write (queue + findings-lifecycle) tools need on top of
 * the read context. Built at the composition root and threaded per
 * session, only when the server is on (`mcp.server.enabled`).
 */
export interface IMcpWriteContext extends IMcpReadContext {
  /**
   * The boot-cached plugin runtime. `submit_job` / `record_job` compose
   * a fresh action runtime from it against a per-call fresh enabled
   * resolver (mirrors `node-jobs.ts`), so a mid-session plugin toggle is
   * honoured without a serve restart.
   */
  pluginRuntime: IPluginRuntime;
  /**
   * The one `/ws` broadcaster. `record_job` broadcasts its job-lifecycle
   * events directly (it runs in-process, like a BFF route), so a live UI
   * / MCP subscriber sees the completion without a poll.
   */
  broadcaster: WsBroadcaster;
  /**
   * Presence hook: called on EVERY `claim_job` attempt (empty queue or
   * not), because an agent asking for work is attending regardless of
   * whether work exists. Wired at the composition root to
   * `AgentPresenceTracker.noteAttempt`; optional so tests and any
   * presence-less embedding can omit it.
   */
  onClaimAttempt?: () => void;
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
