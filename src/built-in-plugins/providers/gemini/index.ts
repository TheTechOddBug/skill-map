/**
 * Built-in `gemini` Provider. Walks Google's Gemini CLI on-disk
 * conventions:
 *
 *     <root>/.gemini/agents/*.md             → kind: agent
 *     <root>/.gemini/skills/<name>/SKILL.md  → kind: skill
 *     <root>/**.md  (fallback, incl. GEMINI.md) → kind: markdown
 *
 * Discovery is declarative — `read: { extensions: ['.md'], parser:
 * 'frontmatter-yaml' }` routes through the kernel walker, which owns
 * the symlink / TOCTOU / pollution-strip / `js-yaml` JSON_SCHEMA-pin
 * defences. The Provider is pure metadata + classification.
 *
 * Per-kind frontmatter schemas absorb Google's documented conventions
 * verbatim:
 *   - `agent.schema.json` — 7 vendor-specific fields from
 *     https://geminicli.com/docs/core/subagents/ (`kind`, `tools`,
 *     `mcpServers`, `model`, `temperature`, `max_turns`,
 *     `timeout_mins`). `name` + `description` come from spec base.
 *   - `skill.schema.json` — thin `allOf` extension of base; Google
 *     documents only `name` + `description` (https://geminicli.com/docs/cli/creating-skills/).
 *   - `markdown.schema.json` — fallback, base only.
 *
 * The open-standard path `.agents/skills/<name>/SKILL.md` (jointly
 * adopted by Anthropic, OpenAI, and Google) is NOT reclaimed here — it
 * belongs to the neutral `agent-skills` Provider, so the day Codex
 * lands its own Provider there's no `provider-ambiguous` collision to
 * fix.
 */

import type { IProvider } from '../../../kernel/extensions/index.js';
import agentSchema from './schemas/agent.schema.json' with { type: 'json' };
import skillSchema from './schemas/skill.schema.json' with { type: 'json' };
import markdownSchema from './schemas/markdown.schema.json' with { type: 'json' };

export const geminiProvider: IProvider = {
  id: 'gemini',
  pluginId: 'gemini',
  kind: 'provider',
  version: '1.0.0',
  description: 'Walks Gemini CLI scope conventions (.gemini/{agents,skills} + GEMINI.md fallback).',
  stability: 'stable',

  // Gemini CLI's content lives under `~/.gemini` for the global scope
  // (and inside `.gemini/` for project scope). `sm doctor` validates
  // the directory exists for global scope; missing → non-blocking warning.
  explorationDir: '~/.gemini',

  read: { extensions: ['.md'], parser: 'frontmatter-yaml' },

  // Per spec § A.6, defaultRefreshAction values MUST be qualified
  // action ids. The summarize-* actions are not yet implemented as
  // registry entries (they ship later under the Gemini bundle), but
  // the qualified form is the contract.
  //
  // UI presentation: Google brand palette — Gemini purple for agents,
  // Google blue for skills, Claude-equivalent neutral for the markdown
  // fallback (so the fallback reads consistent across vendors). Light
  // / dark variants follow the same hue with a luminosity flip.
  kinds: {
    agent: {
      schema: './schemas/agent.schema.json',
      schemaJson: agentSchema,
      defaultRefreshAction: 'gemini/summarize-agent',
      ui: {
        label: 'Gemini Agents',
        color: '#9b72cb',
        colorDark: '#b794d4',
        icon: { kind: 'pi', id: 'pi-sparkles' },
      },
    },
    skill: {
      schema: './schemas/skill.schema.json',
      schemaJson: skillSchema,
      defaultRefreshAction: 'gemini/summarize-skill',
      ui: {
        label: 'Gemini Skills',
        color: '#4285f4',
        colorDark: '#669df6',
        icon: { kind: 'pi', id: 'pi-bolt' },
      },
    },
    markdown: {
      schema: './schemas/markdown.schema.json',
      schemaJson: markdownSchema,
      defaultRefreshAction: 'gemini/summarize-markdown',
      ui: {
        label: 'Gemini Markdown',
        color: '#5b908c',
        colorDark: '#9bbcb8',
        icon: {
          kind: 'svg',
          path: 'M14 2 H6 a2 2 0 0 0 -2 2 V20 a2 2 0 0 0 2 2 H18 a2 2 0 0 0 2 -2 V8 L14 2 M14 2 V8 H20 M16 13 H8 M16 17 H8 M10 9 H8',
        },
      },
    },
  },

  classify(path: string): string | null {
    const lower = path.toLowerCase();
    if (lower.startsWith('.gemini/agents/')) return 'agent';
    if (lower.startsWith('.gemini/skills/')) return 'skill';
    // Anything else under `.gemini/` (extensions, settings,
    // commands.toml — though the kernel walker only emits `.md` here)
    // catches the markdown fallback. GEMINI.md is the Gemini CLI's
    // project-context file (equivalent to CLAUDE.md).
    if (lower.startsWith('.gemini/')) return 'markdown';
    if (lower === 'gemini.md') return 'markdown';
    return null;
  },
};
