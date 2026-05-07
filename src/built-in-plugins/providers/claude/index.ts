/**
 * Built-in `claude` Provider. Walks Claude Code's on-disk convention:
 *
 *     <root>/.claude/agents/*.md             → kind: agent
 *     <root>/.claude/commands/*.md           → kind: command
 *     <root>/.claude/skills/<name>/SKILL.md  → kind: skill
 *     <root>/notes/**.md                     → kind: markdown
 *     <root>/**.md  (fallback)               → kind: markdown
 *
 * Discovery is declarative — `read: { extensions: ['.md'], parser:
 * 'frontmatter-yaml' }` routes through the kernel walker, which owns
 * the symlink / TOCTOU / pollution-strip / `js-yaml` JSON_SCHEMA-pin
 * defences. The Provider is pure metadata + classification: no
 * filesystem code, no parsing code, no `walk()` body.
 *
 * **Phase 3 (spec 0.8.0).** The Provider owns the per-kind frontmatter
 * schemas (relocated from spec — `skill`, `agent`, `command`,
 * `markdown`). The flat `defaultRefreshAction` map collapsed into the
 * `kinds` map; each kind entry pairs the loaded JSON Schema with its
 * qualified refresh action id. The kernel's frontmatter-validation
 * flow asks the Provider for the schema instead of reading directly
 * from spec/.
 *
 * **Step 9.5.** The per-kind schemas absorbed Anthropic's documented
 * frontmatter verbatim (https://code.claude.com/docs/en/agents.md and
 * https://code.claude.com/docs/en/skills.md). `agent.schema.json`
 * carries the 14 vendor-specific agent fields; `skill` and `command`
 * extend a shared `skill-base.schema.json` that mirrors Anthropic's
 * merged skill/command frontmatter (Anthropic merged the two in
 * skills.md). The `hook` kind was DROPPED — `.claude/hooks/*.md` is
 * NOT an Anthropic convention; hooks live in `settings.json` or as
 * sub-objects of agent / skill frontmatter (see
 * https://code.claude.com/docs/en/hooks.md). Files under
 * `.claude/hooks/` classify as `markdown` (the format-named generic
 * fallback). Convention: format-named kinds apply only as the generic
 * fallback — a TOML file that IS a Codex agent still classifies as
 * `agent`, not `toml`.
 */

import type { IProvider } from '../../../kernel/extensions/index.js';
import type { NodeKind } from '../../../kernel/types.js';
import skillSchema from './schemas/skill.schema.json' with { type: 'json' };
import skillBaseSchema from './schemas/skill-base.schema.json' with { type: 'json' };
import agentSchema from './schemas/agent.schema.json' with { type: 'json' };
import commandSchema from './schemas/command.schema.json' with { type: 'json' };
import markdownSchema from './schemas/markdown.schema.json' with { type: 'json' };

export const claudeProvider: IProvider = {
  id: 'claude',
  pluginId: 'claude',
  kind: 'provider',
  version: '1.0.0',
  description: 'Walks Claude Code scope conventions (.claude/{agents,commands,skills} + notes).',
  stability: 'stable',

  // The Claude Provider's content lives under `~/.claude` for the global
  // scope (and inside `.claude/` for project scope). `sm doctor` validates
  // the directory exists for global scope; missing → non-blocking warning.
  explorationDir: '~/.claude',

  // Declarative discovery: `.md` files parsed via the kernel's
  // `frontmatter-yaml` built-in. Equals the kernel's default but stated
  // explicitly so the Provider doubles as a copy-paste template for
  // plugin authors.
  read: { extensions: ['.md'], parser: 'frontmatter-yaml' },

  // Per spec § A.6, defaultRefreshAction values MUST be qualified action
  // ids. The summarize-* actions are not yet implemented as registry
  // entries (they ship later under the Claude bundle), but the qualified
  // form is the contract: when those actions land, they will register
  // under `claude/summarize-<kind>` and the Provider resolves them
  // deterministically.
  //
  // Phase 3 (spec 0.8.0): the per-kind catalog lives here. Each entry
  // pairs the relative manifest-style schema path (mirrors what the
  // spec's provider.schema.json validates) with the loaded JSON Schema
  // (`schemaJson`) the kernel registers with AJV at scan boot.
  // Step 14.5.d: each kind declares its UI presentation (label, color,
  // dark variant, icon). The UI consumes this registry via the
  // `kindRegistry` field embedded in REST envelopes; it derives bg/fg
  // tints from `color` per theme via a deterministic helper, so the
  // Provider only declares intent (one base color per theme) instead of
  // four hex values. Colors and SVG paths transplanted verbatim from
  // the previous static UI catalog (`ui/src/styles.css` for hex,
  // `ui/src/app/components/kind-icon/kind-icon.html` for SVG path data,
  // `ui/src/i18n/kinds.texts.ts` for labels).
  kinds: {
    agent: {
      schema: './schemas/agent.schema.json',
      schemaJson: agentSchema,
      defaultRefreshAction: 'claude/summarize-agent',
      ui: {
        label: 'Agents',
        color: '#3b82f6',
        colorDark: '#60a5fa',
        icon: { kind: 'pi', id: 'pi-user' },
      },
    },
    command: {
      schema: './schemas/command.schema.json',
      schemaJson: commandSchema,
      defaultRefreshAction: 'claude/summarize-command',
      ui: {
        label: 'Commands',
        color: '#f59e0b',
        colorDark: '#fbbf24',
        icon: {
          kind: 'svg',
          path: 'M4 17 L10 11 L4 5 M12 19 L20 19',
        },
      },
    },
    skill: {
      schema: './schemas/skill.schema.json',
      schemaJson: skillSchema,
      defaultRefreshAction: 'claude/summarize-skill',
      ui: {
        label: 'Skills',
        color: '#10b981',
        colorDark: '#34d399',
        icon: { kind: 'pi', id: 'pi-bolt' },
      },
    },
    markdown: {
      schema: './schemas/markdown.schema.json',
      schemaJson: markdownSchema,
      defaultRefreshAction: 'claude/summarize-markdown',
      ui: {
        label: 'Markdown',
        color: '#5b908c',
        colorDark: '#9bbcb8',
        icon: {
          kind: 'svg',
          path: 'M14 2 H6 a2 2 0 0 0 -2 2 V20 a2 2 0 0 0 2 2 H18 a2 2 0 0 0 2 -2 V8 L14 2 M14 2 V8 H20 M16 13 H8 M16 17 H8 M10 9 H8',
        },
      },
    },
  },

  // Auxiliary schemas the per-kind schemas $ref by $id. AJV needs them
  // registered via addSchema BEFORE the per-kind schemas compile, so the
  // validator builder pre-registers them. `skill-base.schema.json` is the
  // shared base for `skill` + `command` per Anthropic's documented merger
  // (https://code.claude.com/docs/en/skills.md).
  schemas: [skillBaseSchema],

  classify(path: string): NodeKind {
    const lower = path.toLowerCase();
    if (lower.startsWith('.claude/agents/')) return 'agent';
    if (lower.startsWith('.claude/commands/')) return 'command';
    if (lower.startsWith('.claude/skills/')) return 'skill';
    // Hooks are NOT Anthropic markdown nodes — they live in
    // `settings.json` or as sub-objects of agent / skill frontmatter
    // (https://code.claude.com/docs/en/hooks.md). Files at
    // `.claude/hooks/*.md` are skill-map's old convention from spec 0.7.x;
    // post-Step 9.5 they fall through to `markdown` (the format-named
    // generic fallback).
    return 'markdown';
  },
};
