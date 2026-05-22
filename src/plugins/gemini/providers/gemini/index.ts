/**
 * Built-in `gemini` Provider. Walks Google's Gemini CLI on-disk
 * conventions:
 *
 *     <root>/.gemini/agents/*.md             → kind: agent
 *     <root>/.gemini/skills/<name>/SKILL.md  → kind: skill
 *
 * Discovery is declarative, `read: { extensions: ['.md'], parser:
 * 'frontmatter-yaml' }` routes through the kernel walker, which owns
 * the symlink / TOCTOU / pollution-strip / `js-yaml` JSON_SCHEMA-pin
 * defences. The Provider is pure metadata + classification.
 *
 * Per-kind frontmatter schemas absorb Google's documented conventions
 * verbatim:
 *   - `agent.schema.json`, 7 vendor-specific fields from
 *     https://geminicli.com/docs/core/subagents/ (`kind`, `tools`,
 *     `mcpServers`, `model`, `temperature`, `max_turns`,
 *     `timeout_mins`). `name` + `description` come from spec base.
 *   - `skill.schema.json`, thin `allOf` extension of base; Google
 *     documents only `name` + `description` (https://geminicli.com/docs/cli/creating-skills/).
 *
 * **spec 0.18.0.** The `markdown` kind moved out of this Provider into
 * the dedicated built-in `core/markdown` Provider, markdown is
 * provider-agnostic. `GEMINI.md` and any other `.md` outside
 * `.gemini/agents/` / `.gemini/skills/` are disclaimed here and
 * picked up by `core/markdown`'s fallback classify.
 *
 * The open-standard path `.agents/skills/<name>/SKILL.md` (jointly
 * adopted by Anthropic, OpenAI, and Google) is NOT reclaimed here, it
 * belongs to the neutral `agent-skills` Provider, so the day Codex
 * lands its own Provider there's no `provider-ambiguous` collision to
 * fix.
 */

import type { IProvider } from '../../../../kernel/extensions/index.js';
import agentSchema from './schemas/agent.schema.json' with { type: 'json' };
import skillSchema from './schemas/skill.schema.json' with { type: 'json' };

export const geminiProvider: IProvider = {
  id: 'gemini',
  pluginId: 'gemini',
  kind: 'provider',
  version: '1.0.0',
  description: 'Walks Gemini CLI scope conventions (.gemini/{agents,skills}).',

  read: { extensions: ['.md'], parser: 'frontmatter-yaml' },

  // Per spec § A.6, defaultRefreshAction values MUST be qualified
  // action ids. The summarize-* actions are not yet implemented as
  // registry entries (they ship later under the Gemini bundle), but
  // the qualified form is the contract.
  //
  // UI presentation: kind visuals are normalised across Providers, every
  // Provider that contributes `agent` declares the same color + icon as
  // Claude, every Provider that contributes `skill` declares the same
  // color + icon as Claude, etc. The declaration STAYS per-Provider (the
  // shape allows divergence the day a Provider wants its own identity for
  // a kind), but today the values mirror Claude so the visual vocabulary
  // is uniform regardless of where a node was sourced from.
  kinds: {
    agent: {
      schema: './schemas/agent.schema.json',
      schemaJson: agentSchema,
      ui: {
        label: 'Agents',
        color: '#3b82f6',
        colorDark: '#60a5fa',
        icon: { kind: 'pi', id: 'pi-user' },
      },
      identifiers: ['frontmatter.name', 'filename-basename'],
    },
    skill: {
      schema: './schemas/skill.schema.json',
      schemaJson: skillSchema,
      ui: {
        label: 'Skills',
        color: '#10b981',
        colorDark: '#34d399',
        icon: { kind: 'pi', id: 'pi-bolt' },
      },
      // Gemini skills live at `.gemini/skills/<name>/SKILL.md`; the
      // dirname is the invocation handle per Google's docs
      // (https://geminicli.com/docs/cli/creating-skills/).
      identifiers: ['frontmatter.name', 'dirname'],
    },
  },

  // Gemini's invocation surfaces mirror Claude's at the kernel level
  // (mentions for agents, slash invokes for skills). Commands are not
  // a Gemini concept; only `skill` belongs to `invokes`.
  resolution: {
    mentions: ['agent'],
    invokes: ['skill'],
  },

  classify(path: string): string | null {
    const lower = path.toLowerCase();
    if (lower.startsWith('.gemini/agents/')) return 'agent';
    // Strict folder-based pattern: `.gemini/skills/<name>/SKILL.md`
    // with exactly one folder level between `skills/` and the file.
    // Mirrors the claude / agent-skills providers: supporting files
    // inside the skill folder are disclaimed so `core/markdown`
    // picks them up; only the skill's entry-point `SKILL.md` is the
    // canonical node.
    if (/^\.gemini\/skills\/[^/]+\/skill\.md$/.test(lower)) return 'skill';
    // Anything else (other `.gemini/*` files, `GEMINI.md`, arbitrary
    // markdown) is disclaimed so `core/markdown` can pick it up via
    // its universal fallback classify. Markdown is provider-agnostic.
    return null;
  },
};
