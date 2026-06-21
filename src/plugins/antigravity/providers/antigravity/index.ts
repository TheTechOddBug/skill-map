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
 *   - **`reservedNames` catalog (under `skill`)**: lists `agy`'s built-in
 *     slash commands so a user skill that shadows one gets flagged by the
 *     `core/name-reserved` analyzer (and downgraded by the post-walk
 *     confidence lift). It is declared under the `skill` kind, not
 *     `command`, because Antigravity delivers user slash-commands AS
 *     skills (`.agents/skills/<name>/SKILL.md`), so the invocable a
 *     reserved name shadows is a skill file. The catalog is ACTIVE under
 *     the **lens scope** added in spec/architecture.md §Provider ·
 *     reservedNames: even though this Provider classifies nothing (the
 *     skills are owned by the universal `agent-skills` Provider), when
 *     `activeProvider === 'antigravity'` the orchestrator lends this
 *     catalog to those `agent-skills` skill nodes, matched by kind.
 *
 * Resources:
 *
 *   - Transition blog: https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/
 *   - Migration guide: https://antigravity.google/docs/gcli-migration
 *   - CLI command reference: https://antigravity.google/docs/cli-using
 *   - Agent Skills standard: https://agentskills.io/specification
 *
 * **Lens auto-detect note**: Antigravity has no vendor-specific
 * workspace marker (no `.antigravity/` directory), so its manifest
 * declares no `detect` block and the provider-owned lens heuristic never
 * auto-suggests it. Operators select the lens manually via
 * `sm config set activeProvider antigravity`; otherwise a project with
 * `.agents/` auto-detects as the universal `agent-skills` lens (which
 * owns that marker) and Antigravity's universal extractors keep running.
 */

import type { IBuiltInManifest, IProvider } from '../../../../kernel/extensions/index.js';
import { ANTIGRAVITY_PLUGIN_ID } from '../../../ids.js';

export const antigravityProvider: IBuiltInManifest<IProvider> = {
  id: 'antigravity',
  pluginId: ANTIGRAVITY_PLUGIN_ID,
  kind: 'provider',
  description:
    'Declares the Google Antigravity runtime and its reserved built-in names.',

  // Provider identity for the active-lens dropdown, the topbar lens chip,
  // and the per-node provider chip. Antigravity violet, distinct from the
  // other vendor palettes.
  presentation: {
    label: 'Antigravity',
    color: '#7c3aed',
    colorDark: '#a78bfa',
    // Registered but not yet selectable as the active lens; the UI greys
    // it with a `(coming soon)` suffix.
    comingSoon: true,
  },

  // No `detect` block: Antigravity has no vendor-specific workspace marker
  // (it adopted the open-standard `.agents/`, owned by `agent-skills`), so
  // it is never auto-suggested. The lens is set manually via
  // `sm config set activeProvider antigravity`.

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

  // Built-in slash-command catalog, captured verbatim from `agy /help`
  // (Antigravity CLI v1.0.3). This REPLACES the earlier provisional list
  // that mirrored Gemini CLI's verbs: `agy` ships its own surface. It
  // DROPPED Gemini-only verbs (`vim`, `theme`, `terminal-setup`,
  // `setup-github`, `bashes`, `shells`, `policies`, `extensions`, `about`,
  // `auth`, `bug`, `chat`, `compress`, `docs`, `editor`, `ide`, `init`,
  // `memory`, `restore`, `stats`, `tools`, `upgrade`, `?`, `dir`) and
  // ADDED agent-first ones (`goal`, `grill-me`, `schedule`, `fast`, `btw`,
  // `artifact`, `context`, `diff`, `fork`, `tasks`, `add-dir`, `credits`,
  // `feedback`, `logout`, `open`, `planning`, `rename`, `statusline`,
  // `title`, `usage`). Both the 35 primary verbs and the 8 documented
  // aliases (`new`, `settings`, `quit`, `branch`, `switch`, `conversation`,
  // `undo`, `quota`) are reserved: a user skill named after either is
  // silently shadowed by the built-in once the catalog activates.
  //
  // Declared under the `skill` kind (NOT `command`): Antigravity has no
  // vendor-specific command directory, its user slash-commands are skills
  // (`.agents/skills/<name>/SKILL.md`, owned by the universal `agent-skills`
  // Provider). The catalog is ACTIVE via the LENS SCOPE in
  // `buildReservedNodePaths` (spec/architecture.md §Provider ·
  // reservedNames): when `activeProvider === 'antigravity'` the orchestrator
  // lends this `skill` catalog to `agent-skills` skill nodes, so a user
  // `.agents/skills/goal/SKILL.md` is flagged because `/goal` is built-in.
  //
  // **Reconciliation marker**: re-capture from `agy /help` on each major
  // Antigravity CLI release and bump the cited version above.
  reservedNames: {
    skill: [
      'add-dir',
      'agents',
      'artifact',
      'branch',
      'btw',
      'changelog',
      'clear',
      'config',
      'context',
      'conversation',
      'copy',
      'credits',
      'diff',
      'exit',
      'fast',
      'feedback',
      'fork',
      'goal',
      'grill-me',
      'help',
      'hooks',
      'keybindings',
      'logout',
      'mcp',
      'model',
      'new',
      'open',
      'permissions',
      'planning',
      'quit',
      'quota',
      'rename',
      'resume',
      'rewind',
      'schedule',
      'settings',
      'skills',
      'statusline',
      'switch',
      'tasks',
      'title',
      'undo',
      'usage',
    ],
  },
};
