/**
 * Live-activity adapter for the `codex` Provider (see
 * `spec/provider-activity.md`). Maps ONE raw Codex CLI hook payload
 * (the JSON the runtime pipes to a hook command's stdin, forwarded
 * verbatim by the activity bridge) into node-attributable signals.
 *
 * Characterised against real runs (probe logs, 2026-06-30, codex
 * 0.142.x) and validated against the official hooks reference
 * (https://developers.openai.com/codex/hooks). Codex's hook config
 * uses the SAME `{ hooks: { <Event>: [...] } }` convention as Claude
 * (so the shared `json-hooks` install engine applies verbatim), and
 * its payloads are near-identical (`session_id`, `cwd`,
 * `hook_event_name`, `agent_id`, `agent_type`, ...). The SIGNAL
 * surface is narrower though:
 *
 * - **Skill**: there is NO structured Skill tool event. A skill
 *   invocation surfaces only as the `$<name>` token inside
 *   `UserPromptSubmit.prompt` (Codex's explicit invocation grammar,
 *   the analog of claude's `/command`). The adapter scans the prompt
 *   with the SAME shared `$`-token grammar the `dollar-skill` body
 *   extractor uses (`kernel/util/dollar-token.ts`), so activity and
 *   link extraction can never disagree about what counts as an
 *   invocation. One signal per distinct token; unresolved names drop
 *   at the resolver (a `$typo` never lights a phantom).
 * - **Agent**: the native `SubagentStart` / `SubagentStop` pair
 *   carries `agent_id` + `agent_type`. A NAMED agent type resolves to
 *   its `.codex/agents/<name>.toml` node (identifiers:
 *   `frontmatter.name`, `filename-basename`); the default generic
 *   `worker` type matches no scanned node and drops at the resolver.
 * - **Spawn relations, no custody**: the `spawn_agent` Pre/PostToolUse
 *   pair (the ONLY tool events the descriptor wires, matcher-scoped so
 *   the bridge never runs on Bash / apply_patch / MCP traffic) carries
 *   the spawn relation: `tool_input.agent_type` + `message` (the
 *   prompt) on the start, and the child's `agent_id` inside the
 *   JSON-string `tool_response` on the handoff (live-verified
 *   2026-07-05). Claude-style pause/resume custody is UNNECESSARY:
 *   a Codex parent never pauses (it blocks inside the wait tool), so
 *   terminal `SubagentStop`s unwind bottom-up natively; the signal
 *   carrying an agent-context spawn is a plain keep-alive heartbeat on
 *   the parent, only there so the resolver can stamp `parentNodePath`
 *   on the frame. The wait / close tool responses repeat the child's
 *   final report and stay disclaimed: the stop's
 *   `last_assistant_message` (the generic report path) is the
 *   response source.
 * - **No markdown-read signals**: Codex HAS an internal `read_file`
 *   tool but its hooks do not fire for it (PreToolUse covers only
 *   Bash / apply_patch / MCP; expanding it to `read_file` is an open
 *   upstream request, openai/codex#18491). Deliberately disclaimed
 *   until the hook surface exists; when it lands, this maps like
 *   claude's filter-first `Read` handling.
 *
 * Attribution: `owner` is `agent_id` when present, else the SESSIONIZED
 * main key (`main:<session_id>`, bare `main` for payloads with no
 * session id), same convention as the claude adapter so parallel
 * sessions never collide under one owner.
 */

import type {
  IActivitySignal,
  IActivitySpawnRelation,
  IProviderActivityAdapter,
} from '../../../../kernel/extensions/index.js';
import { DOLLAR_TOKEN_RE } from '../../../../kernel/util/dollar-token.js';

const MAIN_OWNER = 'main';

export const codexActivity: IProviderActivityAdapter = {
  install: {
    kind: 'json-hooks',
    configPath: '.codex/hooks.json',
    // Only the events mapEvent consumes; every wired event spawns one
    // bridge process. The single tool surface is the spawn tool,
    // matcher-scoped so the bridge never runs on the high-frequency
    // Bash / apply_patch / MCP traffic.
    events: [
      { event: 'UserPromptSubmit' },
      { event: 'PreToolUse', matcher: '^spawn_agent$' },
      { event: 'PostToolUse', matcher: '^spawn_agent$' },
      { event: 'SubagentStart' },
      { event: 'SubagentStop' },
    ],
  },

  mapEvent(raw: unknown): IActivitySignal[] | null {
    if (raw === null || typeof raw !== 'object') return null;
    const event = raw as Record<string, unknown>;
    switch (event['hook_event_name']) {
      case 'UserPromptSubmit':
        return mapPromptSkills(event);
      case 'PreToolUse':
        return mapSpawnRelation(event, 'start');
      case 'PostToolUse':
        return mapSpawnRelation(event, 'handoff');
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
 * `$<skill>` tokens in the submitted prompt, one start signal per
 * distinct token (sigil stripped; the resolver normalises and matches
 * against the open-standard `.agents/skills/` catalog). Codex has no
 * native end signal for a skill, so the UI's decay owns the span.
 */
function mapPromptSkills(event: Record<string, unknown>): IActivitySignal[] | null {
  const prompt = nonEmptyString(event['prompt']);
  if (!prompt) return null;
  const owner = ownerOf(event);
  const seen = new Set<string>();
  const signals: IActivitySignal[] = [];
  for (const match of prompt.matchAll(DOLLAR_TOKEN_RE)) {
    const name = match[1]!.slice(1);
    if (seen.has(name)) continue;
    seen.add(name);
    signals.push({ kind: 'skill', name, phase: 'start', owner });
  }
  return signals.length > 0 ? signals : null;
}

/**
 * `spawn_agent` Pre/PostToolUse -> spawn relation. The start carries
 * the child name + the prompt (`tool_input.agent_type` / `message`);
 * the handoff carries the child's own id, parsed from the JSON-string
 * `tool_response` (`{"agent_id":"...","nickname":"..."}`,
 * live-verified 2026-07-05). An agent-context spawn rides a keep-alive
 * heartbeat claim on the PARENT node (only so the resolver stamps
 * `parentNodePath`; Codex parents never pause, custody is unnecessary);
 * a main-context spawn emits the relation-only form.
 */
function mapSpawnRelation(
  event: Record<string, unknown>,
  phase: 'start' | 'handoff',
): IActivitySignal[] | null {
  if (event['tool_name'] !== 'spawn_agent') return null;
  const toolUseId = nonEmptyString(event['tool_use_id']);
  if (!toolUseId) return null;
  const input = toolInputOf(event);
  const owner = ownerOf(event);
  const spawn: IActivitySpawnRelation = { spawnId: toolUseId, phase, parentOwner: owner };
  const childName = nonEmptyString(input['agent_type']);
  if (childName) {
    spawn.childKind = 'agent';
    spawn.childName = childName;
  }
  if (phase === 'start') {
    const prompt = nonEmptyString(input['message']);
    if (prompt) spawn.prompt = prompt;
  } else {
    const childId = spawnedChildId(event['tool_response']);
    if (childId) spawn.childOwner = childId;
  }
  const parentName = nonEmptyString(event['agent_type']);
  if (!parentName) {
    return [{ phase: 'start', owner, spawn }];
  }
  return [
    { kind: 'agent', name: parentName, phase: 'start', owner, keepAlive: true, spawn },
  ];
}

/** The spawned child's id, from the JSON-string spawn response. */
function spawnedChildId(response: unknown): string | null {
  if (typeof response !== 'string' || response.length === 0) return null;
  try {
    const parsed = JSON.parse(response) as unknown;
    if (parsed === null || typeof parsed !== 'object') return null;
    return nonEmptyString((parsed as Record<string, unknown>)['agent_id']);
  } catch {
    return null;
  }
}

function toolInputOf(event: Record<string, unknown>): Record<string, unknown> {
  const input = event['tool_input'];
  return input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {};
}

/**
 * Native subagent boundary, mirroring the claude adapter's semantics:
 * `agent_type` names the agent node, `agent_id` is the owner grouping
 * key, starts are sticky lifecycle claims, and the stop is OWNER-SCOPED
 * so a terminating subagent takes down everything it lit. Empty
 * `agent_type` is disclaimed defensively (claude emits such orphans;
 * Codex has not been observed to, but the guard costs nothing).
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
  if (phase === 'end' && id) {
    signal.ownerScope = true;
    // The stop carries the agent's final message (live-verified
    // 2026-07-05): the response source for the retained conversation.
    const report = nonEmptyString(event['last_assistant_message']);
    if (report) signal.report = report;
  }
  return [signal];
}

/**
 * `agent_id` when the event fired inside a subagent, else the
 * SESSIONIZED main key (`main:<session_id>`; bare `main` for payloads
 * with no session id). Opaque downstream, nothing parses it.
 */
function ownerOf(event: Record<string, unknown>): string {
  const agentId = nonEmptyString(event['agent_id']);
  if (agentId) return agentId;
  const sessionId = nonEmptyString(event['session_id']);
  return sessionId ? `${MAIN_OWNER}:${sessionId}` : MAIN_OWNER;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
