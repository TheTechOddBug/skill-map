/**
 * Built-in `core/markdown` Provider, universal `.md` fallback.
 *
 * Owns the `markdown` kind (the format-named generic fallback). Claims
 * any markdown file no vendor-specific Provider classifies, files at
 * the project root, under `.claude/hooks/`, `notes/`, `CLAUDE.md`,
 * `GEMINI.md`, or any other location outside a known platform's
 * territory.
 *
 *     <any-path>/**.md (only if no other Provider classified it) → kind: markdown
 *
 * Provider iteration order is "vendor-specific Providers first, core
 * fallback last", registered LAST in `built-ins.ts`. The kernel
 * orchestrator dedups by path: a file already classified by an earlier
 * Provider (e.g. `.claude/agents/foo.md` claimed by claude as `agent`)
 * is skipped on subsequent walks, so this Provider's `classify` is
 * only consulted for genuinely orphan files.
 *
 * **Why a Provider and not a kernel-level fallback?** The spec invariant
 * "no extension is privileged" (architecture.md §75) forbids the kernel
 * from emitting kinds directly. Bundling the markdown fallback as a
 * Provider under the `core` group keeps the invariant intact: the
 * fallback is disable-able like any other extension via
 * `sm plugins disable core/markdown`. When Codex / Cursor / Roo land
 * their own Providers, they slot into the iteration order before this
 * one and the fallback semantics stay invariant.
 *
 * **Why `classify` always returns `'markdown'`.** The Provider does NOT
 * filter by path, it takes whatever the kernel walker hands it and
 * tags it `markdown`. The "only orphans" guarantee comes from the
 * orchestrator's path-dedup, NOT from this Provider. Mixing the two
 * concerns here would couple `core/markdown` to every other Provider's
 * territory and break the day a new Provider lands.
 */

import type { IBuiltInManifest, IProvider } from '../../../../kernel/extensions/index.js';
import markdownSchema from './schemas/markdown.schema.json' with { type: 'json' };
import { CORE_PLUGIN_ID } from '../../../ids.js';

export const coreMarkdownProvider: IBuiltInManifest<IProvider> = {
  id: 'markdown',
  pluginId: CORE_PLUGIN_ID,
  kind: 'provider',
  description: 'Universal `.md` fallback. Claims any markdown file that no vendor-specific provider has classified.',

  // Provider identity. `hideChip: true` suppresses the per-card provider
  // chip: this fallback carries the majority of nodes in any project, so
  // badging every generic `.md` would be noise and dilute the chip's
  // purpose (signalling a NON-default platform). This Provider is the
  // non-gated universal BASE, not a lens: `gatedByActiveLens` is false, so
  // the BFF projects `isLens: false` and the UI never lists it in the
  // active-lens dropdown nor as the topbar lens chip. The label is retained
  // only for internal registry lookups (and any legacy node still tagged
  // `provider: 'markdown'`).
  presentation: {
    label: 'Markdown',
    color: '#9ca3af',
    colorDark: '#6b7280',
    hideChip: true,
  },

  // No `detect` block: the universal base is never auto-suggested, and
  // since it is non-gated (`gatedByActiveLens` omitted == false) it is not
  // a selectable lens at all. A no-vendor project resolves to the
  // open-standard `agent-skills` default lens; this base runs underneath
  // every lens regardless.

  read: { extensions: ['.md'], parser: 'frontmatter-yaml' },

  // Per spec § A.6, defaultRefreshAction values MUST be qualified
  // action ids. The summarize-markdown action is not yet implemented
  // as a registry entry (it ships later under the core plugin), but
  // the qualified form is the contract.
  //
  // UI presentation: same neutral teal that the per-vendor Providers
  // (when they shipped their own markdown kind duplicates) used to
  // declare. The kindRegistry
  // composer (`buildKindRegistry`) makes this entry the primary owner
  // of the `markdown` kind because no other Provider declares it now;
  // per-node painting still falls through `entry.providers[node.provider]`
  // so the UI is identical to today.
  kinds: {
    markdown: {
      schema: './schemas/markdown.schema.json',
      schemaJson: markdownSchema,
      ui: {
        label: 'Markdown',
        color: '#5b908c',
        colorDark: '#9bbcb8',
        icon: {
          kind: 'svg',
          path: 'M14 2 H6 a2 2 0 0 0 -2 2 V20 a2 2 0 0 0 2 2 H18 a2 2 0 0 0 2 -2 V8 L14 2 M14 2 V8 H20 M16 13 H8 M16 17 H8 M10 9 H8',
        },
      },
      // No `identifiers`: markdown nodes are addressed by path, not by a
      // canonical name. The name index built by `liftResolvedLinkConfidence`
      // never sees markdown entries; resolution falls through to the
      // path-match rule only.
    },
  },

  // No `resolution`: `core/markdown` is the universal fallback Provider,
  // it does not declare an invocation surface of its own. Mentions /
  // slashes sourced from markdown bodies are still resolved by the
  // post-walk transform, the lookup keys on the ACTIVE PROVIDER LENS
  // (per `spec/architecture.md` §Provider · resolution rules), mirroring
  // the extractor gate that authorised the emission in the first place.
  // Leaving this field absent therefore has no resolver-side impact
  // under any lens that DOES declare a resolution map; it would only
  // matter the day `markdown` itself becomes a lens (which is not on
  // the roadmap, the format is provider-agnostic by design).

  classify(): string | null {
    return 'markdown';
  },
};
