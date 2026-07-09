/**
 * Live-activity adapter for the `claude` Provider (see
 * `spec/provider-activity.md`). Maps ONE raw Claude Code hook payload
 * (the JSON the runtime pipes to a hook command's stdin, forwarded
 * verbatim by the activity bridge) into node-attributable signals.
 *
 * The signal surface was characterised against real runs (probe logs,
 * 2026-06-29/30), not desk research:
 *
 * - **Command / slash-invoked skill**: `UserPromptExpansion` with
 *   `expansion_type: 'slash_command'` carries `command_name`. Claude
 *   shares the `/` namespace between commands and skills, so ONE event
 *   yields BOTH a `command` and a `skill` signal; the resolver drops
 *   whichever has no scanned node. No tool event fires for these.
 * - **Model-invoked skill**: `PreToolUse` with `tool_name: 'Skill'`
 *   carries `tool_input.skill`. This is only the ~10ms skill LOAD;
 *   there is NO native end signal (the UI owns span decay).
 * - **Subagent**: the spawning `PreToolUse` (`tool_name: 'Agent'`)
 *   carries `tool_input.subagent_type`; the native `SubagentStart` /
 *   `SubagentStop` pair carries `agent_id` + `agent_type`. Both start
 *   forms are emitted (set semantics downstream make the overlap
 *   idempotent). The spawn Pre/PostToolUse pair also carries the
 *   `spawn` relation block (spawnId, parent/child, prompt on start,
 *   sync response on end); a spawn from the MAIN context emits the
 *   relation-only signal form (main is not a node to keep lit).
 *   `SubagentStop` events with an EMPTY `agent_type` are orphan noise
 *   (observed firing out of order with unrelated ids) and are
 *   disclaimed.
 * - **Markdown usage**: `PreToolUse` with `tool_name: 'Read'` carries
 *   `tool_input.file_path`; in-scope `.md` reads become PATH signals
 *   (see `mapMarkdownRead`, filter-first: everything else is
 *   early-disclaimed). Auto-loaded session context (`CLAUDE.md`) fires
 *   no tool event and stays invisible by design.
 * - Everything else (`Stop`, `SessionEnd`, plain tool calls, ...) is
 *   disclaimed: tools are not graph nodes, and session-level clears are
 *   owned by the UI's TTL decay in v1.
 *
 * Attribution: tool events fired INSIDE a subagent carry `agent_id` /
 * `agent_type`; main-context events carry neither. `owner` is therefore
 * `agent_id` when present, else the SESSIONIZED main key
 * (`main:<session_id>`), so two parallel sessions in the same project
 * never collide under one owner. Bare `'main'` is the fallback for
 * payloads carrying no `session_id`; either way the key stays opaque
 * to consumers.
 */

import type {
  IActivitySignal,
  IActivitySpawnExecution,
  IActivitySpawnRelation,
  IProviderActivityAdapter,
} from '../../../../kernel/extensions/index.js';
import {
  mapSubagentBoundary,
  nonEmptyString,
  relativizeMarkdownPath,
  sessionizedOwner,
  toolInputOf,
} from '../../../../kernel/util/activity-adapter.js';
import { mcpNodePath, parseMcpToolName } from '../../../../kernel/util/mcp.js';

export const claudeActivity: IProviderActivityAdapter = {
  install: {
    kind: 'json-hooks',
    configPath: '.claude/settings.json',
    // Only the events mapEvent consumes: every wired event spawns one
    // bridge process, so the list stays tight. Tool events are narrowed
    // to the attributable tools (Skill invocations, Read for markdown
    // usage, Agent spawns for parent custody); plain Bash/Grep/... calls
    // never spawn the bridge at all. Survivors are further filtered
    // inside mapEvent (in-scope `.md` reads, agent-context spawns).
    events: [
      { event: 'UserPromptExpansion', matcher: '*' },
      { event: 'PreToolUse', matcher: '^(Skill|Agent|Read|mcp__.+)$' },
      { event: 'PostToolUse', matcher: '^Agent$' },
      { event: 'SubagentStart', matcher: '*' },
      { event: 'SubagentStop', matcher: '*' },
    ],
  },

  mapEvent(raw: unknown): IActivitySignal[] | null {
    if (raw === null || typeof raw !== 'object') return null;
    const event = raw as Record<string, unknown>;
    switch (event['hook_event_name']) {
      case 'UserPromptExpansion':
        return mapSlashExpansion(event);
      case 'PreToolUse':
        return mapPreToolUse(event);
      case 'PostToolUse':
        return mapPostToolUse(event);
      case 'SubagentStart':
        return mapSubagentBoundary(event, 'start');
      case 'SubagentStop':
        return mapSubagentBoundary(event, 'end');
      default:
        return null;
    }
  },
};

/**
 * `/name` typed by the operator. The `/` namespace is shared between
 * commands and skills, so emit both kinds and let node resolution pick
 * the one that exists.
 */
function mapSlashExpansion(event: Record<string, unknown>): IActivitySignal[] | null {
  if (event['expansion_type'] !== 'slash_command') return null;
  const name = nonEmptyString(event['command_name']);
  if (!name) return null;
  const owner = sessionizedOwner(event);
  return [
    { kind: 'command', name, phase: 'start', owner },
    { kind: 'skill', name, phase: 'start', owner },
  ];
}

function mapPreToolUse(event: Record<string, unknown>): IActivitySignal[] | null {
  const input = toolInputOf(event);
  if (event['tool_name'] === 'Skill') {
    const name = nonEmptyString(input['skill']);
    if (!name) return null;
    return [{ kind: 'skill', name, phase: 'start', owner: sessionizedOwner(event) }];
  }
  if (event['tool_name'] === 'Read') {
    return mapMarkdownRead(event, input);
  }
  if (event['tool_name'] === 'Agent') {
    return mapSpawnCustodyStart(event);
  }
  return mapMcpInvocation(event);
}

/**
 * Model-invoked MCP tool. Claude names an MCP tool `mcp__<server>__<tool>`
 * (the same identifier `core/mcp-tools` parses from `tools:` frontmatter), so a
 * `PreToolUse` for one lights the very `mcp://<server>` node the static map
 * already drew, via a PATH signal. Deterministic: the runtime reports the exact
 * tool name, no inference. Non-MCP tools fall through to null.
 */
function mapMcpInvocation(event: Record<string, unknown>): IActivitySignal[] | null {
  const toolName = nonEmptyString(event['tool_name']);
  if (!toolName) return null;
  const mcp = parseMcpToolName(toolName);
  if (!mcp) return null;
  return [
    { path: mcpNodePath(mcp.server), phase: 'start', owner: sessionizedOwner(event), detail: mcp.tool },
  ];
}

/**
 * Parent custody, spawn side. Claude PAUSES an agent that spawned a
 * child and fires a non-terminal `SubagentStop` for it (resume fires a
 * fresh `SubagentStart`); nothing marks the last stop as terminal. So
 * instead of classifying stops, the spawn keeps the PARENT lit through
 * custody: a sticky KEEP-ALIVE claim on the parent's own node (the
 * event's `agent_type` IS the parent) owned by the synthetic
 * `spawn:<tool_use_id>` key. `keepAlive` excludes the claim from
 * execution counting: custody is not an execution of the parent.
 * `mapSpawnCustodyHandoff` (PostToolUse) swaps it for a claim the
 * child's terminal end releases.
 *
 * Either way the signal carries the `spawn` relation block (child name
 * + the prompt handed to it). Spawns from the MAIN context have no
 * `agent_type` (main is not a node to keep lit) and emit the
 * RELATION-ONLY form instead of disclaiming: the relation still
 * matters even without a parent node.
 */
function mapSpawnCustodyStart(event: Record<string, unknown>): IActivitySignal[] | null {
  const toolUseId = nonEmptyString(event['tool_use_id']);
  if (!toolUseId) return null;
  const owner = sessionizedOwner(event);
  const spawn = buildSpawnRelation(event, {
    spawnId: toolUseId,
    phase: 'start',
    parentOwner: owner,
  });
  const parentName = nonEmptyString(event['agent_type']);
  if (!parentName) {
    return [{ phase: 'start', owner, spawn }];
  }
  return [
    {
      kind: 'agent',
      name: parentName,
      phase: 'start',
      owner: `spawn:${toolUseId}`,
      sticky: true,
      keepAlive: true,
      spawn,
    },
  ];
}

/** Only the spawn's PostToolUse is consumed (custody handoff); all else disclaims. */
function mapPostToolUse(event: Record<string, unknown>): IActivitySignal[] | null {
  return event['tool_name'] === 'Agent' ? mapSpawnCustodyHandoff(event) : null;
}

/**
 * Parent custody, handoff side (`PostToolUse` of the spawn). Releases
 * the synthetic spawn claim and hands custody to the CHILD's id, but
 * ONLY while the child is still running (`tool_response.status ===
 * 'async_launched'`): the child's terminal owner-scoped end then takes
 * the parent down with it, bottom-up.
 *
 * Any other status means the child already FINISHED when this event
 * fires (observed live 2026-07-04: the spawn's PostToolUse arrived
 * with `status: 'completed'` ~66ms AFTER the child's terminal
 * `SubagentStop`), so a child-owned claim created here would be an
 * orphan nothing ever releases (the cascade already passed). In that
 * case releasing the spawn key IS the custody ending; the parent keeps
 * its own lifecycle claim until its own terminal stop.
 *
 * The release carries the `spawn` relation block: `handoff` (with
 * `childOwner`) while the child still runs, `end` otherwise, with the
 * SYNC completion's report as the child's `response` (a plain string
 * on old payloads, `content` text blocks on current ones, both
 * live-observed). Main-context spawns emit the relation-only form (no
 * custody to move).
 */
function mapSpawnCustodyHandoff(event: Record<string, unknown>): IActivitySignal[] | null {
  const toolUseId = nonEmptyString(event['tool_use_id']);
  if (!toolUseId) return null;
  const owner = sessionizedOwner(event);
  const childId = runningChildId(event['tool_response']);
  const spawn = buildSpawnRelation(event, {
    spawnId: toolUseId,
    phase: childId ? 'handoff' : 'end',
    parentOwner: owner,
  });
  if (childId) {
    spawn.childOwner = childId;
  } else {
    const response = completionResponse(event['tool_response']);
    if (response) spawn.response = response;
    const execution = executionSummary(event['tool_response']);
    if (execution) spawn.execution = execution;
  }
  const parentName = nonEmptyString(event['agent_type']);
  if (!parentName) {
    return [{ phase: 'end', owner, spawn }];
  }
  const signals: IActivitySignal[] = [
    {
      kind: 'agent',
      name: parentName,
      phase: 'end',
      owner: `spawn:${toolUseId}`,
      ownerScope: true,
      spawn,
    },
  ];
  if (childId) {
    signals.push({
      kind: 'agent',
      name: parentName,
      phase: 'start',
      owner: childId,
      sticky: true,
      keepAlive: true,
    });
  }
  return signals;
}

/** The spawned child's id, but ONLY while it is still running (async launch). */
function runningChildId(response: unknown): string | null {
  if (response === null || typeof response !== 'object') return null;
  const shaped = response as Record<string, unknown>;
  if (shaped['status'] !== 'async_launched') return null;
  return nonEmptyString(shaped['agentId']);
}

/**
 * Assemble the spawn-relation block both custody sides share: the raw
 * tool-call id (never the synthetic owner key), the child unit as the
 * runtime named it, and the parent->child prompt on `start` only (the
 * sync `response` is attached by the handoff side, it lives on the
 * completion event, not on `tool_input`).
 */
function buildSpawnRelation(
  event: Record<string, unknown>,
  init: Pick<IActivitySpawnRelation, 'spawnId' | 'phase' | 'parentOwner'>,
): IActivitySpawnRelation {
  const relation: IActivitySpawnRelation = { ...init, childKind: 'agent' };
  const input = toolInputOf(event);
  const childName = nonEmptyString(input['subagent_type']);
  if (childName) relation.childName = childName;
  if (init.phase === 'start') {
    const prompt = nonEmptyString(input['prompt']);
    if (prompt) relation.prompt = prompt;
  }
  return relation;
}

/**
 * Markdown usage: the runtime read a file. `Read` is HIGH-frequency
 * (every source file the assistant opens), so the shared filter-first
 * relativizer discards everything that can never light a node (non-`.md`
 * reads, no usable `cwd`, files outside it) before any node-set work
 * happens downstream. Survivors become a PATH signal (scope-relative,
 * forward-slash): the resolver matches `node.path` directly, across
 * kinds, so reading `notes/todo.md` lights the markdown node and reading
 * a skill's `SKILL.md` lights that skill.
 */
function mapMarkdownRead(
  event: Record<string, unknown>,
  input: Record<string, unknown>,
): IActivitySignal[] | null {
  const relative = relativizeMarkdownPath(input['file_path'], [event['cwd']]);
  if (relative === null) return null;
  return [{ path: relative, phase: 'start', owner: sessionizedOwner(event) }];
}

/**
 * Extract a sync completion's report from `tool_response`: a plain
 * string on older payloads, `{ content: [{ type: 'text', text }] }`
 * text blocks on current ones (both shapes live-observed). Non-text
 * blocks are skipped; an empty result disclaims.
 */
/**
 * Aggregate execution summary of a completed sync spawn, from the
 * live-verified completion fields (`totalDurationMs`, `totalTokens`,
 * `totalToolUseCount`). Defensive: non-finite values are skipped, an
 * empty summary disclaims. The vendor `toolStats` / `usage` breakdowns
 * stay uncaptured until their inner shapes are pinned (spec note).
 */
function executionSummary(response: unknown): IActivitySpawnExecution | null {
  if (response === null || typeof response !== 'object') return null;
  const shaped = response as Record<string, unknown>;
  const summary: IActivitySpawnExecution = {};
  const durationMs = finiteNumber(shaped['totalDurationMs']);
  if (durationMs !== null) summary.durationMs = durationMs;
  const tokens = finiteNumber(shaped['totalTokens']);
  if (tokens !== null) summary.tokens = tokens;
  const toolUses = finiteNumber(shaped['totalToolUseCount']);
  if (toolUses !== null) summary.toolUses = toolUses;
  return Object.keys(summary).length > 0 ? summary : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function completionResponse(response: unknown): string | null {
  if (typeof response === 'string') return response.length > 0 ? response : null;
  if (response === null || typeof response !== 'object') return null;
  const content = (response as Record<string, unknown>)['content'];
  if (typeof content === 'string') return content.length > 0 ? content : null;
  return Array.isArray(content) ? joinTextBlocks(content) : null;
}

/** Join the `text` of every text block; non-text blocks are skipped. */
function joinTextBlocks(content: readonly unknown[]): string | null {
  const parts: string[] = [];
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue;
    const text = (block as Record<string, unknown>)['text'];
    if (typeof text === 'string' && text.length > 0) parts.push(text);
  }
  return parts.length > 0 ? parts.join('\n') : null;
}

