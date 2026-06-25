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
 * This Provider **adopts the open-standard `.agents/skills/` layout** by
 * reusing the `agent-skills` classifier + kind + read config (manifest
 * composition, not a kernel feature):
 *
 *   - **Inherited classification**: under the `antigravity` lens the
 *     walker classifies `.agents/skills/<name>/SKILL.md` as
 *     `provider: 'antigravity', kind: 'skill'`. The `agent-skills`
 *     Provider is gated to its own lens, so it never competes here (under
 *     the antigravity lens it does not participate).
 *
 *   - **`reservedNames` catalog (under `skill`)**: lists `agy`'s built-in
 *     slash commands so a user skill that shadows one gets flagged by the
 *     `core/name-reserved` analyzer (and downgraded by the post-walk
 *     confidence lift). It is declared under the `skill` kind, not
 *     `command`, because Antigravity delivers user slash-commands AS
 *     skills (`.agents/skills/<name>/SKILL.md`). Because the antigravity
 *     lens now classifies those skills itself, the catalog applies via
 *     SELF scope, no cross-provider lens-scope rule is needed.
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
 * declares no `detect` block and is never auto-suggested. Both
 * `antigravity` and `agent-skills` ship `experimental` (disabled by
 * default), so a `.agents/` project does not auto-detect either; the
 * operator enables and selects the lens via `sm plugins enable` +
 * `sm config set activeProvider antigravity`.
 */

import type { IBuiltInManifest, IProvider } from '../../../../kernel/extensions/index.js';
import { ANTIGRAVITY_PLUGIN_ID } from '../../../ids.js';
import {
  COMMONS_READ,
  COMMONS_KINDS,
  COMMONS_RESOLUTION,
  COMMONS_RESERVED_NAMES,
  classifyCommonsPath,
} from '../../../agent-skills/providers/agent-skills/index.js';

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
    label: "Google's Antigravity",
    color: '#7c3aed',
    colorDark: '#a78bfa',
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

  // Not yet ready for end users: ships disabled by default (the operator
  // opts in via `sm plugins enable` / Settings / the tutorial's
  // `--experimental` flow). Replaces the retired `comingSoon` flag.
  stability: 'experimental',

  // Adopt the open-standard `.agents/skills/` layout by REUSING the
  // `agent-skills` classifier + kind + read config (composition at the
  // manifest level, not a kernel rule). Under the antigravity lens the
  // walker classifies `.agents/skills/<name>/SKILL.md` as
  // `{ provider: 'antigravity', kind: 'skill' }`, so the reservedNames
  // below apply via SELF scope. `agent-skills` itself is gated to its own
  // lens, so it never competes here (under the antigravity lens it does
  // not participate). This is why there is no cross-provider lens-scope
  // rule in the kernel any more.
  read: COMMONS_READ,
  kinds: COMMONS_KINDS,
  resolution: COMMONS_RESOLUTION,
  classify: classifyCommonsPath,

  // Built-in slash-command catalog, captured verbatim from `agy /help`
  // (Antigravity CLI v1.0.3). The universal cross-agent verbs (`help`,
  // `config`, `mcp`, `model`, `clear`, `exit`, ...) come from the
  // open-standard base catalog (`COMMONS_RESERVED_NAMES`, owned by
  // `agent-skills` and inherited here by composition); this block adds ONLY
  // Antigravity's OWN runtime-specific verbs on top, so the neutral
  // standard never carries `agy`-specific commands. The earlier provisional
  // list mirrored Gemini CLI; `agy` dropped Gemini-only verbs (`vim`,
  // `theme`, `terminal-setup`, `setup-github`, `bashes`, `shells`,
  // `policies`, `extensions`, `?`, `dir`, ...) and added agent-first ones.
  // Both the primary verbs and the 8 documented aliases (`new`, `settings`,
  // `quit`, `branch`, `switch`, `conversation`, `undo`, `quota`) are
  // reserved: a user skill named after either is silently shadowed by the
  // built-in once the catalog activates.
  //
  // Declared under the `skill` kind (NOT `command`): Antigravity has no
  // vendor-specific command directory, its user slash-commands are skills
  // (`.agents/skills/<name>/SKILL.md`). Because the antigravity lens now
  // classifies those files itself (inherited classifier above), a user
  // `.agents/skills/goal/SKILL.md` is flagged by SELF scope because `/goal`
  // is built-in.
  //
  // **Reconciliation marker**: re-capture from `agy /help` on each major
  // Antigravity CLI release, bump the cited version above, and move any
  // verb that becomes universal across agents down into
  // `COMMONS_RESERVED_NAMES`.
  reservedNames: {
    skill: [
      // Inherited open-standard base (universal cross-agent slash commands).
      ...(COMMONS_RESERVED_NAMES['skill'] ?? []),
      // Antigravity-specific verbs (not part of the open-standard base).
      'artifact',
      'branch',
      'btw',
      'changelog',
      'context',
      'conversation',
      'copy',
      'credits',
      'diff',
      'fast',
      'fork',
      'goal',
      'grill-me',
      'keybindings',
      'new',
      'open',
      'planning',
      'quota',
      'rename',
      'rewind',
      'schedule',
      'settings',
      'skills',
      'switch',
      'tasks',
      'title',
      'undo',
    ],
  },
};
