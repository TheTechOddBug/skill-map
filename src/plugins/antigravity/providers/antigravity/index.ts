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

export const antigravityProvider: IProvider = {
  id: 'antigravity',
  pluginId: 'antigravity',
  kind: 'provider',
  version: '1.0.0',
  description:
    'Google Antigravity CLI. Replaces the retired Gemini CLI; skills route through the neutral `agent-skills` Provider via `.agents/skills/`. This Provider contributes lens identity and a reserved-name seed catalog.',

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

  // Seed catalog. Built-in slash commands surfaced by the Antigravity
  // TUI (`/agents`, `/help`, `/quit`, `/skills`, `/hooks`, etc.). The
  // exact list will expand once Google publishes the full reference;
  // start small and document the growth path here rather than over-
  // commit to a catalog that may drift.
  //
  // Inactive today (no nodes are classified under `antigravity`), kept
  // here so the day Antigravity gains an own kind or the analyzer keys
  // on the active lens, the catalog is already in place.
  reservedNames: {
    command: ['agents', 'help', 'quit', 'exit', 'skills', 'hooks'],
  },
};
