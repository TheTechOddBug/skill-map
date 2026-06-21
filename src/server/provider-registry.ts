/**
 * `buildProviderRegistry(providers)`, assemble the catalog of Providers
 * the BFF embeds in every payload-bearing envelope (sibling of
 * `buildKindRegistry`).
 *
 * The registry mirrors `spec/schemas/api/rest-envelope.schema.json#/properties/providerRegistry`:
 * provider id → `{ label, color, colorDark?, emoji?, icon?, hideChip?, comingSoon? }`,
 * projected straight from each Provider's `presentation` block.
 *
 * The UI consumes it to render the active-lens dropdown, the topbar lens
 * chip, and the per-node provider chip from the real registered-Provider
 * set instead of a hardcoded list. `hideChip` (set by the universal
 * `markdown` fallback) suppresses only the per-card chip.
 *
 * Deterministic: insertion order = Provider iteration order. The input
 * array comes from the same source the scan composer and `buildKindRegistry`
 * use, so the registry never diverges from the registered Provider set.
 * No I/O, no kernel side-effects. A Provider with no `presentation` block
 * is skipped defensively (the kernel rejects such Providers at load time,
 * so this only guards against a malformed runtime object).
 */

import type { IProvider } from '../kernel/extensions/index.js';
import type { IProviderRegistryEntry, TProviderRegistry } from './envelope.js';

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
    };
    if (ui.colorDark !== undefined) entry.colorDark = ui.colorDark;
    if (ui.emoji !== undefined) entry.emoji = ui.emoji;
    if (ui.icon !== undefined) entry.icon = ui.icon;
    if (ui.hideChip !== undefined) entry.hideChip = ui.hideChip;
    if (ui.comingSoon !== undefined) entry.comingSoon = ui.comingSoon;
    registry[provider.id] = entry;
  }
  return registry;
}
