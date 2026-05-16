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

import type { IProvider } from '../../../../kernel/extensions/index.js';
import markdownSchema from './schemas/markdown.schema.json' with { type: 'json' };

export const coreMarkdownProvider: IProvider = {
  id: 'markdown',
  pluginId: 'core',
  kind: 'provider',
  version: '1.0.0',
  description: 'Universal `.md` fallback. Claims any markdown file no vendor-specific Provider classifies.',

  read: { extensions: ['.md'], parser: 'frontmatter-yaml' },

  // Per spec § A.6, defaultRefreshAction values MUST be qualified
  // action ids. The summarize-markdown action is not yet implemented
  // as a registry entry (it ships later under the core bundle), but
  // the qualified form is the contract.
  //
  // UI presentation: same neutral teal that Claude / Gemini used to
  // declare for their per-vendor markdown duplicates. The kindRegistry
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
    },
  },

  classify(): string | null {
    return 'markdown';
  },
};
