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
 *
 * `owner` is the `sessionID` throughout (one per (sub)session).
 */

import type {
  IActivitySignal,
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
  return null;
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
