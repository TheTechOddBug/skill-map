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
 *   idempotent). `SubagentStop` events with an EMPTY `agent_type` are
 *   orphan noise (observed firing out of order with unrelated ids) and
 *   are disclaimed.
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
 * `agent_id` when present, else `'main'`.
 */

import type {
  IActivitySignal,
  IProviderActivityAdapter,
} from '../../../../kernel/extensions/index.js';

const MAIN_OWNER = 'main';

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
      { event: 'PreToolUse', matcher: '^(Skill|Agent|Read)$' },
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
  const owner = ownerOf(event);
  return [
    { kind: 'command', name, phase: 'start', owner },
    { kind: 'skill', name, phase: 'start', owner },
  ];
}

function mapPreToolUse(event: Record<string, unknown>): IActivitySignal[] | null {
  const toolInput = event['tool_input'];
  const input =
    toolInput !== null && typeof toolInput === 'object'
      ? (toolInput as Record<string, unknown>)
      : {};
  if (event['tool_name'] === 'Skill') {
    const name = nonEmptyString(input['skill']);
    if (!name) return null;
    return [{ kind: 'skill', name, phase: 'start', owner: ownerOf(event) }];
  }
  if (event['tool_name'] === 'Read') {
    return mapMarkdownRead(event, input);
  }
  if (event['tool_name'] === 'Agent') {
    return mapSpawnCustodyStart(event);
  }
  return null;
}

/**
 * Parent custody, spawn side. Claude PAUSES an agent that spawned a
 * child and fires a non-terminal `SubagentStop` for it (resume fires a
 * fresh `SubagentStart`); nothing marks the last stop as terminal. So
 * instead of classifying stops, the spawn keeps the PARENT lit through
 * custody: a sticky claim on the parent's own node (the event's
 * `agent_type` IS the parent) owned by the synthetic `spawn:<tool_use_id>`
 * key. `mapSpawnCustodyHandoff` (PostToolUse) swaps it for a claim the
 * child's terminal end releases. Spawns from the MAIN context have no
 * `agent_type` (main is not a node) and are disclaimed.
 */
function mapSpawnCustodyStart(event: Record<string, unknown>): IActivitySignal[] | null {
  const parentName = nonEmptyString(event['agent_type']);
  const spawnKey = spawnOwnerKey(event);
  if (!parentName || !spawnKey) return null;
  return [{ kind: 'agent', name: parentName, phase: 'start', owner: spawnKey, sticky: true }];
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
 */
function mapSpawnCustodyHandoff(event: Record<string, unknown>): IActivitySignal[] | null {
  const parentName = nonEmptyString(event['agent_type']);
  const spawnKey = spawnOwnerKey(event);
  if (!parentName || !spawnKey) return null;
  const signals: IActivitySignal[] = [
    { kind: 'agent', name: parentName, phase: 'end', owner: spawnKey, ownerScope: true },
  ];
  const childId = runningChildId(event['tool_response']);
  if (childId) {
    signals.push({ kind: 'agent', name: parentName, phase: 'start', owner: childId, sticky: true });
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

function spawnOwnerKey(event: Record<string, unknown>): string | null {
  const toolUseId = nonEmptyString(event['tool_use_id']);
  return toolUseId ? `spawn:${toolUseId}` : null;
}

/**
 * Markdown usage: the runtime read a file. `Read` is HIGH-frequency
 * (every source file the assistant opens), so this is a FILTER FIRST:
 * every early return below discards an event that can never light a
 * node, before any node-set work happens downstream.
 *
 * - Not a `.md` file: source code, JSON, lockfiles, disclaim.
 * - No usable `cwd` on the event, or the file lies OUTSIDE it: the
 *   file cannot be a scanned node of THIS project, disclaim.
 *
 * Survivors become a PATH signal (scope-relative, forward-slash): the
 * resolver matches `node.path` directly, across kinds, so reading
 * `notes/todo.md` lights the markdown node and reading a skill's
 * `SKILL.md` lights that skill.
 */
function mapMarkdownRead(
  event: Record<string, unknown>,
  input: Record<string, unknown>,
): IActivitySignal[] | null {
  const filePath = nonEmptyString(input['file_path']);
  if (!filePath) return null;
  if (!filePath.toLowerCase().endsWith('.md')) return null;
  const cwd = nonEmptyString(event['cwd']);
  if (!cwd) return null;
  const prefix = cwd.endsWith('/') ? cwd : `${cwd}/`;
  if (!filePath.startsWith(prefix)) return null;
  const relative = filePath.slice(prefix.length);
  if (relative.length === 0) return null;
  return [{ path: relative, phase: 'start', owner: ownerOf(event) }];
}

/**
 * Native subagent boundary. The `agent_type` names the agent node; the
 * `agent_id` is the owner grouping key (each spawned instance has its
 * own). Empty `agent_type` = orphan noise, disclaimed. The end is
 * OWNER-SCOPED: a stopping subagent takes down every claim it holds
 * (the skills it invoked, the markdowns it read), not just its own
 * node, so the chain goes dark natively instead of waiting out the TTL.
 */
function mapSubagentBoundary(
  event: Record<string, unknown>,
  phase: 'start' | 'end',
): IActivitySignal[] | null {
  const name = nonEmptyString(event['agent_type']);
  if (!name) return null;
  const signal: IActivitySignal = { kind: 'agent', name, phase };
  const id = nonEmptyString(event['agent_id']);
  if (id) signal.owner = id;
  if (phase === 'start') signal.sticky = true;
  if (phase === 'end' && id) signal.ownerScope = true;
  return [signal];
}

/** `agent_id` when the event fired inside a subagent, else `'main'`. */
function ownerOf(event: Record<string, unknown>): string {
  return nonEmptyString(event['agent_id']) ?? MAIN_OWNER;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
