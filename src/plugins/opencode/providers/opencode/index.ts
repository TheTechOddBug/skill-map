/**
 * Built-in `opencode` Provider. Onboards the OpenCode CLI (open-source,
 * model-agnostic terminal coding agent, https://opencode.ai) into skill-map
 * under the `opencode` active lens.
 *
 * Three on-disk families, all markdown + YAML frontmatter, so a SINGLE `read`
 * rule covers them and `classify()` routes each path to its kind:
 *
 *   - **agents** (`.opencode/agent/<name>.md`, SINGULAR `agent`): its OWN
 *     kind. Frontmatter is `description` + `mode` (all|primary|subagent) +
 *     `permission` + `model`; there is NO `name` field, the filename stem is
 *     the handle.
 *   - **commands** (`.opencode/commands/<name>.md`, PLURAL `commands`): its
 *     OWN kind, the slash-invocable (`/<name>`). Frontmatter is `description`
 *     + optional `agent` / `model`; the filename stem is the command name.
 *     (The singular `agent` vs plural `commands` asymmetry is OpenCode's own,
 *     captured verbatim from its docs.)
 *   - **skills**: OpenCode is "omnivorous", it searches its own
 *     `.opencode/skills/<n>/SKILL.md` AND the Claude-compatible
 *     `.claude/skills/<n>/SKILL.md` AND the open-standard
 *     `.agents/skills/<n>/SKILL.md`. Under the opencode lens `classify()`
 *     claims all three (the open-standard one via `classifyCommonsPath`, by
 *     manifest composition with `agent-skills`).
 *
 * **Claude-compat is asymmetric.** OpenCode's Claude Code compatibility covers
 * the `CLAUDE.md` instruction file and `.claude/skills/` ONLY, NOT
 * `.claude/agents/` (OpenCode agents use their own `mode` / `permission`
 * frontmatter, a different format). So `agent` claims only `.opencode/agent/`;
 * only `skill` reaches into `.claude/skills/`. The global
 * `~/.config/opencode/...` and `~/.claude/...` homes OpenCode also reads are
 * excluded by skill-map's hard "never read $HOME" invariant.
 *
 * **Gating dissolves the cross-lens collision.** `gatedByActiveLens: true`, so
 * this `classify()` runs ONLY when opencode is the active lens; the claude lens
 * does not participate then, so claiming `.claude/skills/` here collides with
 * nothing (no `provider-ambiguous`). Claude's own behaviour is untouched.
 *
 * Resources:
 *   - Agents:   https://opencode.ai/docs/agents
 *   - Commands: https://opencode.ai/docs/commands
 *   - Skills:   https://opencode.ai/docs/skills
 *   - Rules:    https://opencode.ai/docs/rules
 */

import type { IBuiltInManifest, IProvider } from '../../../../kernel/extensions/index.js';
import agentSchema from './schemas/agent.schema.json' with { type: 'json' };
import commandSchema from './schemas/command.schema.json' with { type: 'json' };
import { OPENCODE_PLUGIN_ID } from '../../../ids.js';
import { opencodeActivity } from './activity.js';
import {
  COMMONS_READ,
  COMMONS_KINDS,
  COMMONS_RESERVED_NAMES,
  classifyCommonsPath,
} from '../../../agent-skills/providers/agent-skills/index.js';

/**
 * OpenCode's built-in slash commands (https://opencode.ai/docs/commands): the
 * universal cross-agent base (shared `COMMONS_RESERVED_NAMES`, owned by
 * `agent-skills`) plus OpenCode's OWN runtime verbs on top, so the neutral
 * standard never carries `opencode`-specific commands. A user command named
 * after one of these is silently shadowed by the runtime ("Custom commands can
 * override built-in commands"), so `core/name-reserved` flags it. Authored
 * lowercase, no leading `/` (the analyzer normalises both sides).
 *
 * Reconciliation marker: re-capture from OpenCode's command docs on each major
 * release; move any verb that becomes universal across agents down into
 * `COMMONS_RESERVED_NAMES`.
 */
const OPENCODE_RESERVED_SLASH_VERBS: readonly string[] = [
  // Inherited open-standard base (universal cross-agent slash commands).
  ...(COMMONS_RESERVED_NAMES['skill'] ?? []),
  // OpenCode-specific built-in verbs (`/help` already lives in the base).
  'init',
  'redo',
  'share',
  'undo',
];

export const opencodeProvider: IBuiltInManifest<IProvider> = {
  id: 'opencode',
  pluginId: OPENCODE_PLUGIN_ID,
  kind: 'provider',
  description:
    'Classifies `.opencode/agent/*.md` as OpenCode agents and `.opencode/commands/*.md` as OpenCode commands (its own kinds), and skills under `.opencode/skills/`, `.claude/skills/`, and `.agents/skills/` (the project-level homes OpenCode reads).',

  // Provider identity for the active-lens dropdown, the topbar lens chip, and
  // the per-node provider chip. OpenCode has no strong model vendor (it is
  // model-agnostic), so the label is the bare product name, NOT a possessive
  // `<Vendor>'s <product>` like the other vendor lenses. Cyan, distinct from
  // codex green, antigravity violet, and the agent-skills slate.
  presentation: {
    label: 'OpenCode',
    color: '#0891b2',
    colorDark: '#22d3ee',
    // OpenCode invokes its custom commands with `/<name>`; the palette paints
    // this as the `invokes` edge glyph under the opencode lens. (Skills are
    // loaded by OpenCode's native `skill` tool, not a body sigil.)
    invocationSigil: '/',
  },

  // Auto-detect marker: a `.opencode/` directory marks an OpenCode project.
  // `subsumes: ['claude']` because the Claude-compat above is one-way:
  // OpenCode reads `.claude/skills/` + `CLAUDE.md`, Claude Code never reads
  // `.opencode/`. So `.claude/` inside an OpenCode project is EXPECTED, not
  // evidence Claude Code is in use, and the pair is not a real tie: it
  // resolves to `opencode` instead of prompting. Genuinely orthogonal pairs
  // (`.claude/` + `.codex/`) still prompt.
  detect: { markers: ['.opencode'], subsumes: ['claude'] },

  // Live node activity (spec/provider-activity.md): plugin-file install
  // (in-process plugin at `.opencode/plugin/skill-map-activity.js`, no
  // spawned bridge) + the runtime mapper over the plugin's wrapped hook
  // payloads. Implementation + rationale in the sibling `activity.ts`.
  activity: opencodeActivity,

  // Config-side MCP discovery: OpenCode reads project MCP servers from a
  // project-root `opencode.json` (`mcp` block, https://opencode.ai/docs/mcp-servers).
  // Unlike Antigravity (whose MCP config is home-global, off-limits to the
  // project-local scanner), OpenCode's lives in-project and is committable, so
  // the kernel materialises each `mcp://<server>` node config-side, the same
  // node `core/mcp-tools` draws from a skill's `tools:` frontmatter.
  mcpConfig: { sources: [{ path: 'opencode.json', dialect: 'json-mcp-servers' }] },

  // Vendor lens: gated to the active lens. OpenCode only resolves its own
  // territory (plus the Claude-compat / open-standard skill homes it reads).
  // Gating keeps the walker from claiming OpenCode territory under another
  // lens, where the OpenCode runtime would never resolve it anyway, and keeps
  // the `.claude/skills/` claim here from colliding with the claude lens.
  gatedByActiveLens: true,

  // Beta: ships enabled, auto-detects `.opencode/`, selectable as the active
  // lens, with a maturity badge. Same posture as codex / antigravity, since
  // the lens is freshly landed. Promote to `stable` (drop the field) once it
  // has real-world mileage.
  stability: 'beta',

  // OpenCode READS the open `.agents/skills` territory (its `skill` kind is
  // `COMMONS_KINDS`, composed from `agent-skills` above), so a processing
  // skill materialised there IS discovered by this runtime. `agent-skills`
  // OWNS the territory as the canonical destination, named here via
  // `sharedWith`: destination-choice verbs (`sm tutorial`) keep listing the
  // owner alone, while per-lens probes (`sm agent install / status`, the
  // Quick Start row) now resolve under the opencode lens instead of refusing
  // "declares no skill directory".
  scaffold: { skillDir: '.agents/skills', sharedWith: 'agent-skills' },

  // Single read rule: all three families are `.md` + YAML frontmatter, so one
  // `COMMONS_READ` pass suffices (no multi-rule `read` like codex, which mixes
  // `.toml`). `classify()` below routes each path to its kind.
  read: COMMONS_READ,

  kinds: {
    agent: {
      schema: './schemas/agent.schema.json',
      schemaJson: agentSchema,
      ui: {
        label: 'Agents',
        // Cross-provider agent vocabulary: same blue as Claude's `agent` kind,
        // so an agent paints the same regardless of which lens sourced it.
        color: '#3b82f6',
        colorDark: '#60a5fa',
        icon: { kind: 'pi', id: 'pi-user' },
      },
      // No `name` frontmatter field: the filename stem
      // (`.opencode/agent/<name>.md`) is the handle.
      identifiers: ['filename-basename'],
    },
    command: {
      schema: './schemas/command.schema.json',
      schemaJson: commandSchema,
      ui: {
        label: 'Commands',
        // Cross-provider command vocabulary: same amber (and icon) as Claude's
        // `command` kind and Antigravity's `workflow` kind.
        color: '#f59e0b',
        colorDark: '#fbbf24',
        icon: { kind: 'svg', path: 'M4 17 L10 11 L4 5 M12 19 L20 19' },
      },
      // The filename stem is the command name (`/<name>`); no `name` field.
      identifiers: ['filename-basename'],
    },
    // Open-standard `skill` kind, inherited from `agent-skills` by manifest
    // composition (same schema + green visuals every adopter shares).
    // `classify()` routes the three skill homes OpenCode reads into this kind.
    ...COMMONS_KINDS,
  },

  // `/<name>` slash invocations resolve to commands ONLY: OpenCode reserves the
  // slash for its custom commands, and loads skills via its native `skill` tool
  // (no `/`-invocation), so `invokes` does NOT target `skill` here (unlike
  // claude). Overrides the open-standard default (`invokes: ['skill']`). The
  // `core/slash-command` extractor is authorised under the opencode lens (its
  // precondition lists `opencode`) so `/deploy` in a body emits the link.
  resolution: { invokes: ['command'] },

  // Reserved built-in slash commands, applied to the `command` kind (the only
  // `/`-invocable OpenCode kind: skills are tool-loaded, not slash-invoked, so
  // a skill named after a built-in cannot be shadowed through the slash
  // channel and is deliberately NOT reserved).
  reservedNames: {
    command: OPENCODE_RESERVED_SLASH_VERBS,
  },

  classify(path: string): string | null {
    const lower = path.toLowerCase();
    // OpenCode's own agents: `.opencode/agent/<name>.md` (SINGULAR `agent`,
    // one file level, no subfolder).
    if (/^\.opencode\/agent\/[^/]+\.md$/.test(lower)) return 'agent';
    // OpenCode's own commands: `.opencode/commands/<name>.md` (PLURAL
    // `commands`, asymmetric with the singular `agent`, per OpenCode's docs).
    if (/^\.opencode\/commands\/[^/]+\.md$/.test(lower)) return 'command';
    // Skills, the three project homes OpenCode searches. Strict folder shape
    // (`<name>/SKILL.md`, one level): supporting files inside a skill folder
    // are disclaimed so `core/markdown` picks them up.
    //   - own:           `.opencode/skills/<n>/SKILL.md`
    //   - Claude-compat: `.claude/skills/<n>/SKILL.md`
    if (/^\.opencode\/skills\/[^/]+\/skill\.md$/.test(lower)) return 'skill';
    if (/^\.claude\/skills\/[^/]+\/skill\.md$/.test(lower)) return 'skill';
    //   - open standard: `.agents/skills/<n>/SKILL.md` (shared classifier).
    // Everything else -> null (disclaimed; falls through to `core/markdown`).
    // NOTE: `.claude/agents/` and `.claude/commands/` are NOT claimed here,
    // OpenCode's Claude-compat covers skills + CLAUDE.md only, not agents.
    return classifyCommonsPath(path);
  },
};
