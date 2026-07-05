/**
 * Live-activity adapter for the `opencode` Provider (see
 * `spec/provider-activity.md`). Maps ONE wrapped plugin payload (the
 * `{ hook, directory, ... }` envelope the in-process activity plugin
 * forwards, see `core/activity/plugin-template.ts`) into
 * node-attributable signals.
 *
 * Characterised against real runs (probe log 2026-07-04, opencode
 * v1.17.11 in `fixtures/realtime-opencode/`) cross-checked with the
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
 * - **Markdown reads**: `tool.execute.before` with `input.tool ===
 *   'read'`, `output.args.filePath` absolute; filter-first (`.md` only,
 *   inside the plugin context's `directory`), relativized to a PATH
 *   signal.
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

export const opencodeActivity: IProviderActivityAdapter = {
  install: {
    // In-process plugin: the file IS both the wiring and the bridge
    // (spec/provider-activity.md §capability, plugin-file paragraph).
    // BOTH `.opencode/plugin/` and `.opencode/plugins/` auto-load
    // (live-verified); install targets the singular form.
    kind: 'plugin-file',
    configPath: '.opencode/plugin/skill-map-activity.js',
  },

  mapEvent(raw: unknown): IActivitySignal[] | null {
    if (raw === null || typeof raw !== 'object') return null;
    const wrapper = raw as Record<string, unknown>;
    switch (wrapper['hook']) {
      case 'tool.execute.before':
        return mapToolCall(wrapper);
      case 'tool.execute.after':
        return mapTaskCompletion(wrapper);
      case 'command.execute.before':
        return mapCommand(wrapper);
      case 'chat.message':
        return mapChatMessage(wrapper);
      case 'event':
        return mapSessionIdle(wrapper);
      default:
        return null;
    }
  },
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
    return [{ kind: 'skill', name, phase: 'start', owner: ownerOf(input) }];
  }
  if (input['tool'] === 'read') {
    return mapMarkdownRead(wrapper, input, args);
  }
  if (input['tool'] === 'task') {
    return mapTaskSpawn(input, args);
  }
  return null;
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
 * Markdown usage, filter-first (mirroring the claude `Read` handling):
 * non-`.md` reads and reads outside the plugin context's `directory`
 * are early-disclaimed; survivors become scope-relative PATH signals.
 */
function mapMarkdownRead(
  wrapper: Record<string, unknown>,
  input: Record<string, unknown>,
  args: Record<string, unknown>,
): IActivitySignal[] | null {
  const filePath = nonEmptyString(args['filePath']);
  if (!filePath) return null;
  if (!filePath.toLowerCase().endsWith('.md')) return null;
  const directory = nonEmptyString(wrapper['directory']);
  if (!directory) return null;
  const prefix = directory.endsWith('/') ? directory : `${directory}/`;
  if (!filePath.startsWith(prefix) || filePath.length <= prefix.length) return null;
  return [{ path: filePath.slice(prefix.length), phase: 'start', owner: ownerOf(input) }];
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

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
