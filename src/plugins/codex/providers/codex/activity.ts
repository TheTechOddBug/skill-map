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
 * - **No parent custody**: Codex nesting is capped by
 *   `agents.max_depth` (default 1: spawns are main-only, and main is
 *   not a graph node). Even with a raised depth, spawning is
 *   documented as consolidate-on-completion (the parent waits for its
 *   children), so a parent's terminal `SubagentStop` arrives after its
 *   children's and the owner-scoped ends unwind bottom-up natively,
 *   no Claude-style pause/resume custody needed. The spawn-tool
 *   Pre/PostToolUse surface is therefore disclaimed and the descriptor
 *   does not even wire tool events (fewer bridge spawns: Codex fires
 *   PreToolUse for every Bash / apply_patch / MCP call, none of which
 *   is node-attributable).
 * - **No markdown-read signals**: Codex HAS an internal `read_file`
 *   tool but its hooks do not fire for it (PreToolUse covers only
 *   Bash / apply_patch / MCP; expanding it to `read_file` is an open
 *   upstream request, openai/codex#18491). Deliberately disclaimed
 *   until the hook surface exists; when it lands, this maps like
 *   claude's filter-first `Read` handling.
 *
 * Attribution: `owner` is `agent_id` when present, else `'main'`.
 */

import type {
  IActivitySignal,
  IProviderActivityAdapter,
} from '../../../../kernel/extensions/index.js';
import { DOLLAR_TOKEN_RE } from '../../../../kernel/util/dollar-token.js';

const MAIN_OWNER = 'main';

export const codexActivity: IProviderActivityAdapter = {
  install: {
    kind: 'json-hooks',
    configPath: '.codex/hooks.json',
    // Only the events mapEvent consumes; every wired event spawns one
    // bridge process. No tool events at all (see the module docstring:
    // nothing a Codex tool call reports is node-attributable), so the
    // bridge never runs on the high-frequency Bash / apply_patch / MCP
    // traffic. Matchers are omitted: none of these events is
    // tool-scoped, so there is nothing to match against.
    events: [
      { event: 'UserPromptSubmit' },
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
