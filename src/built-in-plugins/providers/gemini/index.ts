/**
 * Built-in `gemini` Provider. Walks Google's Gemini CLI on-disk
 * conventions:
 *
 *     <root>/.gemini/agents/*.md             → kind: agent
 *     <root>/.gemini/skills/<name>/SKILL.md  → kind: skill
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
 *
 * **spec 0.18.0.** The `markdown` kind moved out of this Provider into
 * the dedicated built-in `core/markdown` Provider — markdown is
 * provider-agnostic. `GEMINI.md` and any other `.md` outside
 * `.gemini/agents/` / `.gemini/skills/` are disclaimed here and
 * picked up by `core/markdown`'s fallback classify.
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

export const geminiProvider: IProvider = {
  id: 'gemini',
  pluginId: 'gemini',
  kind: 'provider',
  version: '1.0.0',
  description: 'Walks Gemini CLI scope conventions (.gemini/{agents,skills}).',
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
  },

  classify(path: string): string | null {
    const lower = path.toLowerCase();
    if (lower.startsWith('.gemini/agents/')) return 'agent';
    if (lower.startsWith('.gemini/skills/')) return 'skill';
    // Anything else (other `.gemini/*` files, `GEMINI.md`, arbitrary
    // markdown) is disclaimed so `core/markdown` can pick it up via
    // its universal fallback classify. Markdown is provider-agnostic.
    return null;
  },
};
