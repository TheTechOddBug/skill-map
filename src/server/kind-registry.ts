/**
 * `buildKindRegistry(providers)`, assemble the catalog of kinds the
 * BFF embeds in every payload-bearing envelope (Step 14.5.d).
 *
 * The registry mirrors `spec/schemas/api/rest-envelope.schema.json#/properties/kindRegistry`:
 * kind name → `{ primaryProviderId, providers: { <providerId>: ui } }`.
 *
 * Cross-provider kind sharing: when two Providers declare the same
 * kind name (e.g. Claude `agent` and Gemini `agent`), both
 * contributions are kept under the entry's `providers` map. The first
 * Provider in iteration order populates `primaryProviderId`, which
 * drives the kind's primary CSS var (`--sm-kind-<kind>`); subsequent
 * Providers append to `providers` without overwriting the primary.
 * Per-node painting picks `entry.providers[node.provider]` so a
 * Gemini-sourced `agent` renders in Gemini's color even though
 * Claude is the primary.
 *
 * The kernel separately surfaces `provider-ambiguous` as an issue
 * when two Providers match the SAME file; the registry stays
 * coherent during the conflict window so the UI keeps rendering.
 *
 * Deterministic: insertion order = Provider iteration order. The
 * input array comes from `composeScanExtensions` (the same source the
 * scan composer uses), so the registry never diverges from what the
 * scan actually classified. No I/O, no kernel side-effects.
 */

import type { IProvider } from '../kernel/extensions/index.js';
import type { IKindRegistryEntry, IKindRegistryProviderUi, TKindRegistry } from './envelope.js';

export function buildKindRegistry(providers: ReadonlyArray<IProvider>): TKindRegistry {
  const registry: TKindRegistry = {};
  for (const provider of providers) {
    for (const [kindName, kindEntry] of Object.entries(provider.kinds)) {
      const ui = kindEntry.ui;
      const providerUi: IKindRegistryProviderUi = {
        label: ui.label,
        color: ui.color,
      };
      if (ui.colorDark !== undefined) providerUi.colorDark = ui.colorDark;
      if (ui.emoji !== undefined) providerUi.emoji = ui.emoji;
      if (ui.icon !== undefined) providerUi.icon = ui.icon;

      const existing = registry[kindName];
      if (existing) {
        // Same kind name from a later Provider, keep the primary,
        // record the contribution so the UI can paint per-provider.
        existing.providers[provider.id] = providerUi;
        continue;
      }
      const entry: IKindRegistryEntry = {
        primaryProviderId: provider.id,
        providers: { [provider.id]: providerUi },
      };
      registry[kindName] = entry;
    }
  }
  return registry;
}
