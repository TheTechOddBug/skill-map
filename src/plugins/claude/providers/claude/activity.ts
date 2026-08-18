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
 * - **Markdown usage**: `PreToolUse` with `tool_name` `Read`, `Write`
 *   or `Edit` carries `tool_input.file_path`; in-scope `.md` touches
 *   become PATH signals with the literal tool name as `detail`, so the
 *   UI labels reads apart from writes (see `mapMarkdownUsage`,
 *   filter-first: everything else is early-disclaimed). A `Write`
 *   creating a NEW file resolves to no scanned node and drops until the
 *   watcher scans it. Auto-loaded session context (`CLAUDE.md`) fires
 *   no tool event and stays invisible by design.
 * - **Turn boundary**: the main-context `Stop` maps to the node-less
 *   TURN-END form (`turnEnd: true`), sweeping sync spawn relations whose
 *   completion hook never fired (see `mapMainTurnEnd`). It is NOT an
 *   owner release: main's node claims keep the v1 TTL-decay contract.
 * - Everything else (`SessionEnd`, plain tool calls, ...) is
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
  mapMcpInvocation,
  mapShellInvocation,
  mapSubagentBoundary,
  nonEmptyString,
  relativizeMarkdownPath,
  sessionizedOwner,
  toolInputOf,
} from '../../../../kernel/util/activity-adapter.js';

export const claudeActivity: IProviderActivityAdapter = {
  install: {
    kind: 'json-hooks',
    configPath: '.claude/settings.json',
    // Claude Code sets this for every hook command it spawns ("Hooks:
    // Added CLAUDE_PROJECT_DIR env var for hook commands"), so the
    // bridge path stops depending on the spawn cwd. It used to be
    // written scope-relative on the documented assumption that hooks run
    // at the project root; that holds at launch but not for the whole
    // session, because an agent that changes directory while working
    // takes the hook cwd with it, and ingestion then dies on a
    // `MODULE_NOT_FOUND` naming a path nobody wrote.
    projectDirEnvVar: 'CLAUDE_PROJECT_DIR',
    // Only the events mapEvent consumes: every wired event spawns one
    // bridge process, so the list stays tight. Tool events are narrowed
    // to the attributable tools (Skill invocations, Read/Write/Edit for
    // markdown usage, Agent spawns for parent custody); plain
    // Bash/Grep/... calls never spawn the bridge at all. Survivors are
    // further filtered inside mapEvent (in-scope `.md` touches,
    // agent-context spawns).
    events: [
      { event: 'UserPromptExpansion', matcher: '*' },
      { event: 'PreToolUse', matcher: '^(Skill|Agent|Read|Write|Edit|mcp__.+)$' },
      // Shell rung, OPT-IN only (spec provider-activity.md, Capture
      // level rung 5): rendered when `activity.shellCapture` is on
      // (`sm activity install claude --shell`). Command lines are
      // operator content; the mapper extracts .md path tokens and
      // discards the text.
      { event: 'PreToolUse', matcher: '^Bash$', optIn: 'shell' },
      { event: 'PostToolUse', matcher: '^Agent$' },
      { event: 'SubagentStart', matcher: '*' },
      { event: 'SubagentStop', matcher: '*' },
      // Main-context turn boundary: sweeps sync spawn relations whose
      // completion hook never fired (interrupted / failed Agent calls).
      { event: 'Stop', matcher: '*' },
      // Whole-session boundary (2026-08-16): the exact finalization
      // signal the session journal was designed to upgrade onto.
      // `SessionStart` stays deliberately unwired: no session-start
      // signal form exists in the wire vocabulary, and the journal
      // derives identity + start time from the first frame anyway.
      { event: 'SessionEnd', matcher: '*' },
    ],
  },

  mapEvent(raw: unknown): IActivitySignal[] | null {
    if (raw === null || typeof raw !== 'object') return null;
    const event = raw as Record<string, unknown>;
    const name = event['hook_event_name'];
    const mapper = typeof name === 'string' ? EVENT_MAPPERS.get(name) : undefined;
    return mapper ? mapper(event) : null;
  },
};

/**
 * Consumed-event dispatch. A `Map` (not a plain object) so a garbage
 * `hook_event_name` like `toString` can never resolve to a prototype
 * member: the mapper must stay total over arbitrary bridge input.
 */
const EVENT_MAPPERS = new Map<string, (event: Record<string, unknown>) => IActivitySignal[] | null>([
  ['UserPromptExpansion', mapSlashExpansion],
  ['PreToolUse', mapPreToolUse],
  ['PostToolUse', mapPostToolUse],
  ['SubagentStart', (event) => mapSubagentBoundary(event, 'start')],
  ['SubagentStop', (event) => mapSubagentBoundary(event, 'end')],
  ['Stop', mapMainTurnEnd],
  ['SessionEnd', mapSessionEnd],
]);

/**
 * Whole-session boundary. Claude fires `SessionEnd` when the session
 * terminates (clear / logout / prompt-input exit / other reasons); it
 * maps to the node-less SESSION-RELEASE form keyed by `session_id`
 * (the codex main-`Stop` precedent), releasing every owner grouped
 * under the session and, above all, handing the server-side session
 * journal its EXACT finalization boundary (spec §Session journal:
 * finalize on a `sessionScope` end; the journal matches by the
 * sessionId it derived from the `main:<session_id>` owner prefix). A
 * payload without `session_id` disclaims: nothing to release by.
 */
function mapSessionEnd(event: Record<string, unknown>): IActivitySignal[] | null {
  const session = nonEmptyString(event['session_id']);
  if (!session) return null;
  return [{ phase: 'end', sessionScope: true, session }];
}

/**
 * Main-context turn boundary. Claude fires `Stop` ONLY when the main
 * agent's response completes (a subagent's boundary is `SubagentStop`),
 * so unlike the nap-ambiguous subagent stops this is a real turn end:
 * any sync spawn of this session still open at this point is provably
 * dead (`PostToolUse` fires only on a SUCCESSFUL tool call, so an
 * interrupted or failed `Agent` call left a relation with no end
 * frame). Emits the node-less TURN-END form; deliberately NOT an
 * `ownerScope` release, main's node claims keep the v1 TTL-decay
 * contract (`spec/provider-activity.md` §Per-provider signal notes).
 */
function mapMainTurnEnd(event: Record<string, unknown>): IActivitySignal[] {
  return [{ phase: 'end', owner: sessionizedOwner(event), turnEnd: true }];
}

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
    // `detail` carries the literal invoking tool name so the UI can
    // badge the lit card (spec/provider-activity.md §detail).
    return [{ kind: 'skill', name, phase: 'start', owner: sessionizedOwner(event), detail: 'Skill' }];
  }
  const toolName = event['tool_name'];
  if (toolName === 'Read' || toolName === 'Write' || toolName === 'Edit') {
    return mapMarkdownUsage(event, input, toolName);
  }
  if (event['tool_name'] === 'Agent') {
    return mapSpawnCustodyStart(event);
  }
  if (toolName === 'Bash') {
    // Shell rung (spec Capture level rung 5): the shared
    // claude-convention mapper (also codex since 2026-08-18); the
    // command text never leaves the parser. URL remnants (the token
    // regex cannot cross the `:` in `https://`, so a URL surfaces as
    // its `//host/...` tail) fall out as absolute paths outside the
    // root.
    return mapShellInvocation(event);
  }
  return mapMcpInvocation(event);
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
      // Literal invoking tool name for the card badge
      // (spec/provider-activity.md §detail).
      detail: 'Agent',
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
 * Markdown usage: the runtime read or wrote a file (`Read` / `Write` /
 * `Edit`, all carrying `tool_input.file_path`). `Read` is HIGH-frequency
 * (every source file the assistant opens), so the shared filter-first
 * relativizer discards everything that can never light a node (non-`.md`
 * paths, no usable `cwd`, files outside it) before any node-set work
 * happens downstream. Survivors become a PATH signal (scope-relative,
 * forward-slash): the resolver matches `node.path` directly, across
 * kinds, so touching `notes/todo.md` lights the markdown node and
 * touching a skill's `SKILL.md` lights that skill. The literal tool name
 * rides as `detail` so the UI labels reads apart from writes; a `Write`
 * creating a NEW file resolves to no scanned node and drops until the
 * watcher scans it.
 */
function mapMarkdownUsage(
  event: Record<string, unknown>,
  input: Record<string, unknown>,
  toolName: string,
): IActivitySignal[] | null {
  const relative = relativizeMarkdownPath(input['file_path'], [event['cwd']]);
  if (relative === null) return null;
  // `detail` = literal invoking tool name (spec/provider-activity.md §detail);
  // Write / Edit stamp the write access class (capture-level rung 3).
  return [
    {
      path: relative,
      phase: 'start',
      owner: sessionizedOwner(event),
      detail: toolName,
      ...(toolName === 'Write' || toolName === 'Edit' ? { access: 'write' as const } : {}),
    },
  ];
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

