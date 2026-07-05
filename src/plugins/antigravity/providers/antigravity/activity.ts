/**
 * Live-activity adapter for the `antigravity` Provider (see
 * `spec/provider-activity.md`). Maps ONE raw Antigravity (`agy`) hook
 * payload (piped to the hook command's stdin, forwarded verbatim by the
 * activity bridge) into node-attributable signals.
 *
 * Characterised against real runs (probe log, 2026-07-04, workspace
 * `fixtures/realtime-antigravity/`) cross-checked with the official
 * hooks surface (antigravity.google/docs/hooks; events PreToolUse /
 * PostToolUse / PreInvocation / PostInvocation / Stop). Antigravity's
 * signal surface is read-shaped:
 *
 * - **Payloads carry NO `hook_event_name`** (unlike Claude / Codex).
 *   Events are distinguished STRUCTURALLY: a `toolCall` object means a
 *   tool event, `invocationNum` an invocation pulse, `terminationReason`
 *   the Stop. The descriptor only wires `PreToolUse` matcher
 *   `view_file`, so in practice every bridge-forwarded payload is a
 *   file-view tool event; the shape guard keeps hand-wired extras
 *   harmless.
 * - **The ONE mapped signal is `view_file`**
 *   (`toolCall.args.AbsolutePath`, absolute): in-scope `.md` views
 *   become PATH signals, which is how EVERYTHING lights on this
 *   provider. Skills' `references/*.md` reads light those resources, a
 *   workflow FOLLOWED in prose lights its `.agent/workflows/*.md` node
 *   (the runtime `view_file`s the workflow file first, live-verified),
 *   and plain markdown reads light markdown nodes.
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
} from '../../../../kernel/util/activity-adapter.js';

export const antigravityActivity: IProviderActivityAdapter = {
  install: {
    kind: 'json-hooks',
    configPath: '.agents/hooks.json',
    group: 'skill-map-activity',
    // agy spawns hook commands at the CONFIG's directory (.agents/),
    // not the workspace root (live-verified 2026-07-04), so the bridge
    // command needs the ../ hop to resolve.
    commandCwd: 'config-dir',
    // Two events: file views (the only node-attributable signal this
    // runtime exposes, so the bridge never spawns for run_command /
    // write_to_file / subagent traffic) and the conversation Stop
    // (owner release: the whole chain goes dark the moment the agent
    // idles instead of waiting out the decay). Stop takes the FLAT
    // entry shape (agy's lifecycle events reject the matcher group).
    events: [
      { event: 'PreToolUse', matcher: 'view_file' },
      { event: 'Stop', entryShape: 'flat' },
    ],
  },

  mapEvent(raw: unknown): IActivitySignal[] | null {
    if (raw === null || typeof raw !== 'object') return null;
    const event = raw as Record<string, unknown>;
    const toolCall = readToolCall(event);
    if (toolCall !== null) {
      return toolCall.name === 'view_file' ? mapFileView(event, toolCall.args) : null;
    }
    return mapConversationStop(event);
  },
};

interface IToolCall {
  name: string;
  args: Record<string, unknown>;
}

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
 * scanned `node.path` space.
 */
function mapFileView(
  event: Record<string, unknown>,
  args: Record<string, unknown>,
): IActivitySignal[] | null {
  const relative = relativizeMarkdownPath(args['AbsolutePath'], event['workspacePaths']);
  if (relative === null) return null;
  return [{ path: relative, phase: 'start', owner: ownerOf(event) }];
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
