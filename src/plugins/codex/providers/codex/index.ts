/**
 * Built-in `codex` Provider. Phase 6 of the active-lens migration:
 * onboards OpenAI Codex CLI conventions into skill-map.
 *
 * MVP scope (this revision):
 *
 *   - Classifies `.codex/agents/<name>.toml` as `kind: agent`. The TOML
 *     parser (registered in `kernel/scan/parsers/index.ts`) reads the
 *     entire file as structured frontmatter; `body` is empty (Codex
 *     sub-agent definitions are pure TOML, no markdown body).
 *   - Provider-level UI metadata for the `agent` kind so the grafo
 *     renders Codex sub-agents with their own colour / icon.
 *
 * Out of scope for this revision (Phase 6b, future work):
 *
 *   - Hierarchical AGENTS.md walker (Codex's instruction file
 *     cascade: project root → subdir → CWD, with optional
 *     `AGENTS.override.md` shadows per level). Lands together with a
 *     dedicated kernel surface for layered-instruction nodes; today
 *     plain AGENTS.md falls through to the universal `core/markdown`
 *     fallback.
 *   - `.codex/skills/<name>/SKILL.md` walking (Codex skills mirror
 *     the open standard; will land when the cross-provider
 *     skill-folder convention is formalised in the agent-skills
 *     provider).
 *   - `~/.codex/config.toml` / `<cwd>/.codex/config.toml` reading
 *     (Phase 5b MCP config-side discovery).
 *
 * The provider uses declarative `read` (no `walk()` escape hatch) so
 * the kernel's universal walker handles symlink / TOCTOU / sandboxing
 * uniformly with the other built-in providers. Only `.toml` is read
 * here; `AGENTS.md` and other markdown stays the universal markdown
 * fallback's responsibility for now.
 */

import type { IBuiltInManifest, IProvider } from '../../../../kernel/extensions/index.js';
import type { NodeKind } from '../../../../kernel/types.js';
import agentSchema from './schemas/agent.schema.json' with { type: 'json' };
import { OPENAI_PLUGIN_ID } from '../../../ids.js';

export const codexProvider: IBuiltInManifest<IProvider> = {
  id: 'codex',
  pluginId: OPENAI_PLUGIN_ID,
  kind: 'provider',
  description: 'Classifies files under `.codex/agents/*.toml` as OpenAI Codex CLI sub-agents.',

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
  // any project that carries both. A genuine Codex project is identified by
  // `.codex/`. Provider-owned (replaces the old central detection table in
  // `src/core/config/active-provider.ts`).
  detect: { markers: ['.codex'] },

  // Vendor provider: Codex CLI only reads its own `.codex/` territory.
  // Gating the classifier behind the active lens keeps the walker from
  // claiming Codex agents under a `claude` (or any other) lens, where
  // the Codex runtime would never resolve them anyway.
  gatedByActiveLens: true,

  // Beta: ships enabled by default (auto-detects `.codex/`, selectable as
  // the active lens) with a maturity badge, since the Codex body extractor
  // is freshly landed. Promote to `stable` (drop the field) once it has
  // real-world mileage.
  stability: 'beta',

  // The Codex sub-agent's markdown prompt lives in the TOML
  // triple-quoted `developer_instructions` field, not after a frontmatter
  // fence (the whole file is structured frontmatter). This is the field
  // name the Codex CLI itself reads; it rejects an agent role file that
  // omits it, and our agent schema marks it `required` to surface the same
  // gap. `bodyField` tells the kernel walker to feed that string as the
  // node body, so the universal body extractors (markdown-link,
  // backtick-path, external-url) plus the lens-gated at-directive / slash
  // run over the prompt and surface the Codex agent's references in the graph.
  read: { extensions: ['.toml'], parser: 'toml', bodyField: 'developer_instructions' },

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
  },

  // Codex's invocation surface is mention-style today (`@<name>`); slash
  // invocation and skill nodes land in Phase 6b. Empty `invokes` keeps
  // the contract narrow until skills arrive.
  resolution: {
    mentions: ['agent'],
  },

  classify(path: string): NodeKind | null {
    const lower = path.toLowerCase();
    // Strict prefix match. Codex sub-agents live under `.codex/agents/`
    // verbatim; anything else under `.codex/` (e.g. `config.toml`,
    // `hooks.json`) is intentionally disclaimed for now and will be
    // claimed by the future Phase 6b config readers.
    if (lower.startsWith('.codex/agents/') && lower.endsWith('.toml')) return 'agent';
    return null;
  },
};
