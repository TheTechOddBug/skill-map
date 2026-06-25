/**
 * `buildProviderRegistry(providers)`, assemble the catalog of Providers
 * the BFF embeds in every payload-bearing envelope (sibling of
 * `buildKindRegistry`).
 *
 * The registry mirrors `spec/schemas/api/rest-envelope.schema.json#/properties/providerRegistry`:
 * provider id → `{ label, color, colorDark?, emoji?, icon?, isLens, hideChip?, bodyField? }`,
 * projected from each Provider's `presentation` block plus its
 * `gatedByActiveLens` flag (as `isLens`) and its `read.bodyField` (when set,
 * for structured-frontmatter Providers like Codex).
 *
 * The UI consumes it to render the active-lens dropdown, the topbar lens
 * chip, and the per-node provider chip from the real registered-Provider
 * set instead of a hardcoded list. The dropdown lists only `isLens`
 * entries (gated Providers), so the non-gated `markdown` base never shows
 * there; `hideChip` (set by that base) additionally suppresses its
 * per-card chip.
 *
 * Deterministic: insertion order = Provider iteration order. The input
 * array comes from the same source the scan composer and `buildKindRegistry`
 * use, so the registry never diverges from the registered Provider set.
 * No I/O, no kernel side-effects. A Provider with no `presentation` block
 * is skipped defensively (the kernel rejects such Providers at load time,
 * so this only guards against a malformed runtime object).
 */

import type { IProvider, IProviderUi } from '../kernel/extensions/index.js';
import type { IProviderRegistryEntry, TProviderRegistry } from './envelope.js';

/**
 * Copy the presentation block's optional visuals (everything past the
 * required `label` / `color`) without emitting `undefined` keys. Extracted
 * so `buildProviderRegistry` keeps a low branch count as the optional-field
 * set grows.
 */
function presentationOptionals(ui: IProviderUi): Partial<IProviderRegistryEntry> {
  const out: Partial<IProviderRegistryEntry> = {};
  if (ui.colorDark !== undefined) out.colorDark = ui.colorDark;
  if (ui.emoji !== undefined) out.emoji = ui.emoji;
  if (ui.icon !== undefined) out.icon = ui.icon;
  if (ui.hideChip !== undefined) out.hideChip = ui.hideChip;
  return out;
}

/**
 * Resolve the Provider's body field from its `read` config, which is
 * either a single rule or a multi-rule array. Returns the first rule's
 * `bodyField` that is set (today only Codex's `.toml` rule carries one;
 * its `.md` skills rule does not). `undefined` when no rule declares one.
 */
function resolveProviderBodyField(read: IProvider['read']): string | undefined {
  if (read === undefined) return undefined;
  const rules = Array.isArray(read) ? read : [read];
  for (const rule of rules) {
    if (rule.bodyField !== undefined) return rule.bodyField;
  }
  return undefined;
}

export function buildProviderRegistry(
  providers: ReadonlyArray<IProvider>,
): TProviderRegistry {
  const registry: TProviderRegistry = {};
  for (const provider of providers) {
    const ui = provider.presentation;
    if (!ui) continue;
    const entry: IProviderRegistryEntry = {
      label: ui.label,
      color: ui.color,
      // A Provider is a selectable lens iff it gates on the active lens;
      // the non-gated `markdown` base projects `isLens: false`.
      isLens: provider.gatedByActiveLens === true,
      ...presentationOptionals(ui),
    };
    // Surface the Provider's body field (Codex's `developer_instructions`)
    // so the UI can render it as the node body and exclude it from the
    // metadata dump, without hardcoding any Provider id client-side.
    const bodyField = resolveProviderBodyField(provider.read);
    if (bodyField !== undefined) entry.bodyField = bodyField;
    registry[provider.id] = entry;
  }
  return registry;
}
