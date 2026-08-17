/**
 * Live-activity adapter for the `opencode` Provider (see
 * `spec/provider-activity.md`). Maps ONE wrapped plugin payload (the
 * `{ hook, directory, ... }` envelope the in-process activity plugin
 * forwards, see `core/activity/plugin-template.ts`) into
 * node-attributable signals.
 *
 * Characterised against real runs (probe log 2026-07-04, opencode
 * v1.17.11, the opencode activity fixture now consolidated into
 * `fixtures/opencode/`) cross-checked with the
 * official plugin docs (https://opencode.ai/docs/plugins/). OpenCode is
 * the RICHEST signal surface of the four adapters: everything arrives
 * NAMED, plus a native end.
 *
 * - **Skill**: `tool.execute.before` with `input.tool === 'skill'`,
 *   `output.args.name` names the skill; fires even for prose-invoked
 *   skills (live-verified). Resolves via the provider's skill
 *   identifiers across its three skill homes.
 * - **Command**: the dedicated `command.execute.before` hook,
 *   `input.command` names it (also prose-invoked); resolves to
 *   `.opencode/commands/<name>.md`.
 * - **Agent**: `chat.message` carries the NAMED `input.agent` plus the
 *   message's own `input.sessionID`; a subagent (spawned via the `task`
 *   tool) runs under its OWN sessionID. Named agents resolve to
 *   `.opencode/agent/<name>.md`; built-ins without a file (`build`,
 *   `plan`, ...) drop at the resolver. Fires per assistant message, so
 *   it doubles as the owner heartbeat.
 * - **Markdown usage**: `tool.execute.before` with `input.tool` `read`,
 *   `write` or `edit` (all carry `output.args.filePath` absolute, per
 *   the official tool schemas); filter-first (`.md` only, inside the
 *   plugin context's `directory`), relativized to a PATH signal with the
 *   tool name as `detail` so reads label apart from writes.
 *   `apply_patch` carries only `patchText` (no path arg) and stays
 *   unmapped.
 * - **MCP tool call**: `tool.execute.before` whose `input.tool` is a
 *   `<server>_<tool>` name (OpenCode's MCP naming, no explicit marker) →
 *   PATH signal on `mcp://<server>` (the prefix before the first `_`); the
 *   resolver drops the non-`mcp://` misses. See `mapMcpToolCall`.
 * - **Native end**: the plugin forwards the bus event `session.idle`
 *   (its ONLY forwarded bus event, filtered at the wiring level), which
 *   maps to the node-less OWNER RELEASE for that `sessionID`: the whole
 *   session's chain goes dark the moment it idles.
 * - **Spawn relations**: the `task` tool pair (live-verified
 *   2026-07-05). The before carries `input.callID` (the spawnId) plus
 *   `args.subagent_type` / `args.prompt`; the after arrives when the
 *   child CONSOLIDATED (the parent blocks, no naps) carrying
 *   `output.metadata.sessionId` (the child's own owner) and the child's
 *   full final report inside `output.output`'s `<task_result>` wrapper.
 *   The task event never names the PARENT agent (only its sessionID),
 *   so every spawn emits the RELATION-ONLY form and anchors on a
 *   session capsule client-side, one per spawning session. Per-message
 *   token usage exists on the bus (`message.updated`) but aggregating
 *   it would forward a high-frequency family; deferred.
 *
 * `owner` is the `sessionID` throughout (one per (sub)session).
 */

import type {
  IActivitySignal,
  IActivitySpawnRelation,
  IProviderActivityAdapter,
} from '../../../../kernel/extensions/index.js';
import {
  nonEmptyString,
  relativizeMarkdownPath,
} from '../../../../kernel/util/activity-adapter.js';
import { mcpNodePath } from '../../../../kernel/util/mcp.js';

/**
 * Hook-registration half of the generated in-process plugin
 * (`core/activity/plugin-template.ts` owns the shared envelope:
 * discovery, loopback + token checks, timeout, never-throw; this source
 * is spliced at its `{{HOOKS}}` slot). It registers exactly the hooks
 * `mapEvent` consumes, the in-process analog of the `json-hooks` events
 * list: `tool.execute.before` (skill / read / task tools),
 * `tool.execute.after` FILTERED to the `task` tool (the spawn
 * completion, carrying the child session id + final report),
 * `command.execute.before`, `chat.message` (named agent + sessionID),
 * `chat.params` REDUCED to `{ agent, sessionID }` (the early agent-name
 * source: it fires before each model call, so the owner index learns the
 * session's agent before the turn's first spawn; the user message it
 * also carries never leaves the process), and the `event` catch-all
 * FILTERED to `session.idle` (the native owner release). Filtering by tool / event TYPE is wiring, not
 * mapping: it is what keeps the firehose bus (catalog / registry noise,
 * every other tool's output) from ever leaving the host process.
 */
const PLUGIN_HOOKS_SOURCE = `    'tool.execute.before': async (input, output) => {
      await forward('tool.execute.before', { input, output });
    },
    'tool.execute.after': async (input, output) => {
      // Wiring-level filter: only the spawn tool's completion leaves
      // the process (it carries the child session id + final report);
      // every other tool's output stays private to the host.
      if (input && input.tool === 'task') {
        await forward('tool.execute.after', { input, output });
      }
    },
    'command.execute.before': async (input, output) => {
      await forward('command.execute.before', { input, output });
    },
    'chat.message': async (input) => {
      await forward('chat.message', { input });
    },
    'chat.params': async (input) => {
      // Wiring-level reduction: this hook fires BEFORE each model call and
      // its input carries the user's message; only the agent identity may
      // leave the process. It exists because 'chat.message' fires when the
      // assistant message COMPLETES, after a whole delegation already ran.
      await forward('chat.params', {
        input: input ? { agent: input.agent, sessionID: input.sessionID } : {},
      });
    },
    event: async ({ event }) => {
      // Wiring-level filter: only the native end signal leaves the
      // process; the rest of the bus (catalog noise) never does.
      if (event && event.type === 'session.idle') {
        await forward('event', { event });
      }
    },`;

export const opencodeActivity: IProviderActivityAdapter = {
  install: {
    // In-process plugin: the file IS both the wiring and the bridge
    // (spec/provider-activity.md §capability, plugin-file paragraph).
    // BOTH `.opencode/plugin/` and `.opencode/plugins/` auto-load
    // (live-verified); install targets the singular form.
    kind: 'plugin-file',
    configPath: '.opencode/plugin/skill-map-activity.js',
  },

  // The parent BLOCKS inside the `task` tool (live-verified: the child's
  // `session.idle` lands right before the parent's completion), so a
  // session that reports idle cannot have a child still running: its
  // owner-scoped end is TERMINAL, not a nap. This is what releases a
  // spawn whose completion never arrives, the shape a REFUSED task call
  // produces (OpenCode caps delegation at one hop and rejects a `task`
  // issued from inside a subagent: the before fires, the after never
  // does, live-verified 2026-07-25).
  spawnCustody: 'blocking',

  pluginHooksSource: PLUGIN_HOOKS_SOURCE,

  mapEvent(raw: unknown): IActivitySignal[] | null {
    if (raw === null || typeof raw !== 'object') return null;
    const wrapper = raw as Record<string, unknown>;
    const mapper = HOOK_MAPPERS[String(wrapper['hook'])];
    return mapper ? mapper(wrapper) : null;
  },
};

/**
 * Hook -> mapper dispatch (replaces the switch that outgrew the
 * complexity budget when `chat.params` joined). `chat.message` and
 * `chat.params` share a mapper on purpose, see `mapChatMessage`.
 */
const HOOK_MAPPERS: Record<
  string,
  (wrapper: Record<string, unknown>) => IActivitySignal[] | null
> = {
  'tool.execute.before': mapToolCall,
  'tool.execute.after': mapTaskCompletion,
  'command.execute.before': mapCommand,
  'chat.message': mapChatMessage,
  'chat.params': mapChatMessage,
  event: mapSessionIdle,
};

/** `input` half of a wrapped hook payload, defensively narrowed. */
function readRecord(wrapper: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = wrapper[key];
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function mapToolCall(wrapper: Record<string, unknown>): IActivitySignal[] | null {
  const input = readRecord(wrapper, 'input');
  const args = readRecord(readRecord(wrapper, 'output'), 'args');
  if (input['tool'] === 'skill') {
    const name = nonEmptyString(args['name']);
    if (!name) return null;
    // `detail` = literal invoking tool name (spec/provider-activity.md §detail).
    return [{ kind: 'skill', name, phase: 'start', owner: ownerOf(input), detail: 'skill' }];
  }
  if (input['tool'] === 'read' || input['tool'] === 'write' || input['tool'] === 'edit') {
    return mapMarkdownUsage(wrapper, input, args);
  }
  if (input['tool'] === 'task') {
    return mapTaskSpawn(input, args);
  }
  return mapMcpToolCall(input);
}

/**
 * MCP tool call → PATH signal on the `mcp://<server>` node. OpenCode exposes
 * every MCP server's tools under a `<server>_<tool>` name in `input.tool` (no
 * separate server field, live-verified 2026-07-11: a Notion call arrives as
 * `input.tool === 'notion_notion-create-pages'`), so the server is the prefix
 * before the FIRST `_`. Unlike Claude / Codex (`mcp__<server>__<tool>`, shared
 * `mapMcpInvocation`) and Antigravity (`call_mcp_tool` wrapper + `ServerName`
 * arg), OpenCode gives no explicit MCP marker, so this fires for ANY
 * underscore-bearing tool and leans on the resolver's node-match to drop the
 * misses: `notion_…` lights the scanned `mcp://notion` node, while a built-in
 * like `read_mcp_resource` resolves to a non-existent `mcp://read` and is
 * dropped. The lit node is the SAME one `core/mcp-tools` + `mcpConfig`
 * (opencode.json) draw. The tool suffix rides as `detail`.
 */
function mapMcpToolCall(input: Record<string, unknown>): IActivitySignal[] | null {
  const tool = nonEmptyString(input['tool']);
  if (!tool) return null;
  const sep = tool.indexOf('_');
  if (sep <= 0 || sep === tool.length - 1) return null;
  return [
    {
      path: mcpNodePath(tool.slice(0, sep)),
      phase: 'start',
      owner: ownerOf(input),
      detail: tool.slice(sep + 1),
    },
  ];
}

/**
 * `task` before -> spawn relation start. The task event carries only
 * the parent's sessionID (never its agent NAME), so the signal is the
 * RELATION-ONLY form: no parent node to claim, the frame anchors on a
 * session capsule client-side.
 */
function mapTaskSpawn(
  input: Record<string, unknown>,
  args: Record<string, unknown>,
): IActivitySignal[] | null {
  const spawnId = nonEmptyString(input['callID']);
  if (!spawnId) return null;
  const owner = ownerOf(input);
  const spawn: IActivitySpawnRelation = { spawnId, phase: 'start', parentOwner: owner };
  const childName = nonEmptyString(args['subagent_type']);
  if (childName) {
    spawn.childKind = 'agent';
    spawn.childName = childName;
  }
  const prompt = nonEmptyString(args['prompt']);
  if (prompt) spawn.prompt = prompt;
  return [{ phase: 'start', owner, spawn }];
}

/**
 * `task` after -> spawn relation end. Arrives when the child already
 * consolidated (the parent blocks inside the tool, live-verified: the
 * child's `session.idle` lands right before this), carrying the
 * child's own sessionID and its full final report.
 */
function mapTaskCompletion(wrapper: Record<string, unknown>): IActivitySignal[] | null {
  const input = readRecord(wrapper, 'input');
  if (input['tool'] !== 'task') return null;
  const spawnId = nonEmptyString(input['callID']);
  if (!spawnId) return null;
  const owner = ownerOf(input);
  const args = readRecord(input, 'args');
  const output = readRecord(wrapper, 'output');
  const spawn: IActivitySpawnRelation = { spawnId, phase: 'end', parentOwner: owner };
  const childName = nonEmptyString(args['subagent_type']);
  if (childName) {
    spawn.childKind = 'agent';
    spawn.childName = childName;
  }
  const childOwner = nonEmptyString(readRecord(output, 'metadata')['sessionId']);
  if (childOwner) spawn.childOwner = childOwner;
  const response = taskResultOf(output['output']);
  if (response) spawn.response = response;
  return [{ phase: 'start', owner, spawn }];
}

/**
 * The child's final report, unwrapped from the `<task_result>` envelope
 * (`<task id="..." state="..."><task_result>...</task_result></task>`,
 * live-observed). An unrecognised shape passes through verbatim rather
 * than losing content.
 */
function taskResultOf(output: unknown): string | null {
  const raw = nonEmptyString(output);
  if (!raw) return null;
  const match = raw.match(/<task_result>\n?([\s\S]*?)\n?<\/task_result>/);
  const text = (match ? match[1]! : raw).trim();
  return text.length > 0 ? text : null;
}

/**
 * Markdown usage, filter-first (mirroring the claude handling): the
 * `read` / `write` / `edit` tools all carry `args.filePath`; non-`.md`
 * paths and paths outside the plugin context's `directory` are
 * early-disclaimed; survivors become scope-relative PATH signals with
 * the tool name as `detail` so reads label apart from writes.
 */
function mapMarkdownUsage(
  wrapper: Record<string, unknown>,
  input: Record<string, unknown>,
  args: Record<string, unknown>,
): IActivitySignal[] | null {
  const relative = relativizeMarkdownPath(args['filePath'], [wrapper['directory']]);
  if (relative === null) return null;
  const tool = String(input['tool']);
  // `detail` = literal invoking tool name (spec/provider-activity.md §detail);
  // write / edit stamp the write access class (capture-level rung 3).
  return [
    {
      path: relative,
      phase: 'start',
      owner: ownerOf(input),
      detail: tool,
      ...(tool === 'write' || tool === 'edit' ? { access: 'write' as const } : {}),
    },
  ];
}

function mapCommand(wrapper: Record<string, unknown>): IActivitySignal[] | null {
  const input = readRecord(wrapper, 'input');
  const name = nonEmptyString(input['command']);
  if (!name) return null;
  return [{ kind: 'command', name, phase: 'start', owner: ownerOf(input) }];
}

/**
 * Named agent boundary: every assistant message names the agent driving
 * the session, so the FIRST one lights the agent node (sticky lifecycle
 * claim) and each subsequent one heartbeats the whole session. Built-in
 * agents without an on-disk file drop at the resolver.
 */
/**
 * Shared mapper for `chat.message` AND `chat.params` (identical relevant
 * input: named `agent` + `sessionID`). `chat.params` is the EARLY twin:
 * it fires before each model call, so the BFF's owner index learns
 * "this session runs that agent" BEFORE the turn's first `task` spawn,
 * which is what anchors a delegation arrow on the real agent node
 * instead of a session capsule; `chat.message` only fires with the
 * assistant message, after the whole delegation already ran. Built-in
 * runtime agents with no on-disk file (`build`, `plan`, `title`) drop
 * at the resolver as always.
 */
function mapChatMessage(wrapper: Record<string, unknown>): IActivitySignal[] | null {
  const input = readRecord(wrapper, 'input');
  const name = nonEmptyString(input['agent']);
  const owner = nonEmptyString(input['sessionID']);
  if (!name || !owner) return null;
  return [{ kind: 'agent', name, phase: 'start', owner, sticky: true }];
}

/**
 * `session.idle` → node-less OWNER RELEASE: everything this session lit
 * (its agent, skills, commands, reads) goes dark natively. The plugin
 * only forwards this one bus event, but the type is re-checked here so
 * a hand-edited plugin cannot smuggle other bus traffic into signals.
 */
function mapSessionIdle(wrapper: Record<string, unknown>): IActivitySignal[] | null {
  const event = readRecord(wrapper, 'event');
  if (event['type'] !== 'session.idle') return null;
  const owner = nonEmptyString(readRecord(event, 'properties')['sessionID']);
  if (!owner) return null;
  return [{ phase: 'end', owner, ownerScope: true }];
}

/** `sessionID` is the owner grouping key (one per (sub)session). */
function ownerOf(input: Record<string, unknown>): string {
  return nonEmptyString(input['sessionID']) ?? 'main';
}
