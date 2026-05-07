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
 * UI: deliberately neutral grey so the kind reads as "vendor-agnostic"
 * — when several Providers contribute to the `skill` kind name the
 * shared CSS var picks the first registered Provider's color (Claude
 * blue today). This Provider's own color shows up only when a node
 * was classified BY this Provider (e.g. nodes at `.agents/skills/`).
 */

import type { IProvider } from '../../../kernel/extensions/index.js';
import skillSchema from './schemas/skill.schema.json' with { type: 'json' };

export const agentSkillsProvider: IProvider = {
  id: 'agent-skills',
  pluginId: 'agent-skills',
  kind: 'provider',
  version: '1.0.0',
  description: 'Walks the open-standard `.agents/skills/<name>/SKILL.md` convention (Anthropic / OpenAI / Google).',
  stability: 'stable',

  // The open-standard path is project-relative; there's no global
  // home directory the way Claude/Gemini own `~/.claude` / `~/.gemini`.
  // Set to the project-relative root so `sm doctor` can still report
  // where the Provider looks. The user-home alias `~/.agents/skills/`
  // (per Codex docs) would be a future extension.
  explorationDir: '.agents',

  read: { extensions: ['.md'], parser: 'frontmatter-yaml' },

  kinds: {
    skill: {
      schema: './schemas/skill.schema.json',
      schemaJson: skillSchema,
      defaultRefreshAction: 'agent-skills/summarize-skill',
      ui: {
        label: 'Agent Skills',
        // Neutral slate — distinct from Claude green and Gemini blue
        // so a node painted with this Provider's color reads as
        // "vendor-agnostic open-standard" at a glance.
        color: '#64748b',
        colorDark: '#94a3b8',
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
