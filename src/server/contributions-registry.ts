/**
 * `buildContributionsRegistry(kernel)`, assemble the catalog of view
 * contributions the BFF embeds in every payload-bearing envelope
 * (parallel to `buildKindRegistry` for the kindRegistry surface).
 *
 * The registry mirrors
 * `spec/schemas/api/rest-envelope.schema.json#/properties/contributionsRegistry`:
 * qualified id (`<pluginId>/<extensionId>/<contributionId>`) → registered
 * shape including `pluginId` / `extensionId` / `contributionId` /
 * `slot` plus optional manifest-declared presentation hints (`label`,
 * `tooltip`, `icon`, `emptyText`, `emitWhenEmpty`).
 *
 * The plugin author picks one slot from the closed catalog
 * published in `spec/schemas/view-slots.schema.json`. The slot fixes
 * both the renderer and the payload shape, the UI mounts a host per
 * slot and renders whatever the kernel emits for it.
 *
 * Deterministic: order = `kernel.getRegisteredViewContributions()`
 * iteration order, which itself comes from the plugin runtime
 * `collectViewContributions` linear walk. No I/O, no kernel
 * side-effects.
 */

import type { Kernel, IRegisteredViewContribution } from '../kernel/index.js';
import type { IContributionsRegistryEntry, TContributionsRegistry } from './envelope.js';

// Canonical wire-shape declarations live in `./envelope.js`; this module
// re-exports them so existing imports under `server/contributions-registry`
// keep resolving. The dedup matches the audit's M4 fix (the two
// declarations drifted on `priority?`).
export type { IContributionsRegistryEntry, TContributionsRegistry } from './envelope.js';

export function buildContributionsRegistry(kernel: Kernel): TContributionsRegistry {
  const registry: TContributionsRegistry = {};
  for (const c of kernel.getRegisteredViewContributions()) {
    registry[qualifiedId(c)] = entryFromRegistered(c);
  }
  return registry;
}

function qualifiedId(c: IRegisteredViewContribution): string {
  return `${c.pluginId}/${c.extensionId}/${c.contributionId}`;
}

function entryFromRegistered(c: IRegisteredViewContribution): IContributionsRegistryEntry {
  const entry: IContributionsRegistryEntry = {
    pluginId: c.pluginId,
    extensionId: c.extensionId,
    contributionId: c.contributionId,
    slot: c.slot,
    emitWhenEmpty: c.emitWhenEmpty,
  };
  if (c.label !== undefined) entry.label = c.label;
  if (c.tooltip !== undefined) entry.tooltip = c.tooltip;
  if (c.icon !== undefined) entry.icon = c.icon;
  if (c.emptyText !== undefined) entry.emptyText = c.emptyText;
  if (c.priority !== undefined) entry.priority = c.priority;
  return entry;
}
