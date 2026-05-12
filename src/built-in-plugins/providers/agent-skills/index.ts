/**
 * Built-in `agent-skills` Provider — neutral, vendor-agnostic.
 *
 * Reclaims the open-standard path `.agents/skills/<name>/SKILL.md`
 * jointly adopted by Anthropic, OpenAI (Codex), and Google (Gemini).
 * Owning this path with a dedicated Provider keeps the vendor-specific
 * Providers (`claude`, `gemini`, future `codex`) from claiming it
 * themselves — the spec's `provider-ambiguous` rule would otherwise
 * fire the day a second vendor lands.
 *
 *     <root>/.agents/skills/<name>/SKILL.md  → kind: skill
 *
 * Discovery is declarative — `read: { extensions: ['.md'], parser:
 * 'frontmatter-yaml' }`. The Provider is pure metadata + classification.
 *
 * Single kind only: `skill`. Per the open-standard contract, only
 * `name` + `description` are required (both come from the spec base).
 *
 * UI: kind visuals are normalised across Providers — every Provider that
 * contributes `skill` declares the same label + color + icon as Claude.
 * The declaration STAYS per-Provider (the shape allows divergence the day
 * a Provider wants its own identity for a kind), but today the values
 * mirror Claude so the visual vocabulary is uniform regardless of where
 * a node was sourced from.
 */

import type { IProvider } from '../../../kernel/extensions/index.js';
import skillSchema from './schemas/skill.schema.json' with { type: 'json' };

export const agentSkillsProvider: IProvider = {
  id: 'agent-skills',
  pluginId: 'agent-skills',
  kind: 'provider',
  version: '1.0.0',
  description: 'Agent Skills open standard. Vendor-neutral path `.agents/skills/<name>/SKILL.md` (Anthropic, OpenAI, Google). See agentskills.io.',
  stability: 'stable',

  read: { extensions: ['.md'], parser: 'frontmatter-yaml' },

  kinds: {
    skill: {
      schema: './schemas/skill.schema.json',
      schemaJson: skillSchema,
      defaultRefreshAction: 'agent-skills/summarize-skill',
      ui: {
        label: 'Skills',
        color: '#10b981',
        colorDark: '#34d399',
        icon: { kind: 'pi', id: 'pi-bolt' },
      },
    },
  },

  classify(path: string): string | null {
    if (path.toLowerCase().startsWith('.agents/skills/')) return 'skill';
    // Outside the open-standard path — disclaim so vendor-specific
    // Providers (`claude`, `gemini`, future `codex`) can claim the
    // file on their own walk passes.
    return null;
  },
};
