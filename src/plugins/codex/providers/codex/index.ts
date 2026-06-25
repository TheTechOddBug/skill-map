/**
 * Built-in `codex` Provider. Onboards OpenAI Codex CLI conventions into
 * skill-map under the `codex` active lens.
 *
 * Two on-disk families, read declaratively via a multi-rule `read` (one
 * `walkContent` pass per rule, no `walk()` escape hatch):
 *
 *   - `.codex/agents/<name>.toml` → `kind: agent`. The whole file is
 *     structured TOML frontmatter (`parser: 'toml'`); the markdown prompt
 *     lives in the triple-quoted `developer_instructions` field, surfaced
 *     as the node body via `read.bodyField` so the universal body
 *     extractors (markdown-link, backtick-path, external-url) plus the
 *     lens-gated `@`-directive / `/`-command run over it.
 *   - `.agents/skills/<name>/SKILL.md` → `kind: skill`. Codex adopted the
 *     OPEN `.agents/skills/` standard for skills (per
 *     https://developers.openai.com/codex/skills Codex scans
 *     `.agents/skills` from the CWD up to the repo root), the same on-disk
 *     home the neutral `agent-skills` Provider owns. We reuse its
 *     open-standard pieces (`COMMONS_READ` / `COMMONS_KINDS` /
 *     `COMMONS_RESOLUTION` / `COMMONS_RESERVED_NAMES` /
 *     `classifyCommonsPath`) by manifest composition, so under the `codex`
 *     lens those skills classify as `{ provider: 'codex', kind: 'skill' }`
 *     and the reserved-name catalog applies via SELF scope. `agent-skills`
 *     is itself gated to its own lens, so it never competes here. This is
 *     the same composition pattern `antigravity` uses; codex differs only
 *     in ALSO carrying the TOML agent rule (hence the multi-rule `read`).
 *     NOTE: this is the open `.agents/skills/`, NOT a proprietary
 *     `.codex/skills/` (Codex's official docs document only the open
 *     layout).
 *
 * Codex's proprietary `.codex/` territory beyond `.codex/agents/` (e.g.
 * `config.toml`, `hooks.json`) stays disclaimed for now; the hierarchical
 * AGENTS.md walker is the remaining deferred piece (the other half of the
 * former Phase 6b). Today plain AGENTS.md falls through to the universal
 * `core/markdown` fallback.
 */

import type { IBuiltInManifest, IProvider } from '../../../../kernel/extensions/index.js';
import agentSchema from './schemas/agent.schema.json' with { type: 'json' };
import { OPENAI_PLUGIN_ID } from '../../../ids.js';
import {
  COMMONS_READ,
  COMMONS_KINDS,
  COMMONS_RESOLUTION,
  COMMONS_RESERVED_NAMES,
  classifyCommonsPath,
} from '../../../agent-skills/providers/agent-skills/index.js';

export const codexProvider: IBuiltInManifest<IProvider> = {
  id: 'codex',
  pluginId: OPENAI_PLUGIN_ID,
  kind: 'provider',
  description:
    'Classifies `.codex/agents/*.toml` as OpenAI Codex CLI sub-agents and `.agents/skills/*/SKILL.md` as Codex skills (open standard).',

  // Provider identity for the active-lens dropdown, the topbar lens chip,
  // and the per-node provider chip. Codex green, distinct from the Claude
  // palette so the chip reads at a glance.
  presentation: {
    label: "OpenAI's Codex",
    color: '#22c55e',
    colorDark: '#4ade80',
  },

  // Auto-detect marker: a `.codex/` directory marks a Codex CLI project.
  // `AGENTS.md` is intentionally NOT a marker: it is the open agents.md
  // standard (present in many non-Codex repos, and commonly alongside a
  // `.claude/` directory), so keying auto-detect off it would mis-route a
  // plain-markdown repo to the Codex lens and force an ambiguous prompt on
  // any project that carries both. `.agents/` is likewise NOT a marker: it
  // is the vendor-neutral open standard (owned by `agent-skills` for
  // auto-detect), so a project that only carries `.agents/skills/` is an
  // open-standard project, not necessarily a Codex one. A genuine Codex
  // project is identified by `.codex/`.
  detect: { markers: ['.codex'] },

  // Vendor provider: Codex CLI only reads its own territory (its `.codex/`
  // agents plus the open `.agents/skills/` skills it adopted). Gating the
  // classifier behind the active lens keeps the walker from claiming Codex
  // agents under a `claude` (or any other) lens, where the Codex runtime
  // would never resolve them anyway.
  gatedByActiveLens: true,

  // Beta: ships enabled by default (auto-detects `.codex/`, selectable as
  // the active lens) with a maturity badge, since the Codex body extractor
  // is freshly landed. Promote to `stable` (drop the field) once it has
  // real-world mileage.
  stability: 'beta',

  // Multi-rule read: `.toml` sub-agents and `.md` open-standard skills,
  // each with its own parser. `resolveProviderWalk` runs one walk pass per
  // rule; the extensions are disjoint.
  //   1. Codex sub-agents are pure TOML (`parser: 'toml'`); the markdown
  //      prompt is the triple-quoted `developer_instructions` field, fed
  //      to the body pipeline via `bodyField` so the universal body
  //      extractors plus the lens-gated at-directive / slash run over it.
  //   2. Skills reuse the open-standard `agent-skills` read config
  //      (`COMMONS_READ`: `.md` + `frontmatter-yaml`).
  read: [
    { extensions: ['.toml'], parser: 'toml', bodyField: 'developer_instructions' },
    COMMONS_READ,
  ],

  kinds: {
    agent: {
      schema: './schemas/agent.schema.json',
      schemaJson: agentSchema,
      ui: {
        label: 'Codex agents',
        // Codex green; distinct from the claude palette.
        color: '#22c55e',
        colorDark: '#4ade80',
        icon: { kind: 'pi', id: 'pi-bolt' },
      },
      // Codex sub-agents are referenced by file basename
      // (`.codex/agents/<name>.toml`). `frontmatter.name` lives inside
      // the TOML structured frontmatter when the author declared it
      // explicitly.
      identifiers: ['frontmatter.name', 'filename-basename'],
    },
    // Open-standard `skill` kind, inherited from `agent-skills` by manifest
    // composition (same schema + UI every standard adopter shares).
    // `.agents/skills/<name>/SKILL.md` resolves by dirname or
    // `frontmatter.name`.
    ...COMMONS_KINDS,
  },

  // Mentions resolve to agents (`@<name>`, the Codex sub-agent handle).
  // Slash invocations resolve to skills (`invokes: ['skill']`, inherited
  // from the open standard), so a `/skill-name` in an agent's prompt links
  // to its `.agents/skills/` skill.
  resolution: {
    mentions: ['agent'],
    ...COMMONS_RESOLUTION,
  },

  // Open-standard reserved-name base (the universal cross-agent slash
  // verbs an agent CLI ships built-in), inherited from `agent-skills` and
  // applied under the codex lens via SELF scope: a user skill that shadows
  // one is flagged by `core/name-reserved`.
  reservedNames: COMMONS_RESERVED_NAMES,

  classify(path: string): string | null {
    const lower = path.toLowerCase();
    // Strict prefix match. Codex sub-agents live under `.codex/agents/`
    // verbatim; anything else under `.codex/` (e.g. `config.toml`,
    // `hooks.json`) is intentionally disclaimed for now and will be
    // claimed by the future AGENTS.md / config readers.
    if (lower.startsWith('.codex/agents/') && lower.endsWith('.toml')) return 'agent';
    // Open-standard skills: `.agents/skills/<name>/SKILL.md` (one folder
    // level), reusing the shared classifier. Everything else → `null`.
    return classifyCommonsPath(path);
  },
};
