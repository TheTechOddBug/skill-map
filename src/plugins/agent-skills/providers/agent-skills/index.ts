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
    // The Agent Skills specification REQUIRES `name` to equal the parent
    // directory name, a cross-field rule the frontmatter schema cannot
    // express (see skill.schema.json), so a divergence is a standard
    // violation: `warn`. COMMONS_KINDS is ONE shared object spread into
    // every open-standard adopter (codex, antigravity), so this knob is
    // deliberately shared cross-vendor policy; a vendor needing a
    // different severity must clone the kind, not mutate it here.
    identifierMismatch: 'warn',
  },
};

// Resolution map: an `invokes` link resolves to a `skill` target. NOTE: the
// Agent Skills standard itself does NOT define an invocation syntax, a skill
// activates by its `description` (progressive disclosure) and connects to other
// files via relative markdown links (`[text](path)`). This export exists for
// VENDOR composition: vendors whose runtime invokes skills spread it so their
// invocations resolve to skills. The invocation SIGIL is vendor-specific:
// claude / antigravity emit `invokes` from `/`-slash (the `slash-command`
// extractor precondition), OpenAI Codex from `$` (its own `dollar-skill`
// extractor, since `/` is a Codex built-in command). Under the neutral
// `agent-skills` lens this map is dormant: no extractor emits `invokes` here, so
// only markdown `references` form. Do NOT add `agent-skills` to the slash
// precondition, that would inject a vendor `/` convention into the neutral lens.
export const COMMONS_RESOLUTION: Record<string, string[]> = { invokes: ['skill'] };

/**
 * Shared reserved-name catalog: the universal cross-agent slash commands an
 * agent CLI ships built-in (`help`, `config`, `model`, ...), present in both
 * Claude's and Antigravity's catalogs. Exported for VENDOR composition: a
 * Provider whose runtime invokes skills through the `/` command channel
 * spreads this base (and appends its own runtime verbs) so a user skill that
 * could be `/`-invoked and shadows a built-in is flagged by
 * `core/name-reserved`. Antigravity does exactly this (its skills + workflows
 * are `/`-invoked, plus `goal`, `grill-me`, ...).
 *
 * It is deliberately NOT applied by the neutral `agent-skills` lens, nor by
 * `codex`: the open Agent Skills standard documents no `/`-invocation (a skill
 * activates by its `description`), and Codex invokes skills with `$` in a
 * namespace disjoint from its built-in `/` commands, so a skill named `model`
 * cannot shadow `/model`. Reserving their skill names would flag a collision
 * that cannot happen. Authored lowercase, no leading `/` (the analyzer
 * normalises both sides). Declared under `skill`.
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
  // (Antigravity adopted the open standard) and the shared skill home a
  // Codex project populates under `.agents/skills/`. `fallback: true` makes
  // this candidate yield to any vendor marker present alongside `.agents/`:
  // a `.codex/` + `.agents/` project resolves `codex` outright, never an
  // ambiguous `codex` vs `agent-skills` prompt. The `.agents/` marker only
  // wins when no vendor marker is present. Provider-owned.
  detect: { markers: ['.agents'], fallback: true },

  // Authoring target for `sm tutorial`: the open standard discovers skills
  // under `.agents/skills/<name>/SKILL.md`. `aka` lists Antigravity and
  // OpenCode, which share this territory AND the BASIC tutorial track (skill +
  // markdown, references), so a tester on either scaffolds here. OpenCode is
  // rich-capable (`agent` + `command` kinds) but is deliberately taught on the
  // basic track via the shared open standard. OpenAI Codex
  // also reads `.agents/skills/`, but Codex is a RICH-track lens (it has the
  // `agent` kind, plus `$`-skill invocation and `@`-file references), so
  // advertising it under this basic row
  // would hand it the wrong book; Codex is surfaced once a Codex rich
  // scaffold target lands. `aka` is display-only, `--for` matches the id.
  scaffold: { skillDir: '.agents/skills', aka: ["Google's Antigravity", 'OpenCode'] },

  read: COMMONS_READ,

  kinds: COMMONS_KINDS,

  resolution: COMMONS_RESOLUTION,

  // NO `reservedNames`: the neutral open standard has no `/`-invocation, a
  // skill activates by its `description` and connects via markdown links, so
  // a skill name cannot shadow a built-in `/` command. The shared
  // `COMMONS_RESERVED_NAMES` export above is for `/`-invoking vendors
  // (Antigravity) to spread, NOT applied here. See spec/architecture.md
  // §Provider · reservedNames.

  classify: classifyCommonsPath,
};
