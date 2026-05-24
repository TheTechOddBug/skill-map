/**
 * Built-in `agent-skills` Provider, neutral, vendor-agnostic.
 *
 * Reclaims the open-standard path `.agents/skills/<name>/SKILL.md`
 * jointly adopted by Anthropic, OpenAI (Codex), and Google
 * (Antigravity CLI, which retired the Gemini CLI in May 2026 and
 * adopted the open standard rather than carrying forward a vendor-
 * specific `.gemini/` layout). Owning this path with a dedicated
 * Provider keeps the vendor-specific Providers (`claude`, `openai`,
 * `antigravity`) from claiming it themselves, the spec's
 * `provider-ambiguous` rule would otherwise fire when a second
 * vendor lands.
 *
 *     <root>/.agents/skills/<name>/SKILL.md  → kind: skill
 *
 * Discovery is declarative, `read: { extensions: ['.md'], parser:
 * 'frontmatter-yaml' }`. The Provider is pure metadata + classification.
 *
 * Single kind only: `skill`. Per the open-standard contract, only
 * `name` + `description` are required (both come from the spec base).
 *
 * UI: kind visuals are normalised across Providers, every Provider that
 * contributes `skill` declares the same label + color + icon as Claude.
 * The declaration STAYS per-Provider (the shape allows divergence the day
 * a Provider wants its own identity for a kind), but today the values
 * mirror Claude so the visual vocabulary is uniform regardless of where
 * a node was sourced from.
 */

import type { IProvider } from '../../../../kernel/extensions/index.js';
import skillSchema from './schemas/skill.schema.json' with { type: 'json' };
import { AGENT_SKILLS_PLUGIN_ID } from '../../../ids.js';

export const agentSkillsProvider: IProvider = {
  id: 'agent-skills',
  pluginId: AGENT_SKILLS_PLUGIN_ID,
  kind: 'provider',
  version: '1.0.0',
  description: 'Classifies files under `.agents/skills/<name>/SKILL.md` as Agent Skills.',

  read: { extensions: ['.md'], parser: 'frontmatter-yaml' },

  kinds: {
    skill: {
      schema: './schemas/skill.schema.json',
      schemaJson: skillSchema,
      ui: {
        label: 'Skills',
        color: '#10b981',
        colorDark: '#34d399',
        icon: { kind: 'pi', id: 'pi-bolt' },
      },
      // Open-standard skills mirror Anthropic's: dirname between
      // `.agents/skills/` and `/SKILL.md` is the canonical handle,
      // `frontmatter.name` overrides when present.
      identifiers: ['frontmatter.name', 'dirname'],
    },
  },

  // The open standard documents slash-style invocation of skills; no
  // mention surface (no agents in this Provider's territory).
  resolution: {
    invokes: ['skill'],
  },

  classify(path: string): string | null {
    // Strict folder-based pattern: `.agents/skills/<name>/SKILL.md` with
    // exactly one folder level between `skills/` and the file. Supporting
    // files inside the skill folder (README.md, references/, helpers,
    // etc.) are disclaimed so `core/markdown` picks them up; only the
    // skill's entry-point `SKILL.md` is the canonical node, mirroring
    // the open-standard contract.
    if (/^\.agents\/skills\/[^/]+\/skill\.md$/.test(path.toLowerCase())) return 'skill';
    // Outside the open-standard path, disclaim so vendor-specific
    // Providers (`claude`, `openai`, `antigravity`) can claim the
    // file on their own walk passes.
    return null;
  },
};
