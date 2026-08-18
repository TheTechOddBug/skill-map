/**
 * Live-activity adapter for the `antigravity` Provider (see
 * `spec/provider-activity.md`). Maps ONE raw Antigravity (`agy`) hook
 * payload (piped to the hook command's stdin, forwarded verbatim by the
 * activity bridge) into node-attributable signals.
 *
 * Characterised against real runs (probe log, 2026-07-04, the antigravity
 * activity fixture now consolidated into `fixtures/antigravity/`;
 * write / shell surface re-probed 2026-08-18 against agy 1.1.14)
 * cross-checked with the official
 * hooks surface (antigravity.google/docs/hooks; events PreToolUse /
 * PostToolUse / PreInvocation / PostInvocation / Stop):
 *
 * - **Payloads carry NO `hook_event_name`** (unlike Claude / Codex).
 *   Events are distinguished STRUCTURALLY: a `toolCall` object means a
 *   tool event, `invocationNum` an invocation pulse, `terminationReason`
 *   the Stop. The descriptor's matchers scope which tool names reach
 *   the bridge; the shape guard keeps hand-wired extras harmless.
 * - **`write_to_file` / `replace_file_content`** (both
 *   `toolCall.args.TargetFile`, ABSOLUTE; live-verified 2026-08-18,
 *   the July tool-catalog guesses `create_file` / `edit_file` never
 *   fire): in-scope `.md` writes become PATH signals with
 *   `access: 'write'` (capture-level rung 3), the literal tool name as
 *   `detail` so creations label apart from edits.
 * - **`run_command`** (opt-in, spec Capture level rung 5;
 *   `toolCall.args.CommandLine` + explicit `.Cwd`): `.md` tokens
 *   extracted with the shared shell grammar, absolutized against the
 *   command's own Cwd, contained against `workspacePaths[*]`, emitted
 *   as `access: 'shell'` sightings. Rendered only under the shell key
 *   (`sm activity install antigravity --shell`).
 * - **Trust gate (agy 1.1.x)**: workspace-local hooks load only for a
 *   TRUSTED folder (`trustedWorkspaces` in the CLI settings); a fresh
 *   install fires nothing until the folder is trusted, the
 *   codex-hook-trust analogue. The print-mode `/hooks` answer shows
 *   what loaded.
 * - **`view_file`** (`toolCall.args.AbsolutePath`, absolute): in-scope
 *   `.md` views become PATH signals, which is how the on-disk graph
 *   lights on this provider. Skills' `references/*.md` reads light those
 *   resources, a workflow FOLLOWED in prose lights its
 *   `.agent/workflows/*.md` node (the runtime `view_file`s the workflow
 *   file first, live-verified), and plain markdown reads light markdown
 *   nodes.
 * - **`call_mcp_tool`** (`toolCall.args.ServerName` / `.ToolName`): the
 *   generic wrapper Antigravity funnels every MCP invocation through
 *   (live-verified 2026-07-11). A PATH signal on the `mcp://<ServerName>`
 *   node lights it the moment the tool fires, the ONLY way an Antigravity
 *   `mcp://` node lights (no project-local MCP config to discover
 *   config-side). See `mapMcpToolCall`.
 * - **Skill invocation itself is invisible**: `/skill` injects the
 *   SKILL.md into context with no tool event (live-verified: only
 *   invocation pulses + a `NO_TOOL_CALL` Stop). Nothing to map.
 * - **No agent signals**: Antigravity subagents are runtime-only Prompt
 *   specs with NO on-disk definition (the provider declares no `agent`
 *   kind), so there is no node to light. `conversationId` (present in
 *   EVERY payload, one per (sub)conversation) is still forwarded as the
 *   `owner` grouping key, so per-conversation reads heartbeat together.
 * - **In-scope filter** relativizes against `workspacePaths[*]` (the
 *   payload has no `cwd`); a view outside every workspace root is
 *   disclaimed.
 *
 * Install: `.agents/hooks.json` uses the NAMED-GROUP document shape,
 * declared via `install.group` (skill-map owns the whole
 * `skill-map-activity` group; uninstall removes exactly it). Hook
 * neutrality on this runtime is exit 0 + empty stdout, which the bridge
 * invariants already guarantee.
 */

import type {
  IActivitySignal,
  IProviderActivityAdapter,
} from '../../../../kernel/extensions/index.js';
import {
  MAIN_OWNER,
  nonEmptyString,
  relativizeMarkdownPath,
  shellCommandMarkdownPaths,
} from '../../../../kernel/util/activity-adapter.js';
import { mcpNodePath } from '../../../../kernel/util/mcp.js';

export const antigravityActivity: IProviderActivityAdapter = {
  install: {
    kind: 'json-hooks',
    configPath: '.agents/hooks.json',
    group: 'skill-map-activity',
    // agy spawns hook commands at the CONFIG's directory (.agents/),
    // not the workspace root (live-verified 2026-07-04), so the bridge
    // command needs the ../ hop to resolve.
    commandCwd: 'config-dir',
    // Base events: file views, the two write tools and MCP calls
    // (matcher-scoped so the bridge never spawns for find_by_name /
    // subagent traffic), plus the conversation Stop (owner release:
    // the whole chain goes dark the moment the agent idles instead of
    // waiting out the decay). Stop takes the FLAT entry shape (agy's
    // lifecycle events reject the matcher group). The shell rung is a
    // separate opt-in event on `run_command` (spec Capture level rung
    // 5), rendered only while `activity.shellCapture` is on.
    events: [
      { event: 'PreToolUse', matcher: '^(view_file|call_mcp_tool|write_to_file|replace_file_content)$' },
      { event: 'PreToolUse', matcher: '^run_command$', optIn: 'shell' },
      { event: 'Stop', entryShape: 'flat' },
    ],
  },

  mapEvent(raw: unknown): IActivitySignal[] | null {
    if (raw === null || typeof raw !== 'object') return null;
    const event = raw as Record<string, unknown>;
    const toolCall = readToolCall(event);
    if (toolCall !== null) {
      const mapper = TOOL_MAPPERS[toolCall.name];
      return mapper ? mapper(event, toolCall.args) : null;
    }
    return mapConversationStop(event);
  },
};

interface IToolCall {
  name: string;
  args: Record<string, unknown>;
}

/**
 * Tool-name -> mapper dispatch (replaced the if-chain when the write
 * tools and the shell rung joined, 2026-08-18). The write pair shares
 * `mapFileWrite` with the literal tool name threaded as `detail`.
 */
const TOOL_MAPPERS: Record<
  string,
  (event: Record<string, unknown>, args: Record<string, unknown>) => IActivitySignal[] | null
> = {
  view_file: mapFileView,
  call_mcp_tool: mapMcpToolCall,
  write_to_file: (event, args) => mapFileWrite(event, args, 'write_to_file'),
  replace_file_content: (event, args) => mapFileWrite(event, args, 'replace_file_content'),
  run_command: mapRunCommand,
};

/** Structural event detection: a tool event carries a `toolCall` object. */
function readToolCall(event: Record<string, unknown>): IToolCall | null {
  const toolCall = event['toolCall'];
  if (toolCall === null || typeof toolCall !== 'object') return null;
  const shaped = toolCall as Record<string, unknown>;
  const name = nonEmptyString(shaped['name']);
  if (!name) return null;
  const args = shaped['args'];
  return {
    name,
    args: args !== null && typeof args === 'object' ? (args as Record<string, unknown>) : {},
  };
}

/**
 * `view_file` → PATH signal, filter-first (mirroring the claude `Read`
 * mapping): non-`.md` views and views outside every workspace root are
 * early-disclaimed, so high-frequency source-file traffic never reaches
 * the node set. Survivors are relativized against the FIRST workspace
 * root that contains them (forward-slash, scope-relative), matching the
 * scanned `node.path` space. Markdown WRITES stay unmapped: the runtime
 * ships write tools (`write_to_file`, `create_file`, `edit_file`) but
 * their hook arg shapes are not live-verified, so the matcher waits for
 * a probe run (spec/provider-activity.md, antigravity row).
 */
function mapFileView(
  event: Record<string, unknown>,
  args: Record<string, unknown>,
): IActivitySignal[] | null {
  const relative = relativizeMarkdownPath(args['AbsolutePath'], event['workspacePaths']);
  if (relative === null) return null;
  // `detail` = literal invoking tool name (spec/provider-activity.md §detail).
  return [{ path: relative, phase: 'start', owner: ownerOf(event), detail: 'view_file' }];
}

/**
 * `write_to_file` (new files) / `replace_file_content` (edits) → PATH
 * signal with the write access class (capture-level rung 3). Both
 * carry an ABSOLUTE `args.TargetFile` (live-verified 2026-08-18, agy
 * 1.1.14; the July tool-catalog guesses `create_file` / `edit_file`
 * never fire), so the same filter-first relativization as `view_file`
 * applies; the literal tool name rides as `detail` so creations label
 * apart from edits. A brand-new file resolves to no scanned node and
 * drops until the watcher scans it, the claude `Write` precedent.
 */
function mapFileWrite(
  event: Record<string, unknown>,
  args: Record<string, unknown>,
  toolName: string,
): IActivitySignal[] | null {
  const relative = relativizeMarkdownPath(args['TargetFile'], event['workspacePaths']);
  if (relative === null) return null;
  return [
    {
      path: relative,
      phase: 'start',
      owner: ownerOf(event),
      detail: toolName,
      access: 'write' as const,
    },
  ];
}

/**
 * `run_command` → shell sightings (opt-in, spec Capture level rung 5):
 * `.md` tokens extracted from `args.CommandLine` with the shared shell
 * grammar, absolutized against the command's own `args.Cwd` (this
 * runtime reports it explicitly, more precise than the session cwd
 * claude / codex offer) and contained against `workspacePaths[*]`.
 * The command text never leaves the parser; each survivor rides
 * `access: 'shell'` with `detail: 'run_command'`.
 */
function mapRunCommand(
  event: Record<string, unknown>,
  args: Record<string, unknown>,
): IActivitySignal[] | null {
  const command = nonEmptyString(args['CommandLine']);
  const cwd = nonEmptyString(args['Cwd']);
  if (!command || !cwd) return null;
  const paths = shellCommandMarkdownPaths(command, cwd, event['workspacePaths']);
  if (paths.length === 0) return null;
  const owner = ownerOf(event);
  return paths.map((path) => ({
    path,
    phase: 'start' as const,
    owner,
    detail: 'run_command',
    access: 'shell' as const,
  }));
}

/**
 * `call_mcp_tool` → PATH signal on the `mcp://<server>` node. Antigravity
 * funnels EVERY MCP invocation through one generic wrapper tool
 * (`toolCall.name === 'call_mcp_tool'`), carrying the real server + tool in
 * `toolCall.args.ServerName` / `.ToolName` (live-verified 2026-07-11: a
 * `notion-create-pages` call arrives as
 * `{name:'call_mcp_tool', args:{ServerName:'notion', ToolName:'notion-create-pages', Arguments:{…}}}`).
 * So, unlike Claude / Codex (which embed the server in a `mcp__<server>__<tool>`
 * tool name and share `mapMcpInvocation`), the server is read from `args`, not
 * parsed from the name. The lit node is the SAME `mcp://<server>` that
 * `core/mcp-tools` draws from a skill's `tools:` frontmatter, so a live call
 * lights the static node deterministically. No config-side counterpart exists
 * (Antigravity's MCP config is home-global, off-limits to the project-local
 * scanner), so this live path is the only way an Antigravity `mcp://` node
 * ever lights. The tool name rides as `detail`.
 */
function mapMcpToolCall(
  event: Record<string, unknown>,
  args: Record<string, unknown>,
): IActivitySignal[] | null {
  const server = nonEmptyString(args['ServerName']);
  if (!server) return null;
  const signal: IActivitySignal = { path: mcpNodePath(server), phase: 'start', owner: ownerOf(event) };
  const tool = nonEmptyString(args['ToolName']);
  if (tool) signal.detail = tool;
  return [signal];
}

/**
 * Conversation Stop → node-less OWNER RELEASE, but ONLY when the
 * conversation is FULLY idle. Antigravity fires Stop every time a
 * conversation naps (live-verified 2026-07-05: an orchestrating main
 * stops with `fullyIdle: false` while its subagents still run, then
 * wakes on their `send_message`); releasing on those mid-run naps
 * darkened the whole chain prematurely. `fullyIdle: false` therefore
 * disclaims; the release fires on `fullyIdle: true` (and, defensively,
 * when the field is absent on older runtimes, preserving the previous
 * behavior there). Detected structurally (`terminationReason` only
 * appears on the Stop payload); requires a `conversationId`.
 */
function mapConversationStop(event: Record<string, unknown>): IActivitySignal[] | null {
  if (typeof event['terminationReason'] !== 'string') return null;
  if (event['fullyIdle'] === false) return null;
  const owner = nonEmptyString(event['conversationId']);
  if (!owner) return null;
  return [{ phase: 'end', owner, ownerScope: true }];
}

/** `conversationId` (one per (sub)conversation) is the owner grouping key. */
function ownerOf(event: Record<string, unknown>): string {
  return nonEmptyString(event['conversationId']) ?? MAIN_OWNER;
}
