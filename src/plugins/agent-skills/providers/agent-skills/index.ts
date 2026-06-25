/**
 * Built-in `agent-skills` Provider, neutral, vendor-agnostic.
 *
 * Reclaims the open-standard path `.agents/skills/<name>/SKILL.md`
 * jointly adopted by Anthropic, OpenAI (Codex), and Google
 * (Antigravity CLI, which retired the Gemini CLI in May 2026 and
 * adopted the open standard rather than carrying forward a vendor-
 * specific `.gemini/` layout). Owning this path with a dedicated
 * Provider keeps the vendor-specific Providers (`claude`, `codex`,
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

import type {
  IBuiltInManifest,
  IProvider,
  IProviderKind,
  IProviderReadConfig,
} from '../../../../kernel/extensions/index.js';
import skillSchema from './schemas/skill.schema.json' with { type: 'json' };
import { AGENT_SKILLS_PLUGIN_ID } from '../../../ids.js';

/**
 * Reusable open-standard pieces. A vendor Provider that adopts the
 * `.agents/skills/` layout (e.g. `antigravity`) imports these and composes
 * them into its OWN manifest, so under that vendor's lens the skills are
 * classified with its provider id and its `reservedNames` apply via self
 * scope, no cross-provider kernel rule needed.
 */
export const COMMONS_READ: IProviderReadConfig = {
  extensions: ['.md'],
  parser: 'frontmatter-yaml',
};

export const COMMONS_KINDS: Record<string, IProviderKind> = {
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
};

// The open standard documents slash-style invocation of skills.
export const COMMONS_RESOLUTION: Record<string, string[]> = { invokes: ['skill'] };

/**
 * Base reserved-name catalog for the open standard, owned here and
 * inherited by every Provider that adopts the `.agents/skills/` layout
 * (manifest composition, same pattern as the `COMMONS_*` pieces above,
 * not a kernel rule). These are the slash commands an agent CLI ships
 * built-in regardless of vendor (the cross-vendor common subset, present
 * in both Claude's and Antigravity's catalogs), so a user skill that
 * shadows one is flagged by `core/name-reserved` under ANY lens that uses
 * the open standard, including the neutral `agent-skills` lens itself. Vendor
 * Providers spread this and append their OWN runtime-specific verbs (e.g.
 * Antigravity adds `goal`, `grill-me`, ...); the neutral standard never
 * carries vendor verbs. Authored lowercase, no leading `/` (the analyzer
 * normalises both sides). Declared under `skill`, the only open-standard
 * kind.
 */
export const COMMONS_RESERVED_NAMES: Record<string, readonly string[]> = {
  skill: [
    'add-dir',
    'agents',
    'clear',
    'config',
    'exit',
    'feedback',
    'help',
    'hooks',
    'logout',
    'mcp',
    'model',
    'permissions',
    'quit',
    'resume',
    'statusline',
    'usage',
  ],
};

/**
 * Strict folder-based classifier for the open standard:
 * `.agents/skills/<name>/SKILL.md` with exactly one folder level between
 * `skills/` and the file. Supporting files (README.md, references/,
 * helpers) are disclaimed so `core/markdown` picks them up; only the
 * entry-point `SKILL.md` is the canonical node, mirroring the open-standard
 * contract.
 */
export function classifyCommonsPath(path: string): string | null {
  if (/^\.agents\/skills\/[^/]+\/skill\.md$/.test(path.toLowerCase())) return 'skill';
  return null;
}

export const agentSkillsProvider: IBuiltInManifest<IProvider> = {
  id: 'agent-skills',
  pluginId: AGENT_SKILLS_PLUGIN_ID,
  kind: 'provider',
  description: 'Classifies files under `.agents/skills/<name>/SKILL.md` as Agent Skills.',

  // Provider identity for the active-lens dropdown, the topbar lens chip,
  // and the per-node provider chip. Neutral slate (this is the
  // vendor-agnostic open-standard Provider, not a brand). The reusable
  // open-standard pieces it owns use a `COMMONS_*` vocabulary internally;
  // the user-facing label is the descriptive "Standard: Agent skills" (the
  // `Standard:` prefix marks it as the vendor-neutral lens, distinct from
  // the possessive `<Vendor>'s <product>` form the brand lenses use). This
  // is the single open lens shown in the selector when no vendor is active; the
  // non-gated `core/markdown` base sits underneath it and is never offered
  // as a lens of its own.
  presentation: {
    label: 'Standard: Agent skills',
    color: '#64748b',
    colorDark: '#94a3b8',
  },

  // Gated like the vendor providers: `.agents/skills/*` is classified as
  // `skill` ONLY under the `agent-skills` lens; under any other lens
  // (including `markdown`) it falls through to `core/markdown`, the sole
  // universal provider. Keeps the "one active lens" model honest.
  gatedByActiveLens: true,

  // The open-standard lens is the universal default: stable and locked
  // enabled (`agent-skills/agent-skills` in the host lock-list), so it is
  // the lens a project falls back to when no vendor marker is present, and
  // it cannot be disabled out from under that role. Auto-detects `.agents/`
  // and classifies skills under its own lens.
  stability: 'stable',

  // Auto-detect marker: a `.agents/` directory marks an open-standard
  // project. This is also the marker a Google/Antigravity project carries
  // (Antigravity adopted the open standard). The marker only produces an
  // auto-detect candidate once this experimental provider is enabled.
  // Provider-owned.
  detect: { markers: ['.agents'] },

  // Authoring target for `sm tutorial`: the open standard discovers skills
  // under `.agents/skills/<name>/SKILL.md`. The same path is consumed by
  // Antigravity (adopted the standard rather than a `.gemini/` layout) and
  // OpenAI Codex (skills mirror the open standard), so `aka` surfaces both
  // names in the destination prompt to orient testers on those agents.
  // `aka` is display-only, `--for` still matches the `agent-skills` id.
  scaffold: { skillDir: '.agents/skills', aka: ["Google's Antigravity", "OpenAI's Codex"] },

  read: COMMONS_READ,

  kinds: COMMONS_KINDS,

  resolution: COMMONS_RESOLUTION,

  // Base reserved-name catalog (self-scope under the `agent-skills` lens). The
  // shared export is inherited by every Provider that adopts the open
  // standard (see `COMMONS_RESERVED_NAMES` above).
  reservedNames: COMMONS_RESERVED_NAMES,

  classify: classifyCommonsPath,
};
