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
 *   pair (matcher-scoped alongside the MCP tools below, so the bridge
 *   never runs on the high-frequency Bash / apply_patch traffic) carries
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
 * - **MCP usage**: a `PreToolUse` for an `mcp__<server>__<tool>` call
 *   (the matcher is widened to `^(spawn_agent|mcp__.+)$`) emits a PATH
 *   signal to the `mcp://<server>` node via the shared `mapMcpInvocation`.
 *   Codex reports the SAME `mcp__<server>__<tool>` identifier claude does
 *   (it force-prefixes the hook name, `codex-rs/.../tools/handlers/mcp.rs`),
 *   so a live call lights the very node `core/mcp-tools` and `mcpConfig`
 *   already drew. Deterministic, no inference; no end signal (UI decay
 *   owns the span, like a skill), so only PreToolUse is widened.
 * - **No markdown-read signals**: Codex HAS an internal `read_file`
 *   tool but its hooks do not fire for it (PreToolUse covers Bash /
 *   apply_patch / MCP; expanding it to `read_file` is an open upstream
 *   request, openai/codex#18491). Deliberately disclaimed until the hook
 *   surface exists; when it lands, this maps like claude's filter-first
 *   `Read` handling.
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
import {
  mapMcpInvocation,
  mapSubagentBoundary,
  nonEmptyString,
  sessionizedOwner,
  toolInputOf,
} from '../../../../kernel/util/activity-adapter.js';
import { DOLLAR_TOKEN_RE } from '../../../../kernel/util/dollar-token.js';

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
      { event: 'PreToolUse', matcher: '^(spawn_agent|mcp__.+)$' },
      { event: 'PostToolUse', matcher: '^spawn_agent$' },
      { event: 'SubagentStart' },
      { event: 'SubagentStop' },
      // Main-context turn end. Codex drops a subagent's own `SubagentStop`
      // when that subagent spawns a nested worker (live-verified
      // 2026-07-24), so the main `Stop` is the only signal that unwinds a
      // leaked subagent: it releases every owner of the session.
      { event: 'Stop' },
    ],
  },

  mapEvent(raw: unknown): IActivitySignal[] | null {
    if (raw === null || typeof raw !== 'object') return null;
    const event = raw as Record<string, unknown>;
    const signals = mapCodexEvent(event);
    if (signals === null) return null;
    // Stamp the session on every signal so the UI can group owners under
    // it and a `sessionScope` end can release the whole session together.
    const session = nonEmptyString(event['session_id']);
    if (session) {
      for (const signal of signals) if (signal.session === undefined) signal.session = session;
    }
    return signals;
  },
};

function mapCodexEvent(event: Record<string, unknown>): IActivitySignal[] | null {
  switch (event['hook_event_name']) {
    case 'UserPromptSubmit':
      return mapPromptSkills(event);
    case 'PreToolUse':
      return mapPreToolUse(event);
    case 'PostToolUse':
      return mapSpawnRelation(event, 'handoff');
    case 'SubagentStart':
      return mapSubagentBoundary(event, 'start');
    case 'SubagentStop':
      return mapSubagentBoundary(event, 'end');
    case 'Stop':
      return mapSessionEnd(event);
    default:
      return null;
  }
}

/**
 * Main-context `Stop` -> a session-scoped release. Carries the session id
 * (no owner, no node); the UI releases every owner grouped under it, so a
 * subagent whose own `SubagentStop` Codex dropped goes dark at turn end
 * instead of waiting out the 5-minute sticky safety net.
 */
function mapSessionEnd(event: Record<string, unknown>): IActivitySignal[] | null {
  const session = nonEmptyString(event['session_id']);
  if (!session) return null;
  return [{ phase: 'end', sessionScope: true, session }];
}

/**
 * `$<skill>` tokens in the submitted prompt, one start signal per
 * distinct token (sigil stripped; the resolver normalises and matches
 * against the open-standard `.agents/skills/` catalog). Codex has no
 * native end signal for a skill, so the UI's decay owns the span.
 */
function mapPromptSkills(event: Record<string, unknown>): IActivitySignal[] | null {
  const prompt = nonEmptyString(event['prompt']);
  if (!prompt) return null;
  const owner = sessionizedOwner(event);
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
 * `PreToolUse` fans out by tool: `spawn_agent` carries a spawn relation,
 * while an `mcp__<server>__<tool>` call lights the `mcp://<server>` node
 * (shared with claude via `mapMcpInvocation`; Codex reports the SAME
 * `mcp__` identifier to the hook, `codex-rs/.../tools/handlers/mcp.rs`
 * forces the prefix). Every other tool the widened matcher lets through
 * falls through to a disclaim.
 */
function mapPreToolUse(event: Record<string, unknown>): IActivitySignal[] | null {
  if (event['tool_name'] === 'spawn_agent') return mapSpawnRelation(event, 'start');
  return mapMcpInvocation(event);
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
  const owner = sessionizedOwner(event);
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

