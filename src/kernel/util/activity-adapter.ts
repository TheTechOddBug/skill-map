/**
 * Shared mapping idioms for provider activity adapters
 * (`IProviderActivityAdapter.mapEvent`, see `spec/provider-activity.md`
 * §The `provider.activity` capability). Two families live here:
 *
 * - **Payload-agnostic primitives** every adapter needs regardless of
 *   vendor: `nonEmptyString` (defensive narrowing of arbitrary external
 *   payloads) and `relativizeMarkdownPath` (the filter-first `.md` +
 *   in-scope check behind every PATH signal).
 * - **The Claude-flavored hook convention**: `sessionizedOwner`,
 *   `toolInputOf`, `mapSubagentBoundary`, `mapMcpInvocation`. Claude Code's hook payload
 *   shape (`hook_event_name`, `session_id`, `agent_id` / `agent_type`,
 *   `tool_input`, `last_assistant_message`) is the de-facto convention
 *   other vendors copy (Codex documents its hooks as the same shape).
 *   Adapters for runtimes of that family import these instead of
 *   re-deriving the semantics, so sibling adapters can never drift
 *   apart; runtimes with genuinely different payloads (opencode's
 *   plugin wrappers, Antigravity's structural events) keep their own
 *   mapping and reuse only the primitives.
 *
 * Everything here is pure and total over arbitrary input, matching the
 * `mapEvent` contract the callers implement.
 */

import type { IActivitySignal } from '../extensions/index.js';
import { mcpNodePath, parseMcpToolName } from './mcp.js';

/** Fallback owner key for payloads that carry no context id at all. */
export const MAIN_OWNER = 'main';

/** Narrow an arbitrary payload field to a non-empty string, else `null`. */
export function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Owner grouping key of a Claude-flavored event: `agent_id` when the
 * event fired inside a subagent, else the SESSIONIZED main key
 * (`main:<session_id>`; bare `main` for payloads with no session id),
 * so two parallel sessions in the same project never collide under one
 * owner. Opaque downstream, nothing parses it.
 */
export function sessionizedOwner(event: Record<string, unknown>): string {
  const agentId = nonEmptyString(event['agent_id']);
  if (agentId) return agentId;
  const sessionId = nonEmptyString(event['session_id']);
  return sessionId ? `${MAIN_OWNER}:${sessionId}` : MAIN_OWNER;
}

/** The event's `tool_input` object, `{}` when absent or non-object. */
export function toolInputOf(event: Record<string, unknown>): Record<string, unknown> {
  const toolInput = event['tool_input'];
  return toolInput !== null && typeof toolInput === 'object'
    ? (toolInput as Record<string, unknown>)
    : {};
}

/**
 * Native subagent boundary of a Claude-flavored runtime
 * (`SubagentStart` / `SubagentStop`). The `agent_type` names the agent
 * node; the `agent_id` is the owner grouping key (each spawned instance
 * has its own). Empty `agent_type` = orphan noise (Claude emits such
 * stops out of order with unrelated ids), disclaimed defensively for
 * every caller. Starts are sticky lifecycle claims; the end is
 * OWNER-SCOPED, so a stopping subagent takes down every claim it holds
 * (the skills it invoked, the markdowns it read), not just its own
 * node, and the chain goes dark natively instead of waiting out the
 * TTL. The stop carries the agent's final message
 * (`last_assistant_message`, live-verified 2026-07-05), the response
 * source for the retained conversation; pause stops carry the message
 * so far and downstream overwrite makes the terminal one win.
 */
export function mapSubagentBoundary(
  event: Record<string, unknown>,
  phase: 'start' | 'end',
): IActivitySignal[] | null {
  const name = nonEmptyString(event['agent_type']);
  if (!name) return null;
  const signal: IActivitySignal = { kind: 'agent', name, phase };
  const id = nonEmptyString(event['agent_id']);
  if (id) signal.owner = id;
  if (phase === 'start') signal.sticky = true;
  if (phase === 'end' && id) {
    signal.ownerScope = true;
    const report = nonEmptyString(event['last_assistant_message']);
    if (report) signal.report = report;
  }
  return [signal];
}

/**
 * Model-invoked MCP tool of a Claude-flavored runtime. Both Claude and
 * Codex report the invoked tool to their `PreToolUse` hook as
 * `mcp__<server>__<tool>` (Codex forces the `mcp__` prefix on the hook
 * name, `codex-rs/.../tools/handlers/mcp.rs`), the SAME identifier
 * `core/mcp-tools` parses from `tools:` frontmatter and `mcpConfig`
 * materialises config-side, so a live call lights the very `mcp://<server>`
 * node the static map already drew, via a PATH signal. Deterministic: the
 * runtime reports the exact tool name, no inference. The tool half rides
 * `detail` so the UI can paint the invoked tool as a transient label. A
 * non-MCP `tool_name` (or an absent one) falls through to `null`, so the
 * caller can chain it after its own tool dispatch.
 */
export function mapMcpInvocation(event: Record<string, unknown>): IActivitySignal[] | null {
  const toolName = nonEmptyString(event['tool_name']);
  if (!toolName) return null;
  const mcp = parseMcpToolName(toolName);
  if (!mcp) return null;
  return [
    { path: mcpNodePath(mcp.server), phase: 'start', owner: sessionizedOwner(event), detail: mcp.tool },
  ];
}

/**
 * The scope-relative form of an absolute file path IF it is a markdown
 * file inside one of `roots`, else `null`. This is the FILTER-FIRST
 * core of every markdown-usage PATH signal: file-read tool events are
 * HIGH-frequency (every source file the runtime opens), so non-`.md`
 * paths and paths outside every root are discarded before any node-set
 * work happens downstream. `roots` is taken as `unknown` because it
 * comes straight off the raw payload (Antigravity's `workspacePaths`
 * array, a single `cwd` / `directory` wrapped by the caller); non-array
 * roots and non-string entries are skipped defensively. The first
 * containing root wins; the result keeps the payload's own separators
 * (providers report forward-slash paths, matching scanned `node.path`).
 */
export function relativizeMarkdownPath(absolutePath: unknown, roots: unknown): string | null {
  const filePath = nonEmptyString(absolutePath);
  if (!filePath || !filePath.toLowerCase().endsWith('.md')) return null;
  if (!Array.isArray(roots)) return null;
  for (const root of roots) {
    const relative = relativeToRoot(filePath, root);
    if (relative !== null) return relative;
  }
  return null;
}

/** `filePath` relative to `root` when non-trivially inside it, else `null`. */
function relativeToRoot(filePath: string, root: unknown): string | null {
  if (typeof root !== 'string' || root.length === 0) return null;
  const prefix = root.endsWith('/') ? root : `${root}/`;
  return filePath.startsWith(prefix) && filePath.length > prefix.length
    ? filePath.slice(prefix.length)
    : null;
}
