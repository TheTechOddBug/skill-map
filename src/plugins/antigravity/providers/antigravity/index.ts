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
 * This Provider has TWO on-disk families:
 *
 *   - **Skills** (`.agents/skills/<name>/SKILL.md`): it **adopts the
 *     open-standard layout** by reusing the `agent-skills` classifier +
 *     kind + read config (manifest composition, not a kernel feature).
 *   - **Workflows** (`.agent/workflows/<name>.md`, SINGULAR `.agent`): its
 *     OWN kind. A workflow is YAML frontmatter (`description`) + a numbered
 *     list of markdown steps, invoked as the slash command `/<name>` (the
 *     filename stem is the handle). This is the Antigravity analogue of
 *     Codex's `.codex/agents/*.toml` own-kind: proprietary territory the
 *     open standard does not cover. (Antigravity subagents, by contrast,
 *     are instantiated dynamically at runtime with NO on-disk definition
 *     file, so there is no `agent` kind to classify.)
 *
 * Skills, in detail, reuse the open standard (manifest composition):
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
 * **Lens auto-detect note**: Antigravity's workflows live under its own
 * `.agent/workflows/` directory, declared below as a `detect` marker. Now
 * that `antigravity` ships `beta` (enabled by default), that marker is LIVE:
 * a project carrying `.agent/workflows/` auto-detects the antigravity lens
 * (`installedDefaultEnabled('beta')` is true, so it participates in
 * `detectProvidersFromFilesystem`). A project that ALSO carries `.agents/`
 * surfaces an ambiguous prompt (antigravity vs the `agent-skills` open
 * default); a project with no vendor marker still falls back to the `stable`
 * `agent-skills` lens. Skills under the shared `.agents/` are owned by
 * `agent-skills` for auto-detect, not by antigravity.
 */

import type { IBuiltInManifest, IProvider } from '../../../../kernel/extensions/index.js';
import workflowSchema from './schemas/workflow.schema.json' with { type: 'json' };
import { ANTIGRAVITY_PLUGIN_ID } from '../../../ids.js';
import {
  COMMONS_READ,
  COMMONS_KINDS,
  COMMONS_RESERVED_NAMES,
  classifyCommonsPath,
} from '../../../agent-skills/providers/agent-skills/index.js';

/**
 * Antigravity's built-in slash-command catalog, captured verbatim from
 * `agy /help` (Antigravity CLI v1.0.3): the open-standard base (universal
 * cross-agent verbs, owned by `agent-skills` and inherited by composition)
 * plus Antigravity's OWN runtime-specific verbs on top, so the neutral
 * standard never carries `agy`-specific commands. The earlier provisional
 * list mirrored Gemini CLI; `agy` dropped Gemini-only verbs (`vim`, `theme`,
 * `terminal-setup`, `setup-github`, `bashes`, `shells`, `policies`,
 * `extensions`, `?`, `dir`, ...) and added agent-first ones. Both the primary
 * verbs and the 8 documented aliases (`new`, `settings`, `quit`, `branch`,
 * `switch`, `conversation`, `undo`, `quota`) are reserved.
 *
 * Applied to BOTH the `skill` and `workflow` kinds (see `reservedNames`
 * below): Antigravity has no vendor-specific command directory, its user
 * slash-invocables are skills (`.agents/skills/<name>/SKILL.md`) AND
 * workflows (`.agent/workflows/<name>.md`), both invoked by `/<name>`, so a
 * file of either kind named after a built-in is flagged by SELF scope.
 * Authored lowercase, no leading `/` (the analyzer normalises both sides).
 *
 * **Reconciliation marker**: re-capture from `agy /help` on each major
 * Antigravity CLI release, bump the cited version, and move any verb that
 * becomes universal across agents down into `COMMONS_RESERVED_NAMES`.
 */
const ANTIGRAVITY_RESERVED_SLASH_VERBS: readonly string[] = [
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
];

export const antigravityProvider: IBuiltInManifest<IProvider> = {
  id: 'antigravity',
  pluginId: ANTIGRAVITY_PLUGIN_ID,
  kind: 'provider',
  description:
    'Classifies `.agent/workflows/*.md` as Antigravity workflows and `.agents/skills/*/SKILL.md` as skills (open standard); declares the Antigravity runtime identity and its reserved built-in names.',

  // Provider identity for the active-lens dropdown, the topbar lens chip,
  // and the per-node provider chip. Antigravity violet, distinct from the
  // other vendor palettes.
  presentation: {
    label: "Google's Antigravity",
    color: '#7c3aed',
    colorDark: '#a78bfa',
  },

  // Auto-detect marker: Antigravity's workflows live under `.agent/workflows/`
  // (SINGULAR `.agent`), its one vendor-specific on-disk territory. Skills
  // live under the shared open-standard `.agents/` (owned by `agent-skills`),
  // so they are deliberately NOT a marker here. Now that antigravity ships
  // `beta` (enabled by default), this marker is live: a `.agent/workflows/`
  // project auto-detects the antigravity lens.
  detect: { markers: ['.agent/workflows'] },

  // Vendor provider: Antigravity declares its own `workflow` kind
  // (`.agent/workflows/*.md`) on top of the open-standard skills it adopts.
  // Gating the classifier behind the active lens keeps the walker from
  // claiming Antigravity workflows under another lens, where the Antigravity
  // runtime would never resolve them anyway.
  gatedByActiveLens: true,

  // Beta: ships ENABLED by default (auto-detects `.agent/workflows/`,
  // selectable as the active lens) with a maturity badge, the same posture
  // as codex, since the workflow kind + slash wiring are freshly landed.
  // Promote to `stable` (drop the field) once it has real-world mileage.
  stability: 'beta',

  // `.md` + YAML frontmatter covers BOTH families (skills and workflows);
  // a single read rule suffices because the parser/extension are identical,
  // `classify()` below routes each path to its kind. (Codex needs a
  // multi-rule `read` only because it mixes `.toml` + `.md`.)
  read: COMMONS_READ,

  // Two kinds: the open-standard `skill` (inherited from `agent-skills` by
  // manifest composition, so under the antigravity lens
  // `.agents/skills/<name>/SKILL.md` classifies as
  // `{ provider: 'antigravity', kind: 'skill' }` and the reservedNames below
  // apply via SELF scope) and the OWN `workflow` (`.agent/workflows/*.md`).
  // `agent-skills` itself is gated to its own lens, so it never competes here.
  kinds: {
    ...COMMONS_KINDS,
    workflow: {
      schema: './schemas/workflow.schema.json',
      schemaJson: workflowSchema,
      ui: {
        label: 'Workflows',
        // Antigravity violet, so a workflow node reads as Antigravity's own
        // (skills keep the normalised cross-provider green of COMMONS_KINDS).
        color: '#7c3aed',
        colorDark: '#a78bfa',
        icon: { kind: 'pi', id: 'pi-sitemap' },
      },
      // The handle is ALWAYS the filename stem (`/<name>`): Antigravity
      // workflows have no `name` frontmatter field (unlike skills), so there
      // is no override source, only `filename-basename`.
      identifiers: ['filename-basename'],
    },
  },

  // `/<name>` slash invocations resolve to BOTH skills and workflows: under
  // the antigravity lens a `/deploy` links to either `.agents/skills/deploy`
  // or `.agent/workflows/deploy.md`. Overrides the open-standard default
  // (`invokes: ['skill']`) to add the own `workflow` kind.
  resolution: { invokes: ['skill', 'workflow'] },

  classify(path: string): string | null {
    // Antigravity's own workflows: `.agent/workflows/<name>.md` (SINGULAR
    // `.agent`, one file level, no subfolder). Distinct from the plural
    // `.agents/skills/` open standard handled by `classifyCommonsPath`.
    if (/^\.agent\/workflows\/[^/]+\.md$/.test(path.toLowerCase())) return 'workflow';
    // Open-standard skills (`.agents/skills/<name>/SKILL.md`); everything
    // else -> null (disclaimed, falls through to `core/markdown`).
    return classifyCommonsPath(path);
  },

  // Reserved-name catalog (`ANTIGRAVITY_RESERVED_SLASH_VERBS`, defined above).
  // Applied to BOTH `skill` and `workflow`: Antigravity invokes either kind
  // by the same `/<name>` slash, so a user file of either kind named after a
  // built-in is silently shadowed. `core/name-reserved` tests each node
  // against `reservedNames[node.kind]`, so both keys must carry the catalog.
  reservedNames: {
    skill: ANTIGRAVITY_RESERVED_SLASH_VERBS,
    workflow: ANTIGRAVITY_RESERVED_SLASH_VERBS,
  },
};
