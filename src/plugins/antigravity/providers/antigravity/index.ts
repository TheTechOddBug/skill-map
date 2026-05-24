/**
 * Built-in `antigravity` Provider. Google released Antigravity CLI on
 * 2026-05-19 as the replacement for the retired Gemini CLI (Gemini CLI
 * sunsets 2026-06-18 for consumer tiers). Antigravity preserved the
 * four pillars of Gemini CLI (Agent Skills, Hooks, Subagents,
 * Extensions, now called "plugins") but **adopted the open-standard
 * `.agents/` layout** rather than carrying forward a vendor-specific
 * `.gemini/` directory, so the on-disk surface for Antigravity skills
 * is the same one our neutral `agent-skills` Provider already owns
 * (`.agents/skills/<name>/SKILL.md`).
 *
 * This Provider is intentionally **metadata-only** today:
 *
 *   - **No `classify()` territory**: returns `null` for every path, so
 *     it never competes with the `agent-skills` Provider for
 *     `.agents/skills/` paths. An Antigravity user's skills end up
 *     classified as `provider: 'agent-skills', kind: 'skill'` (the
 *     correct lens-neutral outcome under the open standard).
 *
 *   - **No `kinds`**: nothing to declare while Google has not
 *     documented Antigravity-specific layouts beyond the open standard.
 *     When the migration guide formalises subagent / hook paths, this
 *     Provider grows `classify()` + per-kind schemas (and the kinds
 *     map becomes non-empty).
 *
 *   - **`reservedNames` seed catalog**: lists the Antigravity TUI's
 *     built-in slash commands so user files that match get flagged by
 *     the `core/reserved-name` analyzer (and downgraded by the
 *     post-walk confidence lift). The catalog is INACTIVE today
 *     because the analyzer keys on `node.provider`, and no node is
 *     classified under `antigravity`; the seed lives here so when
 *     Antigravity emits its own kind or the analyzer generalises to
 *     key on the active lens, the catalog is already in place.
 *
 * Resources:
 *
 *   - Transition blog: https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/
 *   - Migration guide: https://antigravity.google/docs/gcli-migration
 *   - Agent Skills standard: https://agentskill.sh/antigravity
 *
 * **Lens auto-detect note**: Antigravity has no vendor-specific
 * workspace marker (no `.antigravity/` directory), so the filesystem
 * heuristic in `src/core/config/active-provider.ts` does NOT detect it.
 * Operators select the lens manually via
 * `sm config set activeProvider antigravity`; otherwise a project with
 * `.agents/` and no other vendor markers resolves to a `null` lens
 * (universal extractors keep running).
 */

import type { IProvider } from '../../../../kernel/extensions/index.js';
import { ANTIGRAVITY_PLUGIN_ID } from '../../../ids.js';

export const antigravityProvider: IProvider = {
  id: 'antigravity',
  pluginId: ANTIGRAVITY_PLUGIN_ID,
  kind: 'provider',
  version: '1.0.0',
  description:
    'Declares the Google Antigravity runtime and its reserved built-in names.',

  // Vendor provider: marked gated for the day Antigravity grows its own
  // on-disk kind beyond the open standard. Today `kinds: {}` and
  // `classify` returns `null` for every path, so the flag is inert; the
  // declaration anticipates the migration moment so we don't have to
  // remember to flip it then.
  gatedByActiveLens: true,

  // No `read` config: this Provider does not walk the filesystem. The
  // kernel walker only fires for Providers with `read` or `walk`; an
  // empty Provider participates in registration (its `ui` block is
  // available, its `reservedNames` catalog is loaded) without owning
  // any on-disk territory.
  kinds: {},

  // Always disclaim: paths are owned by other Providers (`.agents/` ->
  // `agent-skills`, `AGENTS.md` -> `core/markdown` fallback).
  classify(): string | null {
    return null;
  },

  // Seed catalog, PROVISIONAL, derived from the Gemini CLI slash-command
  // surface. The Google Developers Blog post that announced the Antigravity
  // CLI rollout on 2026-05-19 states verbatim: "The Antigravity CLI fully
  // replaces the Gemini CLI ... preserves the most critical Gemini CLI
  // features: Agent Skills, Hooks, Subagents, and Extensions (now rebranded
  // as Antigravity plugins) ... shares the same agent harness as Antigravity
  // 2.0, the new Antigravity desktop application." Since the four feature
  // pillars carry over 1:1 and the agent harness is shared, the operator's
  // built-in slash-command vocabulary is overwhelmingly likely to be
  // Gemini CLI's. We mirror the full 38-verb Gemini CLI catalog (plus its
  // four documented aliases: `dir`, `?`, `exit`, `bashes`) so a user file
  // that names a skill / command `help`, `clear`, `mcp`, etc. is flagged
  // immediately by `core/reserved-name` once the lens activates the catalog.
  //
  // The catalog is INACTIVE today: the analyzer keys on `node.provider`
  // and this Provider's `classify()` returns `null` for every path, so
  // no node carries `provider: 'antigravity'`. The seed lives here so
  // the day Antigravity grows its own on-disk kind (e.g. a vendor-specific
  // `.antigravity/commands/` directory beyond the open-standard
  // `.agents/skills/`) the catalog is already in place with no migration.
  //
  // **Reconciliation marker**: the day Google's docs at
  // antigravity.google/docs publishes the authoritative slash-command
  // reference, replace this comment + array with the official list (and
  // bump the file's leading docblock to cite the new source URL).
  reservedNames: {
    command: [
      '?',
      'about',
      'agents',
      'auth',
      'bashes',
      'bug',
      'chat',
      'clear',
      'commands',
      'compress',
      'copy',
      'dir',
      'directory',
      'docs',
      'editor',
      'exit',
      'extensions',
      'help',
      'hooks',
      'ide',
      'init',
      'mcp',
      'memory',
      'model',
      'permissions',
      'plan',
      'policies',
      'privacy',
      'quit',
      'restore',
      'resume',
      'rewind',
      'settings',
      'setup-github',
      'shells',
      'skills',
      'stats',
      'terminal-setup',
      'theme',
      'tools',
      'upgrade',
      'vim',
    ],
  },
};
