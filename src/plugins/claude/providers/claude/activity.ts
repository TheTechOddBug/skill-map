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
    // to the two attributable tools; plain Bash/Read/... calls never
    // spawn the bridge at all.
    events: [
      { event: 'UserPromptExpansion', matcher: '*' },
      { event: 'PreToolUse', matcher: '^(Skill|Agent)$' },
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
  if (event['tool_name'] === 'Agent') {
    const name = nonEmptyString(input['subagent_type']);
    if (!name) return null;
    return [{ kind: 'agent', name, phase: 'start', owner: ownerOf(event) }];
  }
  return null;
}

/**
 * Native subagent boundary. The `agent_type` names the agent node; the
 * `agent_id` is the owner grouping key (each spawned instance has its
 * own). Empty `agent_type` = orphan noise, disclaimed.
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
  return [signal];
}

/** `agent_id` when the event fired inside a subagent, else `'main'`. */
function ownerOf(event: Record<string, unknown>): string {
  return nonEmptyString(event['agent_id']) ?? MAIN_OWNER;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
